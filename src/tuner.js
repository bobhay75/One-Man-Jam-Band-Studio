// Bounded YIN difference detector. Downsample to about 22–24 kHz so microphone
// analysis stays small; the supported chromatic range is 55–1400 Hz.
export const TUNER_INTERVAL_MS = 100;
export function autoCorrelate(buffer, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || buffer.length < 128) return -1;
  const stride = Math.max(1, Math.floor(sampleRate / 22050));
  const rate = sampleRate / stride, length = Math.floor(buffer.length / stride);
  const samples = new Float32Array(length);
  let mean = 0;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += buffer[i * stride + j];
    samples[i] = sum / stride; mean += samples[i];
  }
  mean /= length;
  let energy = 0;
  for (let i = 0; i < length; i++) { samples[i] -= mean; energy += samples[i] ** 2; }
  if (!Number.isFinite(energy) || Math.sqrt(energy / length) < .003) return -1;
  const minLag = Math.max(2, Math.floor(rate / 1400));
  const maxLag = Math.min(Math.ceil(rate / 55), Math.floor(length / 2));
  const window = length - maxLag - 1, difference = new Float64Array(maxLag + 1);
  let total = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) sum += (samples[i] - samples[i + lag]) ** 2;
    total += sum; difference[lag] = total > 0 ? sum * lag / total : 1;
  }
  // First confident trough selects the fundamental rather than a later octave.
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] >= .12) continue;
    while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
    const left = difference[lag - 1], mid = difference[lag], right = difference[lag + 1];
    const curvature = left - 2 * mid + right;
    const shift = curvature ? Math.max(-.5, Math.min(.5, (left - right) / (2 * curvature))) : 0;
    const frequency = rate / (lag + shift);
    return frequency >= 55 && frequency <= 1400 ? frequency : -1;
  }
  return -1;
}

export function frequencyToNote(freq) {
  const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
}

export function noteName(note) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return names[note % 12] + (Math.floor(note / 12) - 1);
}

export function centsOff(freq, note) {
  const ref = 440 * Math.pow(2, (note - 69) / 12);
  return Math.round(1200 * Math.log(freq / ref) / Math.log(2));
}
export function tunerState(cents, tolerance = 5) {
  if (!Number.isFinite(cents)) return "waiting";
  if (Math.abs(cents) <= tolerance) return "in-tune";
  return cents < 0 ? "flat" : "sharp";
}

// Time is supplied by the caller, making stability and dropout behavior testable.
export function createTunerTracker() {
  let history = [], reading = null, candidate = null, count = 0, lastValid = -Infinity;
  return {
    update(frequency, now) {
      if (!(frequency >= 55 && frequency <= 1400)) {
        candidate = null; count = 0; history = [];
        if (now - lastValid > 350) reading = null;
        return reading;
      }
      lastValid = now;
      const pitch = 69 + 12 * Math.log2(frequency / 440);
      history.push(pitch); if (history.length > 3) history.shift();
      const median = [...history].sort((a, b) => a - b)[Math.floor(history.length / 2)];
      const note = Math.round(median);
      if (!reading || note !== reading.note) {
        count = candidate === note ? count + 1 : 1; candidate = note;
        if (count < 3) return reading;
        reading = { note, pitch: median, state: "waiting" };
      } else {
        candidate = null; count = 0;
        reading = { ...reading, pitch: reading.pitch + .45 * (median - reading.pitch) };
      }
      const cents = Math.round((reading.pitch - reading.note) * 100);
      const tolerance = reading.state === "in-tune" ? 7 : 4;
      const state = tunerState(cents, tolerance);
      reading = { ...reading, cents, state, frequency: 440 * 2 ** ((reading.pitch - 69) / 12) };
      return reading;
    }
  };
}
