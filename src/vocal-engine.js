/**
 * VocalLift's local-only audio engine. No network calls, models, or dependencies.
 * Enhancement changes tone/dynamics; it does not correct pitch or separate voices.
 * Public API: PRESETS, analyzeAudio, enhanceAudio, encodeWav (returns a Blob),
 * and makeDemoBuffer. Progress callbacks receive (fraction, stage).
 */

export const PRESETS = Object.freeze([
  { id: 'natural', name: 'Natural', description: 'A little polish. Still unmistakably you.', settings: { cleanup: 28, warmth: 35, clarity: 32, level: 44, space: 5, mix: 100 } },
  { id: 'spoken', name: 'Spoken word', description: 'Clear, even speech for stories and voiceovers.', settings: { cleanup: 48, warmth: 30, clarity: 58, level: 74, space: 0, mix: 100 } },
  { id: 'singing', name: 'Singing', description: 'Fuller tone and a touch of room around your vocal.', settings: { cleanup: 18, warmth: 50, clarity: 40, level: 52, space: 32, mix: 100 } },
  { id: 'intimate', name: 'Warm & intimate', description: 'A softer, close-up sound with gentle space.', settings: { cleanup: 25, warmth: 78, clarity: 20, level: 60, space: 20, mix: 100 } },
].map(preset => Object.freeze({ ...preset, settings: Object.freeze(preset.settings) })));

const CEILING = 10 ** (-1.2 / 20);
const MIN_DB = -160;
const CHUNK_SIZE = 262144;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = value => Number.isFinite(value) ? value : 0;
const toDb = value => value > 1e-8 ? 20 * Math.log10(value) : MIN_DB;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const smoothstep = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

function validateBuffer(buffer) {
  if (!buffer || !Number.isInteger(buffer.length) || buffer.length < 1 ||
      !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8000 ||
      typeof buffer.getChannelData !== 'function') {
    throw new Error('This audio could not be read. Try a WAV, MP3, M4A, or WebM recording.');
  }
}

function normalizeSettings(settings = {}) {
  const defaults = PRESETS[0].settings;
  return Object.fromEntries(Object.keys(defaults).map(key => [key,
    clamp(Number.isFinite(Number(settings[key])) ? Number(settings[key]) : defaults[key], 0, 100)
  ]));
}

/** The plain buffer fallback is useful for deterministic, browser-free DSP tests. */
export function createPCMBuffer(numberOfChannels, length, sampleRate) {
  if (typeof globalThis.AudioBuffer === 'function') {
    return new globalThis.AudioBuffer({ numberOfChannels, length, sampleRate });
  }
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return {
    numberOfChannels, length, sampleRate, duration: length / sampleRate,
    getChannelData(channel) {
      if (!channels[channel]) throw new RangeError('Audio channel does not exist.');
      return channels[channel];
    },
    copyToChannel(source, channel, offset = 0) { channels[channel].set(source.subarray(0, length - offset), offset); },
    copyFromChannel(destination, channel, offset = 0) { destination.set(channels[channel].subarray(offset, offset + destination.length)); },
  };
}

function copyBuffer(buffer, factory = createPCMBuffer) {
  const copy = factory(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c);
    const target = copy.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) target[i] = finite(source[i]);
  }
  return copy;
}

