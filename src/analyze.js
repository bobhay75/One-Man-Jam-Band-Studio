export async function analyzeAudioBuffer(audioBuffer) {
  const ch = audioBuffer.getChannelData(0);
  let peak = 0, sum = 0;
  for (const x of ch) {
    const a = Math.abs(x);
    if (a > peak) peak = a;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / ch.length);
  return {
    durationSec: Number(audioBuffer.duration.toFixed(2)),
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    peak: Number(peak.toFixed(4)),
    rms: Number(rms.toFixed(4)),
    note: "Tempo/key/chord segmentation adapters pending.",
    speechDetection: "Scaffolded: do not generate accompaniment across flagged speech regions."
  };
}
