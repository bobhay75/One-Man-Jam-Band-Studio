const DEFAULT_PRODUCTION={drumStyle:"studio",bassStyle:"round",leadStyle:"clean",timingMs:2,velocityJitter:.035,swing:.02};
import {createProject} from './project.js';
import {EXTRA_TRACKS, validateChords} from './session.js';
import {normalizeRegions} from './regions.js';
function bounded(value,min,max,label){
  if(!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid '+label);
  return value;
}
function sourceMetadata(source){
  if(source==null)return null;
  if(typeof source!=="object"||typeof source.name!=="string")throw new Error("Invalid source metadata");
  const out={name:source.name,type:typeof source.type==='string'?source.type:'',originalPreserved:true,localAudioRequired:true};
  if(source.size!==undefined)out.size=bounded(source.size,0,150*1024*1024,'source size');
  if(source.sha256!==undefined){
    if(!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('Invalid source identity');
    out.sha256=source.sha256;
  }
  return out;
}
export function serializeProject(project){
  const clean=structuredClone(project);
  if(clean.source)clean.source={...clean.source,localAudioRequired:true};
  for(const track of Object.values(clean.tracks||{}))if(track.source)track.source={...track.source,localAudioRequired:true};
  // Runtime neural data and credentials must never enter portable project files.
  delete clean.runtime;
  delete clean.neuralRuntime;
  delete clean.apiKey;
  return JSON.stringify(clean,null,2);
}
export function deserializeProject(text){
  if(text.length>5*1024*1024)throw new Error('Project is too large');
  const p=JSON.parse(text);
  if(!p||typeof p!=="object"||Array.isArray(p))throw new Error("Invalid project file");
  if(!Number.isFinite(Number(p.version)))throw new Error("Project version missing");
  if(!Number.isInteger(p.version)||p.version<1||p.version>5)throw new Error('Unsupported project version');
  p.source=sourceMetadata(p.source);
  p.regions=normalizeRegions(Array.isArray(p.regions)?p.regions:[]);
  if(p.regions.some(r=>!Number.isFinite(r.endSec)))throw new Error('Invalid region');
  p.mix={...createProject().mix,...p.mix};
  for(const [key,value] of Object.entries(p.mix))bounded(value,0,key==='masterGain'?1.2:1.5,'mixer level');
  p.mastering={preset:"natural",room:.12,...(p.mastering||{})};
  p.production={...DEFAULT_PRODUCTION,...(p.production||{})};
  bounded(p.mastering.room,0,.5,'room amount');
  bounded(p.production.timingMs,0,20,'humanization');bounded(p.production.swing,0,.35,'swing');bounded(p.production.velocityJitter,0,1,'velocity');
  p.tracks=p.tracks||{};
  if(typeof p.tracks!=='object'||Array.isArray(p.tracks))throw new Error('Invalid tracks');
  p.tracks=Object.fromEntries(EXTRA_TRACKS.filter(id=>p.tracks[id]).map(id=>{
    const t=p.tracks[id];return [id,{source:sourceMetadata(t.source),gain:bounded(t.gain??1,0,1.5,'track level'),offsetSec:bounded(t.offsetSec??0,-600,600,'track offset')}];
  }));
  p.timing={bpm:null,offsetSec:0,...p.timing};
  if(p.timing.bpm!==null)bounded(p.timing.bpm,40,220,'tempo');bounded(p.timing.offsetSec,0,36000,'first beat');
  if(p.analysis){
    bounded(p.analysis.durationSec,0,36000,'duration');
    validateChords(p.analysis.chordTimeline||[],p.analysis.durationSec);
  }
  if(p.arrangement){
    const a=p.arrangement;bounded(a.durationSec,0,36000,'arrangement duration');bounded(a.bpm,40,220,'arrangement tempo');
    bounded(a.beatSec,.1,2,'beat duration');
    for(const stem of ['drums','bass','lead']){
      if(!Array.isArray(a[stem])||a[stem].length>100000)throw new Error('Invalid arrangement events');
      for(const e of a[stem]){
        if(!e||typeof e!=='object')throw new Error('Invalid event');
        bounded(e.time,0,a.durationSec,'event time');bounded(e.duration,0,60,'event duration');bounded(e.velocity,0,1,'event velocity');
        if(stem!=='drums')bounded(e.midi,0,127,'event pitch');
      }
    }
  }
  delete p.runtime;delete p.neuralRuntime;delete p.apiKey;
  return p;
}
