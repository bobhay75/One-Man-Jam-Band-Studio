import {strict as assert} from "node:assert";
import {inferKeyFromChroma,inferChordFromChroma,activityRegions,estimateTempo} from "../src/analyze.js";

const cmaj=[10,1,3,1,8,5,1,7,1,4,1,3];
assert.match(inferKeyFromChroma(cmaj).key,/major/);
const gChord=[0,0,7,0,0,0,0,9,0,0,0,8];
assert.equal(inferChordFromChroma(gChord).label,"G");

const sr=1000,x=new Float32Array(2000);for(let i=400;i<900;i++)x[i]=.2;
const r=activityRegions(x,sr,{frameMs:50,threshold:.05,minMs:100});
assert.equal(r.length,1);assert.equal(r[0].startSec,.4);assert.equal(r[0].endSec,.9);

const sr2=1000,y=new Float32Array(10000);for(let i=0;i<y.length;i++){const phase=i%500;if(phase<20)y[i]=1}
const bpm=estimateTempo(y,sr2);assert.ok(bpm>=115&&bpm<=125,`tempo ${bpm}`);
console.log("analysis tests passed");

const {test}=await import('node:test');
const {analyzeAudioBuffer}=await import('../src/analyze.js');
const rate=16000,tone=new Float32Array(rate*2),zero=new Float32Array(tone.length);
for(let i=0;i<tone.length;i++)tone[i]=.15*(Math.sin(2*Math.PI*130.8128*i/rate)+Math.sin(2*Math.PI*164.8138*i/rate)+Math.sin(2*Math.PI*195.9977*i/rate));
const buffer=channels=>({numberOfChannels:channels.length,sampleRate:rate,duration:2,getChannelData:i=>channels[i]});
test('left-only and right-only stereo have equivalent musical analysis',async()=>{
 const l=await analyzeAudioBuffer(buffer([tone,zero])),r=await analyzeAudioBuffer(buffer([zero,tone]));
 assert.equal(l.status,'ready');assert.equal(r.status,'ready');
 for(const key of ['peak','rms','keyEstimate','chordTimeline','tempoBpm','activityRegions'])assert.deepEqual(l[key],r[key]);
 assert.equal(l.analysisChannel,0);assert.equal(r.analysisChannel,1);
});
test('opposite-phase stereo retains musical energy and chords',async()=>{
 const a=await analyzeAudioBuffer(buffer([tone,Float32Array.from(tone,x=>-x)]));
 assert.equal(a.status,'ready');assert.ok(a.rms>.05);assert.ok(a.chordTimeline.length);
});
test('silent and nearly silent input has no inferred default key or chords',async()=>{
 for(const samples of [zero,Float32Array.from(tone,x=>x*0.0001)]){
 const a=await analyzeAudioBuffer(buffer([samples,samples]));assert.equal(a.status,'silent');assert.equal(a.keyEstimate,null);assert.deepEqual(a.chordTimeline,[]);
 }
 assert.equal(inferKeyFromChroma(new Array(12).fill(0)),null);
});
test('audible nonmusical constant signal requires review',async()=>{
 const a=await analyzeAudioBuffer(buffer([new Float32Array(rate*2).fill(.1)]));
 assert.equal(a.status,'low-confidence');assert.equal(a.keyEstimate,null);
});
