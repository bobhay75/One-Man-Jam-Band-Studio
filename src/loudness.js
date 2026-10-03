function db(x){return x>0?20*Math.log10(x):-Infinity}
export function estimateTruePeak(channels,oversample=4){
  let peak=0;
  for(const ch of channels){
    for(let i=0;i<ch.length-1;i++){
      const a=ch[i],b=ch[i+1];
      peak=Math.max(peak,Math.abs(a),Math.abs(b));
      for(let k=1;k<oversample;k++){
        const x=a+(b-a)*(k/oversample);peak=Math.max(peak,Math.abs(x));
      }
    }
  }
  return {linear:peak,dbTP:+db(peak).toFixed(2),method:`${oversample}x interpolated estimate`};
}
export function estimateIntegratedLoudness(channels,sampleRate){
  if(!channels?.length||!sampleRate)return {lufs:null,method:"RMS-gated estimate"};
  const n=channels[0].length,block=Math.max(1,Math.round(sampleRate*.4)),hop=Math.max(1,Math.round(block/4));
  const energies=[];
  for(let start=0;start+block<=n;start+=hop){
    let sum=0,count=0;
    for(const ch of channels)for(let i=start;i<start+block;i++){sum+=ch[i]*ch[i];count++}
    const mean=count?sum/count:0;
    const lufs=mean>0?-0.691+10*Math.log10(mean):-Infinity;
    if(lufs>-70)energies.push({mean,lufs});
  }
  if(!energies.length)return {lufs:-Infinity,method:"RMS-gated estimate"};
  const absMean=energies.reduce((s,e)=>s+e.mean,0)/energies.length;
  const absL=-0.691+10*Math.log10(absMean);
  const gate=absL-10,kept=energies.filter(e=>e.lufs>gate);
  const mean=(kept.length?kept:energies).reduce((s,e)=>s+e.mean,0)/(kept.length||energies.length);
  return {lufs:+(-0.691+10*Math.log10(mean)).toFixed(1),method:"400 ms gated RMS loudness estimate"};
}
