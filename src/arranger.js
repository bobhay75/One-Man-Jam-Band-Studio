const NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const ROOTS=Object.fromEntries(NAMES.map((n,i)=>[n,i]));

function seeded(seed=1){
  let x=(seed>>>0)||1;
  return ()=>((x=Math.imul(1664525,x)+1013904223>>>0)/4294967296);
}
export function parseKey(key="C major"){
  const [name,mode="major"]=String(key).split(/\s+/);
  return {root:ROOTS[name]??0,mode:mode==="minor"?"minor":"major"};
}
export function buildArrangement({bpm=120,durationSec=60,key="C major",seed=1}={}){
  const beat=60/Math.max(40,Math.min(220,bpm||120));
  const bars=Math.max(1,Math.ceil(durationSec/(beat*4)));
  const {root,mode}=parseKey(key);
  const prog=mode==="minor"?[0,8,3,10]:[0,7,9,5]; // i-VI-III-VII / I-V-vi-IV pitch classes
  const rnd=seeded(seed);
  const drums=[],bass=[],lead=[];
  for(let bar=0;bar<bars;bar++){
    const chordPc=(root+prog[bar%prog.length])%12;
    for(let b=0;b<4;b++){
      const t=(bar*4+b)*beat;
      if(t>=durationSec)break;
      drums.push({time:t,duration:.08,kind:b===0||b===2?"kick":"snare",velocity:b===0?1:.8});
      drums.push({time:t,duration:.025,kind:"hat",velocity:.35});
      const bt=t+beat/2;
      if(bt<durationSec)drums.push({time:bt,duration:.02,kind:"hat",velocity:.25});
      bass.push({time:t,duration:beat*.8,midi:36+chordPc,velocity:.65});
      if(b===1||b===3){
        const scale=mode==="minor"?[0,3,5,7,10]:[0,2,4,7,9];
        const degree=scale[Math.floor(rnd()*scale.length)];
        lead.push({time:t+beat*.25,duration:beat*.45,midi:60+((root+degree)%12),velocity:.38});
      }
    }
  }
  return {bpm,beatSec:beat,bars,key,durationSec,drums,bass,lead,seed};
}
