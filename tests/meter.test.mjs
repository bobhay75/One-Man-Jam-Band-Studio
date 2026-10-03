import {strict as assert} from "node:assert";
import {measureChannels} from "../src/meter.js";
const m=measureChannels([new Float32Array([0,.5,-.5,1,-1])]);
assert.equal(m.peak,1);assert.ok(m.rms>.6&&m.rms<.8);assert.equal(m.peakDb,0);
console.log("meter tests passed");
