import {strict as assert} from "node:assert";
import {inferKeyFromChroma,activityRegions,estimateTempo} from "../src/analyze.js";

const cmaj=[10,1,3,1,8,5,1,7,1,4,1,3];
assert.match(inferKeyFromChroma(cmaj).key,/major/);

const sr=1000,x=new Float32Array(2000);
for(let i=400;i<900;i++)x[i]=.2;
const r=activityRegions(x,sr,{frameMs:50,threshold:.05,minMs:100});
assert.equal(r.length,1); assert.equal(r[0].startSec,.4); assert.equal(r[0].endSec,.9);

const sr2=1000,y=new Float32Array(10000);
for(let i=0;i<y.length;i++){const phase=i%500;if(phase<20)y[i]=1}
const bpm=estimateTempo(y,sr2); assert.ok(bpm>=115&&bpm<=125,`tempo ${bpm}`);
console.log("analysis tests passed");
