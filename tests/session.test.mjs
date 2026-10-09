import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioIdentity, matchesSource, validateChords } from '../src/session.js';
import { createProject, setSource } from '../src/project.js';
import { deserializeProject, serializeProject } from '../src/persistence.js';
import { buildArrangement, parseChord } from '../src/arranger.js';
import { humanizeEvents } from '../src/humanize.js';
import { estimateTempo } from '../src/analyze.js';

test('restoration compares audio bytes, never filename alone', async()=>{
  const one={name:'take.wav',sha256:await audioIdentity(new Uint8Array([1,2]))};
  const two={name:'take.wav',sha256:await audioIdentity(new Uint8Array([3,4]))};
  assert.equal(matchesSource(one,two),false);
  assert.equal(matchesSource(one,{...one,name:'renamed.wav'}),true);
  assert.equal(matchesSource({name:'take.wav'},{name:'take.wav'}),false);
  const p=createProject();p.regions=[{startSec:1,endSec:2}];p.tracks.track5={source:one};
  const next=setSource(p,two);assert.deepEqual(next.regions,[]);assert.deepEqual(next.tracks,p.tracks);
});
test('malformed project or chord edits are rejected before they reach audio scheduling',()=>{
  for(const timeline of [[null],[{startSec:1,endSec:0,chord:'C'}],[{startSec:0,endSec:1,chord:'bad'}],[{startSec:0,endSec:3,chord:'C'}]])assert.throws(()=>validateChords(timeline,2));
  assert.deepEqual(parseChord('Bb'),{root:10,mode:'major'});
  const p=createProject();p.mix.sourceGain=-1;assert.throws(()=>deserializeProject(JSON.stringify(p)));
  p.mix.sourceGain=1;p.tracks.track5={gain:1,offsetSec:0,source:{name:'take.wav'}};
  const restored=deserializeProject(serializeProject(p));assert.equal(restored.tracks.track5.source.localAudioRequired,true);
  for(const text of ['[]','null','{"version":99}','{"version":5,"tracks":[]}'])assert.throws(()=>deserializeProject(text));
});
test('beat grid has explicit phase, bounded events and phase-relative swing',()=>{
  const a=buildArrangement({bpm:120,durationSec:2.55,offsetSec:.2,muteRegions:[{startSec:.73,endSec:.77}]});
  assert.equal(a.drums[0].time,.2);
  for(const stem of ['drums','bass','lead'])assert.ok(a[stem].every(e=>e.time>=.2&&e.time<2.55&&!(e.time>=.73&&e.time<.77)));
  const moved=humanizeEvents([{time:.45}],{beatSec:.5,offsetSec:.2,swing:.2,timingMs:0,velocityJitter:0});
  assert.equal(moved[0].time,.468);
  assert.equal(estimateTempo(new Float32Array(16000),16000),null);
});
