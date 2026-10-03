import {strict as assert} from "node:assert";
import {encodeWavBuffer} from "../src/wav.js";
const a=new Float32Array([0,.5,-.5,1,-1]);
const ab=encodeWavBuffer([a],48000),v=new DataView(ab);
const text=(o,n)=>String.fromCharCode(...new Uint8Array(ab,o,n));
assert.equal(text(0,4),"RIFF");assert.equal(text(8,4),"WAVE");assert.equal(text(36,4),"data");
assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),48000);assert.equal(ab.byteLength,54);
console.log("wav tests passed");
