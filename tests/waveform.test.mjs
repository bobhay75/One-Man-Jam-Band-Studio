import {strict as assert} from "node:assert";
import {buildWaveformPeaks,selectionToRegion} from "../src/waveform.js";
const s=new Float32Array([0,.5,-.5,1,-1,0,.25,-.25]);
const p=buildWaveformPeaks(s,16);assert.equal(p.length,16);assert.ok(p.some(x=>x.max>=.5));assert.ok(p.some(x=>x.min<=-.5));
const r=selectionToRegion(20,80,100,10);assert.deepEqual(r,{startSec:2,endSec:8,kind:"mute",label:"No accompaniment"});
console.log("waveform tests passed");
