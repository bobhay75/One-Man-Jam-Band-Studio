import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCorrelate, frequencyToNote, noteName, centsOff, tunerState, createTunerTracker } from '../src/tuner.js';
test('guitar range: flat, center and sharp have correct sign and nearest target',()=>{
  for(const midi of [40,45,50,55,59,64,69])for(const cents of [-20,0,20]){
    const frequency=440*2**((midi-69)/12)*2**(cents/1200);
    const samples=Float32Array.from({length:4096},(_,i)=>.4*Math.sin(2*Math.PI*frequency*i/48000));
    const detected=autoCorrelate(samples,48000),note=frequencyToNote(detected),error=centsOff(detected,note);
    assert.equal(note,midi);assert.ok(Math.abs(error-cents)<=2, noteName(note)+': '+error);
    assert.equal(tunerState(error),cents<0?'flat':cents>0?'sharp':'in-tune');
  }
  assert.equal(autoCorrelate(new Float32Array(4096),48000),-1);
  assert.equal(tunerState(NaN),'waiting');
  assert.equal(tunerState(-5),'in-tune');assert.equal(tunerState(5),'in-tune');
});

test('noise, DC and invalid input never acquire a musical pitch',()=>{
  let seed=17;
  for(let frame=0;frame<12;frame++){
    const samples=Float32Array.from({length:4096},()=>{
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      return (seed/2**32*2-1)*.04;
    });
    assert.equal(autoCorrelate(samples,48000),-1);
  }
  assert.equal(autoCorrelate(new Float32Array(4096).fill(.025),48000),-1);
  assert.equal(autoCorrelate(new Float32Array(4096).fill(NaN),48000),-1);
});
test('harmonic-rich decaying guitar notes retain their fundamental at microphone sample rates',()=>{
  for(const rate of [44100,48000])for(const midi of [40,45,50,55,59,64,69,76])for(const cents of [-20,0,20]){
    const frequency=440*2**((midi-69)/12+cents/1200);
    let seed=17;
    const samples=Float32Array.from({length:4096},(_,i)=>{
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const phase=2*Math.PI*frequency*i/rate;
      return Math.exp(-3*i/rate)*(.15*Math.sin(phase)+.21*Math.sin(phase*2)+.08*Math.sin(phase*3))+.003*(seed/2**31-1);
    });
    const detected=autoCorrelate(samples,rate);
    assert.ok(detected>0);
    assert.ok(Math.abs(1200*Math.log2(detected/frequency))<=2,rate+' '+midi+' '+cents+' '+detected);
  }
});
test('quiet decaying notes do not chatter at the previous energy threshold',()=>{
  for(const amplitude of [.013,.016]){
    const samples=Float32Array.from({length:4096},(_,i)=>amplitude*Math.sin(2*Math.PI*110*i/48000));
    assert.equal(frequencyToNote(autoCorrelate(samples,48000)),45);
  }
});
test('tracker qualifies notes, ignores isolated octave jumps, holds brief gaps then clears',()=>{
  const tracker=createTunerTracker();
  assert.equal(tracker.update(110,0),null);assert.equal(tracker.update(110,100),null);
  assert.equal(tracker.update(110,200).note,45);
  assert.equal(tracker.update(220,300).note,45);
  assert.equal(tracker.update(110,400).note,45);
  assert.equal(tracker.update(-1,600).note,45);
  assert.equal(tracker.update(-1,800),null);
  assert.equal(tracker.update(220,900),null);
  tracker.update(220,1000);assert.equal(tracker.update(220,1100).note,57);
});
test('tracker settles on a changed note and hysteresis prevents sharp/in-tune chatter',()=>{
  const tracker=createTunerTracker(),f=c=>440*2**(c/1200);
  for(let t=0;t<500;t+=100)tracker.update(440,t);
  for(let t=500;t<1500;t+=100)assert.equal(tracker.update(f(t%200?6:4),t).state,'in-tune');
  for(let t=1500;t<2200;t+=100)tracker.update(f(20),t);
  assert.equal(tracker.update(f(20),2200).state,'sharp');
  for(let t=2300;t<3000;t+=100)tracker.update(f(-20),t);
  assert.equal(tracker.update(f(-20),3000).state,'flat');
  for(let t=3100;t<3800;t+=100)tracker.update(330,t);
  assert.equal(tracker.update(330,3800).note,64);
});
