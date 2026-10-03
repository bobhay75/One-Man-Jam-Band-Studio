export function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = buffer.length - 1, threshold = 0.2;
  for (let i = 0; i < buffer.length / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
  }
  for (let i = 1; i < buffer.length / 2; i++) {
    if (Math.abs(buffer[buffer.length - i]) < threshold) { r2 = buffer.length - i; break; }
  }
  buffer = buffer.slice(r1, r2);

  const c = new Array(buffer.length).fill(0);
  for (let lag = 0; lag < buffer.length; lag++) {
    for (let i = 0; i < buffer.length - lag; i++) c[lag] += buffer[i] * buffer[i + lag];
  }

  let d = 0;
  while (d + 1 < c.length && c[d] > c[d + 1]) d++;
  let maxVal = -1, maxPos = -1;
  for (let i = d; i < c.length; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  const x1 = c[maxPos - 1] ?? c[maxPos];
  const x2 = c[maxPos];
  const x3 = c[maxPos + 1] ?? c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const shift = a ? -b / (2 * a) : 0;
  return sampleRate / (maxPos + shift);
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
  return Math.floor(1200 * Math.log(freq / ref) / Math.log(2));
}
