export const MASTER_PRESETS={
  natural:{highpassHz:35,lowShelfDb:.5,highShelfDb:1,threshold:-12,ratio:2.5,attack:.012,release:.22},
  warm:{highpassHz:32,lowShelfDb:2,highShelfDb:.2,threshold:-14,ratio:3,attack:.018,release:.28},
  open:{highpassHz:40,lowShelfDb:0,highShelfDb:2.5,threshold:-10,ratio:2,attack:.008,release:.18}
};
export function getMasteringPreset(name="natural"){return MASTER_PRESETS[name]||MASTER_PRESETS.natural}
function midiHz(m){return 440*Math.pow(2,(m-69)/12)}
function env(g,t,d,peak=.5){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+.005);g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.03,d))}
function tone(ctx,dest,{time,duration,midi,velocity=.5,type="sine"}){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=midiHz(midi);env(g,time,duration,velocity);o.connect(g).connect(dest);o.start(time);o.stop(time+duration+.05);
}
function drum(ctx,dest,e){
  const g=ctx.createGain(),o=ctx.createOscillator();o.connect(g).connect(dest);
  if(e.kind==="kick"){o.type="sine";o.frequency.setValueAtTime(120,e.time);o.frequency.exponentialRampToValueAtTime(48,e.time+.09);env(g,e.time,.12,.8*e.velocity)}
  else if(e.kind==="snare"){o.type="square";o.frequency.value=180;env(g,e.time,.08,.16*e.velocity)}
  else{o.type="square";o.frequency.value=6000;env(g,e.time,.025,.06*e.velocity)}
  o.start(e.time);o.stop(e.time+.15);
}
function gainNode(ctx,value){const g=ctx.createGain();g.gain.value=value;return g}
function connectMastering(ctx,input,destination,presetName){
  const p=getMasteringPreset(presetName);
  const hp=ctx.createBiquadFilter();hp.type="highpass";hp.frequency.value=p.highpassHz;hp.Q.value=.7;
  const low=ctx.createBiquadFilter();low.type="lowshelf";low.frequency.value=180;low.gain.value=p.lowShelfDb;
  const high=ctx.createBiquadFilter();high.type="highshelf";high.frequency.value=5200;high.gain.value=p.highShelfDb;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=p.threshold;comp.knee.value=12;comp.ratio.value=p.ratio;comp.attack.value=p.attack;comp.release.value=p.release;
  input.connect(hp).connect(low).connect(high).connect(comp).connect(destination);
}
export async function renderProjectMix(sourceBuffer,project){
  const arr=project.arrangement;if(!arr)throw new Error("Generate an arrangement first");
  const sr=sourceBuffer.sampleRate,frames=Math.ceil(Math.max(sourceBuffer.duration,arr.durationSec)*sr),ctx=new OfflineAudioContext(2,frames,sr);
  const bus=gainNode(ctx,project.mix.masterGain??.9);connectMastering(ctx,bus,ctx.destination,project.mastering?.preset||"natural");

  const sourceGain=gainNode(ctx,project.mix.sourceGain??1);sourceGain.connect(bus);
  const src=ctx.createBufferSource();src.buffer=sourceBuffer;src.connect(sourceGain);src.start(0);
  const dg=gainNode(ctx,project.mix.drumsGain??.65),bg=gainNode(ctx,project.mix.bassGain??.6),lg=gainNode(ctx,project.mix.leadGain??.45);
  dg.connect(bus);bg.connect(bus);lg.connect(bus);
  for(const e of arr.drums)drum(ctx,dg,e);
  for(const e of arr.bass)tone(ctx,bg,{...e,type:"triangle"});
  for(const e of arr.lead)tone(ctx,lg,{...e,type:"sine"});
  const rendered=await ctx.startRendering();

  let peak=0;for(let c=0;c<rendered.numberOfChannels;c++)for(const x of rendered.getChannelData(c))peak=Math.max(peak,Math.abs(x));
  if(peak>.98){const scale=.98/peak;for(let c=0;c<rendered.numberOfChannels;c++){const ch=rendered.getChannelData(c);for(let i=0;i<ch.length;i++)ch[i]*=scale}}
  return rendered;
}
