import {strict as assert} from "node:assert";
import {humanizeEvents} from "../src/humanize.js";
const events=[{time:0,velocity:.5},{time:.25,velocity:.5},{time:.5,velocity:.5}];
const a=humanizeEvents(events,{timingMs:8,velocityJitter:.04,swing:.4,beatSec:.5,seed:9});
const b=humanizeEvents(events,{timingMs:8,velocityJitter:.04,swing:.4,beatSec:.5,seed:9});
assert.deepEqual(a,b);assert.equal(a.length,3);assert.ok(a.every(e=>e.time>=0&&e.velocity>0&&e.velocity<=1));
assert.ok(a[1].time>.25);
console.log("humanize tests passed");
