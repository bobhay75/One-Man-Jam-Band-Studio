const NOTE_NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

export function frameRms(samples,start,size){
 let s=0,end=Math.min(samples.length,start+size); if(end<=start)return 0;
 for(let i=start;i<end;i++)s+=samples[i]*samples[i];
 return Math.sqrt(s/(end-start));
}
export function activityRegions(samples,sampleRate,{frameMs=50,threshold=0.018,minMs=180}={}){
 const size=Math.max(32,Math.round(sampleRate*frameMs/1000)); const out=[]; let open=null;
 for(let i=0;i<samples.length;i+=size){
   const active=frameRms(samples,i,size)>=threshold;
   if(active&&open===null)open=i;
   if(!active&&open!==null){if((i-open)/sampleRate*1000>=minMs)out.push([open/sampleRate,i/sampleRate]);open=null;}
 }
 if(open!==null)out.push([open/sampleRate,samples.length/sampleRate]);
 return out.map(([start,end])=>({startSec:+start.toFixed(2),endSec:+end.toFixed(2),kind:"audio"}));
}
function corr(a,b){let am=0,bm=0;for(let i=0;i<12;i++){am+=a[i];bm+=b[i]}am/=12;bm/=12;
 let n=0,da=0,db=0;for(let i=0;i<12;i++){const x=a[i]-am,y=b[i]-bm;n+=x*y;da+=x*x;db+=y*y}return n/Math.sqrt(da*db||1)}
function rotateProfile(profile,root){return Array.from({length:12},(_,i)=>profile[(i-root+12)%12])}
export function inferKeyFromChroma(chroma){
 if(!chroma||chroma.length!==12)return null; let best={score:-Infinity,key:null};
 for(let r=0;r<12;r++)for(const [mode,p] of [["major",MAJOR],["minor",MINOR]]){
   const score=corr(chroma,rotateProfile(p,r)); if(score>best.score)best={score,key:`${NOTE_NAMES[r]} ${mode}`};
 }
 return {key:best.key,confidence:+Math.max(0,best.score).toFixed(3)};
}
export function estimateTempo(samples,sampleRate){
 const hop=Math.max(64,Math.round(sampleRate*0.01)),env=[];
 for(let i=0;i<samples.length;i+=hop)env.push(frameRms(samples,i,hop));
 const onset=env.map((v,i)=>Math.max(0,v-(env[i-1]||0)));
 let bestLag=0,best=-Infinity; const min=Math.floor(60/(180*hop/sampleRate)),max=Math.ceil(60/(55*hop/sampleRate));
 for(let lag=min;lag<=max;lag++){let s=0;for(let i=lag;i<onset.length;i++)s+=onset[i]*onset[i-lag];if(s>best){best=s;bestLag=lag}}
 return bestLag?+(60/(bestLag*hop/sampleRate)).toFixed(1):null;
}
function coarseChroma(samples,sampleRate){
 const bins=new Array(12).fill(0),N=2048,step=4096,maxFrames=160;
 let frames=0; for(let start=0;start+N<samples.length&&frames<maxFrames;start+=step,frames++){
  for(let midi=40;midi<=76;midi++){const f=440*Math.pow(2,(midi-69)/12),w=2*Math.PI*f/sampleRate;let re=0,im=0;
   for(let n=0;n<N;n++){const x=samples[start+n];re+=x*Math.cos(w*n);im-=x*Math.sin(w*n)}
   bins[midi%12]+=re*re+im*im;
  }
 } return bins;
}
export async function analyzeAudioBuffer(audioBuffer){
 const ch=audioBuffer.getChannelData(0); let peak=0,sum=0;
 for(const x of ch){const a=Math.abs(x);if(a>peak)peak=a;sum+=x*x}
 const chroma=coarseChroma(ch,audioBuffer.sampleRate),key=inferKeyFromChroma(chroma);
 const regions=activityRegions(ch,audioBuffer.sampleRate);
 return {durationSec:+audioBuffer.duration.toFixed(2),sampleRate:audioBuffer.sampleRate,channels:audioBuffer.numberOfChannels,
 peak:+peak.toFixed(4),rms:+Math.sqrt(sum/ch.length).toFixed(4),tempoBpm:estimateTempo(ch,audioBuffer.sampleRate),
 keyEstimate:key,activityRegions:regions,
 speechReview:{status:"human-review-required",message:"Active regions are detected locally. Speech/music classification must be reviewed before accompaniment generation."}};
}