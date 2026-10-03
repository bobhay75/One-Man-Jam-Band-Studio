import {strict as assert} from "node:assert";
import {buildArrangement,parseKey} from "../src/arranger.js";
assert.deepEqual(parseKey("G major"),{root:7,mode:"major"});
const a=buildArrangement({bpm:120,durationSec:8,key:"G major",seed:7});
assert.equal(a.bars,4);
assert.ok(a.drums.length>0&&a.bass.length>0&&a.lead.length>0);
assert.ok(a.drums.every(e=>e.time<8));
assert.deepEqual(a,buildArrangement({bpm:120,durationSec:8,key:"G major",seed:7}));
console.log("arranger tests passed");
