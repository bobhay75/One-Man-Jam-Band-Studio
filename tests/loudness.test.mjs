import {strict as assert} from "node:assert";
import {estimateTruePeak,estimateIntegratedLoudness} from "../src/loudness.js";
const ch=new Float32Array(48000).fill(.1);ch[100]=.8;
const tp=estimateTruePeak([ch]);assert.ok(tp.linear>=.8&&tp.linear<=.81);
const l=estimateIntegratedLoudness([new Float32Array(48000).fill(.1)],48000);assert.ok(l.lufs<-19&&l.lufs>-22,`lufs ${l.lufs}`);
console.log("loudness tests passed");
