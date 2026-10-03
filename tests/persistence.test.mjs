import {strict as assert} from "node:assert";
import {serializeProject,deserializeProject} from "../src/persistence.js";
const p={version:5,source:{name:"x.m4a"},regions:[],mix:{},mastering:{preset:"warm"},runtime:{apiKey:"SECRET"},apiKey:"SECRET2"};
const text=serializeProject(p),q=deserializeProject(text);
assert.equal(q.source.localAudioRequired,true);assert.equal(q.mastering.preset,"warm");
assert.ok(!text.includes("SECRET"));assert.equal(q.runtime,undefined);assert.equal(q.apiKey,undefined);
assert.throws(()=>deserializeProject("{}"));
console.log("persistence tests passed");