/** Measurements are signal levels, not perceptual quality scores or LUFS. */
export function analyzeAudio(buffer) {
  validateBuffer(buffer);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const blockSize = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const blocks = [];
  let peak = 0, sum = 0, clipped = 0, nonFinite = 0;
  for (let start = 0; start < buffer.length; start += blockSize) {
    const end = Math.min(buffer.length, start + blockSize);
    let blockSum = 0;
    for (let c = 0; c < channels.length; c++) {
      for (let i = start; i < end; i++) {
        const value = channels[c][i];
        if (!Number.isFinite(value)) nonFinite++;
        const sample = finite(value);
        const magnitude = Math.abs(sample);
        peak = Math.max(peak, magnitude);
        if (magnitude >= 0.999) clipped++;
        blockSum += sample * sample;
      }
    }
    sum += blockSum;
    blocks.push({ rms: Math.sqrt(blockSum / ((end - start) * channels.length)), samples: (end - start) * channels.length });
  }
  const count = buffer.length * channels.length;
  const sorted = blocks.map(block => block.rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * 0.12)] || 0;
  const high = sorted[Math.floor((sorted.length - 1) * 0.90)] || 0;
  const activeThreshold = Math.max(0.00316, high * 0.15);
  let activeSum = 0, activeCount = 0, quiet = 0;
  for (const block of blocks) {
    if (block.rms <= 0.00316) quiet += block.samples;
    if (block.rms >= activeThreshold) {
      activeSum += block.rms * block.rms * block.samples;
      activeCount += block.samples;
    }
  }
  return {
    duration: buffer.length / buffer.sampleRate,
    sampleRate: buffer.sampleRate,
    channelCount: buffer.numberOfChannels,
    peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / count)),
    activeRmsDb: toDb(activeCount ? Math.sqrt(activeSum / activeCount) : Math.sqrt(sum / count)),
    clippedPercent: clipped / count * 100,
    quietPercent: quiet / count * 100,
    noiseFloorDb: toDb(floor), dynamicRangeDb: Math.max(0, toDb(high) - toDb(floor)),
    nonFiniteSamples: nonFinite,
  };
}

async function expandQuietParts(buffer, amount, analysis, report) {
  // A low percentile is only useful as a floor when the clip contains pauses.
  // Continuous singing/noise is left alone instead of being mistaken for silence.
  const floor = 10 ** (analysis.noiseFloorDb / 20);
  if (amount <= 0 || floor < 1e-6 || floor > 0.025 || analysis.dynamicRangeDb < 8) return false;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const minGain = 10 ** (-(3 + 13 * amount) / 20);
  const openCoefficient = Math.exp(-1 / (buffer.sampleRate * 0.003));
  const closeCoefficient = Math.exp(-1 / (buffer.sampleRate * 0.100));
  const rmsCoefficient = Math.exp(-1 / (buffer.sampleRate * 0.012));
  let envelope = floor * floor, gain = 1;
  for (let start = 0; start < buffer.length; start += CHUNK_SIZE) {
    const end = Math.min(buffer.length, start + CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      let energy = 0;
      for (const channel of channels) energy += channel[i] * channel[i];
      envelope = rmsCoefficient * envelope + (1 - rmsCoefficient) * energy / channels.length;
      const openness = smoothstep((Math.sqrt(envelope) - floor * 0.80) / (floor * 1.85));
      const target = minGain + (1 - minGain) * openness;
      const coefficient = target > gain ? openCoefficient : closeCoefficient;
      gain = coefficient * gain + (1 - coefficient) * target;
      for (const channel of channels) channel[i] *= gain;
    }
    report(0.08 + 0.17 * end / buffer.length, 'Softening noise in quiet passages');
    await pause();
  }
  return true;
}

function createRoomImpulse(context, amount) {
  const length = Math.ceil(context.sampleRate * (0.22 + amount * 0.38));
  const impulse = context.createBuffer(1, length, context.sampleRate);
  const data = impulse.getChannelData(0);
  let seed = 936271, smoothed = 0;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 4294967296 * 2 - 1;
    smoothed = 0.55 * smoothed + 0.45 * noise;
    if (i > context.sampleRate * 0.012) data[i] = smoothed * Math.exp(-7 * i / length);
  }
  return impulse;
}

async function compressInPlace(buffer, amount, report) {
  if (amount <= 0) return;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const threshold = -13 - amount * 13;
  const ratio = 1 + amount * 2.3;
  const knee = 12;
  const attack = Math.exp(-1 / (buffer.sampleRate * 0.008));
  const release = Math.exp(-1 / (buffer.sampleRate * 0.150));
  let envelope = 0;
  for (let start = 0; start < buffer.length; start += CHUNK_SIZE) {
    const end = Math.min(buffer.length, start + CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      let peak = 0;
      for (const channel of channels) peak = Math.max(peak, Math.abs(finite(channel[i])));
      const coefficient = peak > envelope ? attack : release;
      envelope = coefficient * envelope + (1 - coefficient) * peak;
      const difference = toDb(envelope) - threshold;
      let gainDb = 0;
      if (difference > knee / 2) gainDb = (1 / ratio - 1) * difference;
      else if (difference > -knee / 2) gainDb = (1 / ratio - 1) * (difference + knee / 2) ** 2 / (2 * knee);
      const gain = 10 ** (gainDb / 20);
      for (const channel of channels) channel[i] = finite(channel[i]) * gain;
    }
    report(0.60 + 0.15 * end / buffer.length, 'Balancing loud and quiet phrases');
    await pause();
  }
}

