import {strict as assert} from "node:assert";
import {normalizeRegions,isBlocked,addMuteRegion,removeRegion} from "../src/regions.js";
const r=normalizeRegions([{startSec:5,endSec:3},{startSec:-1,endSec:2},{startSec:8,endSec:12}],10);
assert.deepEqual(r.map(x=>[x.startSec,x.endSec]),[[0,2],[8,10]]);
assert.equal(isBlocked(1,r),true);assert.equal(isBlocked(4,r),false);
let p={regions:[],analysis:{durationSec:10}};p=addMuteRegion(p,2,4);assert.equal(p.regions.length,1);p=removeRegion(p,0);assert.equal(p.regions.length,0);
console.log("regions tests passed");
