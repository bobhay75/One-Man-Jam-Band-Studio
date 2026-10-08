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
export function inferChordFromChroma(chroma){
 if(!chroma||chroma.length!==12)return null;
 const total=chroma.reduce((a,b)=>a+b,0)||1; let best={score:-Infinity,label:null,root:0,mode:"major"};
 for(let root=0;root<12;root++)for(const mode of ["major","minor"]){
   const third=(root+(mode==="major"?4:3))%12,fifth=(root+7)%12;
   const chord=chroma[root]+chroma[third]+chroma[fifth];
   const score=chord/total;
   if(score>best.score)best={score,label:NOTE_NAMES[root]+(mode==="minor"?"m":""),root,mode};
 }
 return {...best,confidence:+best.score.toFixed(3)};
}
export function estimateTempo(samples,sampleRate){
 const hop=Math.max(64,Math.round(sampleRate*0.01)),env=[];
 for(let i=0;i<samples.length;i+=hop)env.push(frameRms(samples,i,hop));
 const onset=env.map((v,i)=>Math.max(0,v-(env[i-1]||0)));
 let bestLag=0,best=-Infinity; const min=Math.floor(60/(180*hop/sampleRate)),max=Math.ceil(60/(55*hop/sampleRate));
 for(let lag=min;lag<=max;lag++){let s=0;for(let i=lag;i<onset.length;i++)s+=onset[i]*onset[i-lag];if(s>best){best=s;bestLag=lag}}
 return bestLag&&best>1e-10?+(60/(bestLag*hop/sampleRate)).toFixed(1):null;
}
function goertzel(samples,start,length,sampleRate,freq){
 const coeff=2*Math.cos(2*Math.PI*freq/sampleRate);let s0=0,s1=0,s2=0;
 const end=Math.min(samples.length,start+length);
 for(let i=start;i<end;i++){s0=samples[i]+coeff*s1-s2;s2=s1;s1=s0}
 return Math.max(0,s1*s1+s2*s2-coeff*s1*s2);
}
function windowChroma(samples,sampleRate,start,length){
 const bins=new Array(12).fill(0);
 for(let midi=40;midi<=76;midi++){
   const f=440*Math.pow(2,(midi-69)/12);
   bins[midi%12]+=goertzel(samples,start,length,sampleRate,f);
 }
 return bins;
}
function coarseChroma(samples,sampleRate){
 const out=new Array(12).fill(0),N=Math.min(4096,samples.length),step=Math.max(N,Math.floor(samples.length/120));
 for(let start=0;start+N<=samples.length;start+=step){
   const c=windowChroma(samples,sampleRate,start,N);for(let i=0;i<12;i++)out[i]+=c[i];
 }
 return out;
}
export function estimateChordTimeline(samples,sampleRate,{windowSec=1.5,stepSec=1.5}={}){
 const N=Math.max(1024,Math.round(sampleRate*windowSec)),step=Math.max(512,Math.round(sampleRate*stepSec)),raw=[];
 for(let start=0;start<samples.length;start+=step){
   if(frameRms(samples,start,Math.min(N,samples.length-start))<0.01)continue;
   const chord=inferChordFromChroma(windowChroma(samples,sampleRate,start,Math.min(N,samples.length-start)));
   if(chord)raw.push({startSec:+(start/sampleRate).toFixed(2),endSec:+(Math.min(samples.length,start+step)/sampleRate).toFixed(2),chord:chord.label,confidence:chord.confidence,root:chord.root,mode:chord.mode});
 }
 const merged=[];
 for(const r of raw){
   const prev=merged.at(-1);
   if(prev&&prev.chord===r.chord&&Math.abs(prev.endSec-r.startSec)<.02){prev.endSec=r.endSec;prev.confidence=+((prev.confidence+r.confidence)/2).toFixed(3)}
   else merged.push({...r});
 }
 return merged;
}
export async function analyzeAudioBuffer(audioBuffer){
 const ch=audioBuffer.getChannelData(0); let peak=0,sum=0;
 for(const x of ch){const a=Math.abs(x);if(a>peak)peak=a;sum+=x*x}
 const chroma=coarseChroma(ch,audioBuffer.sampleRate),key=inferKeyFromChroma(chroma);
 const regions=activityRegions(ch,audioBuffer.sampleRate);
 return {durationSec:+audioBuffer.duration.toFixed(2),sampleRate:audioBuffer.sampleRate,channels:audioBuffer.numberOfChannels,
 peak:+peak.toFixed(4),rms:+Math.sqrt(sum/ch.length).toFixed(4),tempoBpm:estimateTempo(ch,audioBuffer.sampleRate),
 keyEstimate:key,chordTimeline:estimateChordTimeline(ch,audioBuffer.sampleRate),activityRegions:regions,
 speechReview:{status:"human-review-required",message:"Chord/audio regions are inferred locally. Speech/music ambiguity must be reviewed before final accompaniment."}};
}