/** Linked-channel normalization and peak protection, exported for numerical tests. */
export async function finishAudio(wet, dry, settings, before, report = () => {}) {
  const values = normalizeSettings(settings);
  const after = analyzeAudio(wet);
  const amount = values.level / 100;
  const targetDb = -22 + amount * 4;
  let gainDb = clamp(targetDb - after.activeRmsDb, -6 * amount, 8 * amount);
  if (before.peakDb < -45) gainDb = Math.min(gainDb, 3);
  if (before.peakDb < -70) gainDb = 0;
  const gain = 10 ** (gainDb / 20);
  const blend = values.mix / 100;
  const wetChannels = Array.from({ length: wet.numberOfChannels }, (_, c) => wet.getChannelData(c));
  const dryChannels = Array.from({ length: dry.numberOfChannels }, (_, c) => dry.getChannelData(c));
  let peak = 0;
  for (let start = 0; start < wet.length; start += CHUNK_SIZE) {
    const end = Math.min(wet.length, start + CHUNK_SIZE);
    for (let c = 0; c < wetChannels.length; c++) {
      for (let i = start; i < end; i++) {
        const value = finite(wetChannels[c][i]) * gain * blend + finite(dryChannels[c][i]) * (1 - blend);
        wetChannels[c][i] = value;
        peak = Math.max(peak, Math.abs(value));
      }
    }
    report(0.77 + 0.12 * end / wet.length, 'Setting a comfortable output level');
    await pause();
  }
  if (peak > CEILING) {
    const safeGain = CEILING / peak;
    for (const channel of wetChannels) {
      for (let start = 0; start < wet.length; start += CHUNK_SIZE) {
        const end = Math.min(wet.length, start + CHUNK_SIZE);
        for (let i = start; i < end; i++) channel[i] *= safeGain;
        await pause();
      }
    }
  }
  return wet;
}

