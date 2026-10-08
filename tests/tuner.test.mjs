import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCorrelate, frequencyToNote, noteName, centsOff, tunerState } from '../src/tuner.js';
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
