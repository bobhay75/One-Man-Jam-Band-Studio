import {strict as assert} from "node:assert";
import {serializeProject,deserializeProject} from "../src/persistence.js";
const p={version:3,source:{name:"x.m4a"},regions:[],mix:{},mastering:{preset:"warm"}};
const text=serializeProject(p),q=deserializeProject(text);
assert.equal(q.source.localAudioRequired,true);assert.equal(q.mastering.preset,"warm");
assert.throws(()=>deserializeProject("{}"));
console.log("persistence tests passed");
