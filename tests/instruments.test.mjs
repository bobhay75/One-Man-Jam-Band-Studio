import {strict as assert} from "node:assert";
import {INSTRUMENT_PRESETS,normalizeInstrumentOptions} from "../src/instruments.js";
assert.deepEqual(normalizeInstrumentOptions({drumStyle:"loose",bassStyle:"picked",leadStyle:"blues"}),{drumStyle:"loose",bassStyle:"picked",leadStyle:"blues"});
assert.equal(normalizeInstrumentOptions({drumStyle:"nope"}).drumStyle,"studio");
assert.ok(INSTRUMENT_PRESETS.lead.includes("ambient"));
console.log("instrument preset tests passed");
