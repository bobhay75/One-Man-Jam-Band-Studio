import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, analyzeAudio, createPCMBuffer, enhanceAudio, finishAudio, encodeWav, makeDemoBuffer } from '../src/vocal-engine.js';

function make(channels = 1, length = 8000, rate = 8000, fill = () => 0) {
  const buffer = createPCMBuffer(channels, length, rate);
  for (let c = 0; c < channels; c++) for (let i = 0; i < length; i++) buffer.getChannelData(c)[i] = fill(i, c);
  return buffer;
}

test('analysis has accurate dimensions and finite measurements for silence', () => {
  const result = analyzeAudio(make(2));
  assert.equal(result.duration, 1);
  assert.equal(result.sampleRate, 8000);
  assert.equal(result.channelCount, 2);
  assert.equal(result.quietPercent, 100);
  assert.equal(result.clippedPercent, 0);
  for (const value of Object.values(result)) assert.ok(Number.isFinite(value));
});

test('analysis measures a known sine wave and records clipping/nonfinite data', () => {
  const buffer = make(1, 8000, 8000, i => 0.5 * Math.sin(2 * Math.PI * 200 * i / 8000));
  const result = analyzeAudio(buffer);
  assert.ok(Math.abs(result.peakDb + 6.0206) < 0.0001);
  assert.ok(Math.abs(result.rmsDb + 9.0309) < 0.0001);
  buffer.getChannelData(0)[0] = 2;
  buffer.getChannelData(0)[1] = NaN;
  assert.equal(analyzeAudio(buffer).nonFiniteSamples, 1);
  assert.equal(analyzeAudio(buffer).clippedPercent, 100 / 8000);
});

test('mix 0 is exact, immutable passthrough without requiring a browser', async () => {
  const source = make(2, 2048, 8000, (i, c) => Math.sin(i * (c + 1)) * 0.95);
  const original = source.getChannelData(0).slice();
  const result = await enhanceAudio(source, { mix: 0 });
  assert.notEqual(result.buffer, source);
  for (let c = 0; c < 2; c++) assert.deepEqual(result.buffer.getChannelData(c), source.getChannelData(c));
  assert.deepEqual(source.getChannelData(0), original);
});

test('silent enhancement remains silent for every preset', async () => {
  for (const preset of PRESETS) {
    const result = await enhanceAudio(make(), preset.settings);
    assert.ok(result.buffer.getChannelData(0).every(value => value === 0));
    assert.equal(result.analysisAfter.peakDb, -160);
  }
});

test('normalization preserves stereo relationship and enforces -1.2 dBFS ceiling', async () => {
  const source = make(2, 8000, 8000, (i, c) => Math.sin(i * 0.5) * (c === 0 ? 1.4 : 0.7));
  const rendered = make(2, 8000, 8000, (i, c) => source.getChannelData(c)[i]);
  await finishAudio(rendered, source, { level: 100, mix: 100 }, analyzeAudio(source));
  assert.ok(analyzeAudio(rendered).peakDb <= -1.19999);
  for (let i = 0; i < 8000; i++) assert.ok(Math.abs(rendered.getChannelData(0)[i] - rendered.getChannelData(1)[i] * 2) < 1e-7);
});

test('very quiet input is not boosted into a loud noise floor', async () => {
  const source = make(1, 8000, 8000, i => Math.sin(i) * 0.00001);
  const rendered = make(1, 8000, 8000, i => source.getChannelData(0)[i]);
  await finishAudio(rendered, source, { level: 100 }, analyzeAudio(source));
  assert.ok(analyzeAudio(rendered).peakDb <= -99.99);
});

test('nonfinite source data is sanitized before processing/export', async () => {
  const source = make(1, 4, 8000, i => [NaN, Infinity, -Infinity, 0.5][i]);
  const result = await enhanceAudio(source, { mix: 0 });
  assert.deepEqual([...result.buffer.getChannelData(0)], [0, 0, 0, 0.5]);
  const bytes = new DataView(await encodeWav(source).arrayBuffer());
  assert.equal(bytes.getInt16(44, true), 0);
  assert.equal(bytes.getInt16(46, true), 0);
  assert.equal(bytes.getInt16(48, true), 0);
});

test('WAV is interleaved 16-bit little-endian PCM with valid headers and clipping', async () => {
  const source = make(2, 3, 48000, (i, c) => [[-2, 0, 2], [0.5, -0.5, 0.25]][c][i]);
  const blob = encodeWav(source);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 56);
  const array = await blob.arrayBuffer();
  const view = new DataView(array);
  assert.equal(new TextDecoder().decode(array.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(array.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(4, true), 48);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 192000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, 16384, 0, -16384, 32767, 8192]);
});

test('unsupported multi-channel or over-length input fails clearly', async () => {
  await assert.rejects(enhanceAudio(make(3)), /mono or stereo/);
  await assert.rejects(enhanceAudio(make(1, 8000 * 301)), /5 minutes/);
  assert.throws(() => analyzeAudio({}), /could not be read/);
});

test('demo is deterministic, finite, nine seconds and unclipped', () => {
  const context = { sampleRate: 8000, createBuffer: createPCMBuffer };
  const demo = makeDemoBuffer(context);
  assert.equal(demo.duration, 9);
  assert.equal(demo.numberOfChannels, 1);
  assert.deepEqual(demo.getChannelData(0), makeDemoBuffer(context).getChannelData(0));
  assert.ok(demo.getChannelData(0).every(Number.isFinite));
  const stats = analyzeAudio(demo);
  assert.equal(stats.clippedPercent, 0);
  assert.ok(stats.peakDb > -30 && stats.peakDb < 0);
});

test('missing offline audio support produces a useful error', async () => {
  const source = make(1, 8000, 8000, i => 0.2 * Math.sin(i));
  await assert.rejects(enhanceAudio(source), /not supported in this browser/);
});
