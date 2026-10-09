import {createInstrumentRack} from "./instruments.js";
import {humanizeEvents} from "./humanize.js";
import {normalizeRegions, isBlocked} from "./regions.js";
import {EXTRA_TRACKS} from "./session.js";

export const MASTER_PRESETS={
  natural:{highpassHz:35,lowShelfDb:.5,highShelfDb:1,threshold:-12,ratio:2.5,attack:.012,release:.22},
  warm:{highpassHz:32,lowShelfDb:2,highShelfDb:.2,threshold:-14,ratio:3,attack:.018,release:.28},
  open:{highpassHz:40,lowShelfDb:0,highShelfDb:2.5,threshold:-10,ratio:2,attack:.008,release:.18}
};
export function getMasteringPreset(name="natural"){return MASTER_PRESETS[name]||MASTER_PRESETS.natural}
function gainNode(ctx,value){const g=ctx.createGain();g.gain.value=value;return g}
function connectMastering(ctx,input,destination,presetName){
  const p=getMasteringPreset(presetName),hp=ctx.createBiquadFilter(),low=ctx.createBiquadFilter(),high=ctx.createBiquadFilter(),comp=ctx.createDynamicsCompressor();
  hp.type="highpass";hp.frequency.value=p.highpassHz;hp.Q.value=.7;
  low.type="lowshelf";low.frequency.value=180;low.gain.value=p.lowShelfDb;
  high.type="highshelf";high.frequency.value=5200;high.gain.value=p.highShelfDb;
  comp.threshold.value=p.threshold;comp.knee.value=12;comp.ratio.value=p.ratio;comp.attack.value=p.attack;comp.release.value=p.release;
  input.connect(hp).connect(low).connect(high).connect(comp).connect(destination);
}
function makeImpulse(ctx,seconds=1.1,decay=2.8){
  const len=Math.max(1,Math.floor(ctx.sampleRate*seconds)),buf=ctx.createBuffer(2,len,ctx.sampleRate);
  let seed=1337;
  for(let c=0;c<2;c++){const ch=buf.getChannelData(c);for(let i=0;i<len;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;const n=(seed/4294967296)*2-1;ch[i]=n*Math.pow(1-i/len,decay)*.55}}
  return buf;
}
function connectRoom(ctx,bus,amount=.12){
  const wet=gainNode(ctx,Math.max(0,Math.min(.5,amount))),conv=ctx.createConvolver();conv.buffer=makeImpulse(ctx);
  bus.connect(conv).connect(wet);return wet;
}
function peakProtect(rendered){
  let peak=0;for(let c=0;c<rendered.numberOfChannels;c++)for(const x of rendered.getChannelData(c))peak=Math.max(peak,Math.abs(x));
  if(peak>.98){const scale=.98/peak;for(let c=0;c<rendered.numberOfChannels;c++){const ch=rendered.getChannelData(c);for(let i=0;i<ch.length;i++)ch[i]*=scale}}
  return rendered;
}
function preparedEvents(arr,stem,project){
  const p=project.production||{},offset=stem==="drums"?101:stem==="bass"?211:307;
  return humanizeEvents(arr[stem]||[],{
    timingMs:p.timingMs??2,
    velocityJitter:p.velocityJitter??.05,
    swing:p.swing??.02,
    beatSec:arr.beatSec||.5,
    offsetSec:arr.offsetSec||0,
    seed:(arr.seed||1)+offset
  });
}
function scheduleProceduralStem(ctx,dest,arr,stem,project,rack){
  for(const e of preparedEvents(arr,stem,project)){
    if(e.time>=arr.durationSec||isBlocked(e.time,project.regions))continue;
    if(stem==="drums")rack.scheduleDrum(dest,e);
    if(stem==="bass")rack.scheduleBass(dest,e);
    if(stem==="lead")rack.scheduleLead(dest,e);
  }
}
function applyBlockedRegions(gainParam,regions=[]){
  gainParam.setValueAtTime(1,0);
  // Merge overlapping/adjacent regions before writing automation; otherwise an
  // inner region's fade-in can make a still-blocked section audible.
  const merged=[];
  for(const r of normalizeRegions(regions)){
    const prev=merged.at(-1);
    if(prev&&r.startSec<=prev.endSec+.016)prev.endSec=Math.max(prev.endSec,r.endSec);
    else merged.push({...r});
  }
  for(const r of merged){
    const start=Math.max(0,Number(r.startSec)||0),end=Math.max(start,Number(r.endSec)||start),fade=.008;
    if(end<=start)continue;
    gainParam.setValueAtTime(1,Math.max(0,start-fade));
    gainParam.linearRampToValueAtTime(0,start);
    gainParam.setValueAtTime(0,end);
    gainParam.linearRampToValueAtTime(1,end+fade);
  }
}
function scheduleExternalStem(ctx,dest,buffer,regions=[]){
  const src=ctx.createBufferSource(),gate=gainNode(ctx,1);src.buffer=buffer;applyBlockedRegions(gate.gain,regions);src.connect(gate).connect(dest);src.start(0);
}
export function stemRenderSource(stem,externalStems={}){
  return externalStems?.[stem]?"neural":"procedural";
}
function renderDuration(sourceBuffer,arr,trackBuffers={},project={}){
  return Math.max(sourceBuffer.duration,arr.durationSec,...EXTRA_TRACKS.map(id=>
    trackBuffers[id]?Math.max(0,(project.tracks?.[id]?.offsetSec||0)+trackBuffers[id].duration):0));
}
function scheduleTake(ctx,dest,buffer,offset=0){
  const src=ctx.createBufferSource();src.buffer=buffer;src.connect(dest);
  if(-offset<buffer.duration)src.start(Math.max(0,offset),Math.max(0,-offset));
}
export async function renderProjectMix(sourceBuffer,project,externalStems={},trackBuffers={}){
  const arr=project.arrangement;if(!arr)throw new Error("Generate an arrangement first");
  const sr=sourceBuffer.sampleRate,frames=Math.ceil(renderDuration(sourceBuffer,arr,trackBuffers,project)*sr),ctx=new OfflineAudioContext(2,frames,sr);
  const bus=gainNode(ctx,project.mix.masterGain??.9);
  connectMastering(ctx,bus,ctx.destination,project.mastering?.preset||"natural");
  // Preserve v0.5's parallel dry mastering/wet room path. Only the backing
  // room needs its own final gate so tails cannot leak into exclusions.
  const wetMaster=gainNode(ctx,project.mix.masterGain??.9);wetMaster.connect(ctx.destination);
  const takes=gainNode(ctx,1);takes.connect(bus);connectRoom(ctx,takes,project.mastering?.room??.12).connect(wetMaster);
  const band=gainNode(ctx,1),gate=gainNode(ctx,1),wetGate=gainNode(ctx,1);
  for(const node of [gate,wetGate])applyBlockedRegions(node.gain,project.regions||[]);
  band.connect(gate).connect(bus);connectRoom(ctx,band,project.mastering?.room??.12).connect(wetGate).connect(wetMaster);

  const sourceGain=gainNode(ctx,project.mix.sourceGain??1);sourceGain.connect(takes);
  const src=ctx.createBufferSource();src.buffer=sourceBuffer;src.connect(sourceGain);src.start(0);
  const stems={drums:gainNode(ctx,project.mix.drumsGain??.65),bass:gainNode(ctx,project.mix.bassGain??.6),lead:gainNode(ctx,project.mix.leadGain??.45)};
  for(const id of EXTRA_TRACKS)if(trackBuffers[id]){
    const g=gainNode(ctx,project.tracks?.[id]?.gain??1);g.connect(takes);
    scheduleTake(ctx,g,trackBuffers[id],project.tracks?.[id]?.offsetSec||0);
  }
  for(const g of Object.values(stems))g.connect(band);
  const rack=createInstrumentRack(ctx,project.production||{});
  for(const name of Object.keys(stems)){
    if(externalStems?.[name])scheduleExternalStem(ctx,stems[name],externalStems[name],project.regions||[]);
    else scheduleProceduralStem(ctx,stems[name],arr,name,project,rack);
  }
  return peakProtect(await ctx.startRendering());
}
export async function renderProjectStem(sourceBuffer,project,stem,externalStems={},trackBuffers={}){
  const arr=project.arrangement;if(!arr)throw new Error("Generate an arrangement first");
  const sr=sourceBuffer.sampleRate,frames=Math.ceil(renderDuration(sourceBuffer,arr,trackBuffers,project)*sr),ctx=new OfflineAudioContext(2,frames,sr),out=gainNode(ctx,.9);out.connect(ctx.destination);
  if(stem==="original"){const src=ctx.createBufferSource();src.buffer=sourceBuffer;src.connect(out);src.start(0)}
  else if(EXTRA_TRACKS.includes(stem)&&trackBuffers[stem])scheduleTake(ctx,out,trackBuffers[stem],project.tracks?.[stem]?.offsetSec||0);
  else if(["drums","bass","lead"].includes(stem)){
    const gate=gainNode(ctx,1);applyBlockedRegions(gate.gain,project.regions||[]);gate.connect(out);
    if(externalStems?.[stem])scheduleExternalStem(ctx,gate,externalStems[stem],project.regions||[]);
    else {const rack=createInstrumentRack(ctx,project.production||{});scheduleProceduralStem(ctx,gate,arr,stem,project,rack)}
  } else throw new Error("Unknown stem");
  return peakProtect(await ctx.startRendering());
}
