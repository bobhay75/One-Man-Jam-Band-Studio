import {isBlocked} from "./regions.js";
const NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const ROOTS=Object.fromEntries(NAMES.map((n,i)=>[n,i]));

function seeded(seed=1){let x=(seed>>>0)||1;return ()=>((x=Math.imul(1664525,x)+1013904223>>>0)/4294967296)}
export function parseKey(key="C major"){
  const [name,mode="major"]=String(key).split(/\s+/);
  return {root:ROOTS[name]??0,mode:mode==="minor"?"minor":"major"};
}
export function parseChord(label="C"){
  const m=String(label).match(/^([A-G](?:#)?)(m)?$/);
  if(!m)return {root:0,mode:"major"};
  return {root:ROOTS[m[1]]??0,mode:m[2]?"minor":"major"};
}
function chordAt(time,timeline,fallback){
  const hit=timeline?.find(r=>time>=r.startSec&&time<r.endSec);
  return hit?{...parseChord(hit.chord),label:hit.chord}:{...fallback,label:null};
}
export function buildArrangement({bpm=120,durationSec=60,key="C major",seed=1,chordTimeline=[],muteRegions=[]}={}){
  const beat=60/Math.max(40,Math.min(220,bpm||120)),bars=Math.max(1,Math.ceil(durationSec/(beat*4)));
  const keyInfo=parseKey(key),prog=keyInfo.mode==="minor"?[0,8,3,10]:[0,7,9,5],rnd=seeded(seed);
  const drums=[],bass=[],lead=[];
  for(let bar=0;bar<bars;bar++){
    const generic={root:(keyInfo.root+prog[bar%prog.length])%12,mode:keyInfo.mode};
    for(let b=0;b<4;b++){
      const t=(bar*4+b)*beat;if(t>=durationSec)break;
      if(isBlocked(t,muteRegions))continue;
      const chord=chordAt(t,chordTimeline,generic),root=chord.root;
      // Four-on-the-floor kick/2-and-4 snare, with an eighth-note hat grid.
      // Every event is derived from the same beat clock as the bass and lead.
      if(b===0||b===2)drums.push({time:t,duration:.08,kind:"kick",velocity:b===0?1:.82});
      if(b===1||b===3)drums.push({time:t,duration:.1,kind:"snare",velocity:.72});
      drums.push({time:t,duration:.025,kind:"hat",velocity:.26});
      const half=t+beat/2;
      if(half<durationSec&&!isBlocked(half,muteRegions))drums.push({time:half,duration:.02,kind:"hat",velocity:.18});
      bass.push({time:t,duration:beat*.72,midi:36+root,velocity:b===0?.72:.58,chord:chord.label});
      if((b===1||b===3)&&t+beat*.5<durationSec&&!isBlocked(t+beat*.5,muteRegions)){
        const fifth=(root+7)%12;bass.push({time:t+beat*.5,duration:beat*.36,midi:36+fifth,velocity:.42,chord:chord.label});
      }
      if(b===1||b===3){
        const chordTones=chord.mode==="minor"?[0,3,7,10]:[0,4,7,9],degree=chordTones[(bar+b)%chordTones.length];
        lead.push({
          time:t+beat*.08,
          duration:beat*.62,
          midi:60+((root+degree)%12),
          velocity:.24,
          bendSemitones:0,
          chord:chord.label
        });
      }
    }
  }
  return {bpm,beatSec:beat,bars,key,durationSec,drums,bass,lead,seed,chordAware:chordTimeline.length>0,muteRegions};
}