export async function enhanceAudio(buffer, settings = {}, onProgress = () => {}) {
  validateBuffer(buffer);
  if (buffer.numberOfChannels > 2) throw new Error('Use a mono or stereo recording for this version.');
  if (buffer.length / buffer.sampleRate > 300.05) throw new Error('Choose a clip up to 5 minutes long.');
  const values = normalizeSettings(settings);
  const report = (fraction, label) => { if (typeof onProgress === 'function') onProgress(clamp(fraction, 0, 1), label); };
  report(0.02, 'Listening to the recording');
  await pause();
  const analysisBefore = analyzeAudio(buffer);
  if (values.mix === 0 || analysisBefore.peakDb <= MIN_DB) {
    const copy = copyBuffer(buffer);
    report(1, 'Ready');
    return { buffer: copy, analysisBefore, analysisAfter: analyzeAudio(copy), changes: [values.mix === 0 ? 'Original audio preserved at 0% effect mix.' : 'Silent recording preserved.'] };
  }
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('Audio enhancement is not supported in this browser. Open VocalLift in a recent Chrome, Edge, Firefox, or Safari browser.');
  const context = new Offline(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const prepared = copyBuffer(buffer, (channels, length, sampleRate) => context.createBuffer(channels, length, sampleRate));
  const expanded = await expandQuietParts(prepared, values.cleanup / 100, analysisBefore, report);
  report(0.28, 'Shaping your vocal tone');
  const source = context.createBufferSource();
  source.buffer = prepared;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 50 + values.cleanup * 0.40;
  highpass.Q.value = Math.SQRT1_2;
  const warmth = context.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 190;
  warmth.gain.value = values.warmth * 0.045;
  const clarity = context.createBiquadFilter();
  clarity.type = 'peaking';
  clarity.frequency.value = Math.min(3100, buffer.sampleRate * 0.38);
  clarity.Q.value = 0.85;
  clarity.gain.value = values.clarity * 0.040;
  const softness = context.createBiquadFilter();
  softness.type = 'highshelf';
  softness.frequency.value = Math.min(7400, buffer.sampleRate * 0.42);
  softness.gain.value = -values.cleanup * 0.018;
  source.connect(highpass).connect(warmth).connect(clarity).connect(softness);
  softness.connect(context.destination);
  if (values.space > 0) {
    const room = context.createConvolver();
    room.buffer = createRoomImpulse(context, values.space / 100);
    const roomGain = context.createGain();
    roomGain.gain.value = values.space / 100 * 0.36;
    softness.connect(room).connect(roomGain).connect(context.destination);
  }
  source.start(0);
  report(0.35, 'Rendering your sound on this device');
  const rendered = await context.startRendering();
  report(0.60, 'Balancing the vocal');
  await pause();
  await compressInPlace(rendered, values.level / 100, report);
  await finishAudio(rendered, buffer, values, analysisBefore, report);
  const analysisAfter = analyzeAudio(rendered);
  const changes = ['Reduced low-frequency rumble', 'Kept the original timing, pitch, and channels'];
  if (expanded) changes.push('Softened background noise during quieter passages');
  if (values.warmth > 0) changes.push('Added low-mid warmth');
  if (values.clarity > 0) changes.push('Added vocal presence');
  if (values.level > 0) changes.push('Smoothed loudness changes');
  if (values.space > 0) changes.push('Added short room ambience');
  changes.push('Kept sample peaks below −1 dBFS');
  if (analysisBefore.clippedPercent > 0.01) changes.push('Existing distortion in the source cannot be recovered');
  report(1, 'Your audio is ready');
  return { buffer: rendered, analysisBefore, analysisAfter, changes };
}

/** Encode little-endian, interleaved 16-bit PCM WAV. No lossy codec required. */
export function encodeWav(buffer) {
  validateBuffer(buffer);
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  if (bytes + 36 > 0xffffffff) throw new Error('This recording is too large for a WAV file.');
  const data = new ArrayBuffer(44 + bytes);
  const view = new DataView(data);
  const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeText(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); writeText(8, 'WAVE');
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  writeText(36, 'data'); view.setUint32(40, bytes, true);
  const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = clamp(finite(channelData[c][i]), -1, 1);
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}

/** A clearly synthetic vowel melody, not a human testimonial or demo recording. */
export function makeDemoBuffer(context) {
  if (!context || typeof context.createBuffer !== 'function') throw new Error('An audio context is required for the demo.');
  const sampleRate = context.sampleRate;
  const duration = 9;
  const buffer = context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const notes = [164.81, 196.00, 220.00, 196.00, 174.61, 164.81];
  let phase = 0, seed = 337, noiseLP = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const relative = t - 0.6;
    const noteIndex = Math.floor(relative / 1.25);
    const within = relative - noteIndex * 1.25;
    let vocal = 0;
    if (noteIndex >= 0 && noteIndex < notes.length && within < 1.04) {
      const frequency = notes[noteIndex] * (1 + 0.009 * Math.sin(t * Math.PI * 10));
      phase += Math.PI * 2 * frequency / sampleRate;
      const envelope = smoothstep(within / 0.075) * smoothstep((1.04 - within) / 0.20);
      for (let h = 1; h <= 22; h++) {
        const hz = frequency * h;
        const formant = 0.15 + 1.1 * Math.exp(-(((hz - 740) / 210) ** 2)) + 0.45 * Math.exp(-(((hz - 1240) / 250) ** 2));
        vocal += Math.sin(phase * h) * formant / h;
      }
      vocal *= envelope * [0.14, 0.25, 0.11, 0.28, 0.17, 0.12][noteIndex];
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296 * 2 - 1) * 0.004;
    noiseLP = 0.94 * noiseLP + 0.06 * noise;
    const edge = smoothstep(t / 0.025) * smoothstep((duration - t) / 0.05);
    data[i] = (vocal + noise + noiseLP * 2 + 0.008 * Math.sin(2 * Math.PI * 48 * t)) * edge;
  }
  return buffer;
}
