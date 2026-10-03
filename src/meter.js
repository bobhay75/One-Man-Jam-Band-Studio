export function measureChannels(channels){
  let peak=0,sum=0,count=0;
  for(const ch of channels)for(const x of ch){const a=Math.abs(x);if(a>peak)peak=a;sum+=x*x;count++}
  const rms=count?Math.sqrt(sum/count):0;
  return {peak:+peak.toFixed(4),rms:+rms.toFixed(4),peakDb:peak?+(20*Math.log10(peak)).toFixed(1):-Infinity,rmsDb:rms?+(20*Math.log10(rms)).toFixed(1):-Infinity};
}
export function measureAudioBuffer(buffer){return measureChannels(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)))}
