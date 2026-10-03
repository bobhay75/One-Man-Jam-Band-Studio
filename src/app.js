import { autoCorrelate, frequencyToNote, noteName, centsOff } from "./tuner.js";
import { createProject, setSource } from "./project.js";
import { analyzeAudioBuffer } from "./analyze.js";
import { buildArrangement } from "./arranger.js";
import { renderProjectMix, renderProjectStem } from "./render.js";
import { audioBufferToWav } from "./wav.js";
import { measureAudioBuffer } from "./meter.js";
import { estimateTruePeak, estimateIntegratedLoudness } from "./loudness.js";
import { addMuteRegion, removeRegion } from "./regions.js";
import { serializeProject, deserializeProject } from "./persistence.js";

let project = createProject();
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null, decodedBuffer = null, renderedBuffer = null, mixUrl = null, currentAudioName = null;
let mediaRecorder = null, chunks = [];
const $ = id => document.getElementById(id);

async function decodeCurrent(){
  if(decodedBuffer) return decodedBuffer;
  if(!loadedArrayBuffer) throw new Error("Load the source audio for this project first.");
  audioCtx ||= new AudioContext();
  decodedBuffer=await audioCtx.decodeAudioData(loadedArrayBuffer.slice(0));
  return decodedBuffer;
}
function hasMatchingAudio(){return !!loadedArrayBuffer&&(!project.source?.name||project.source.name===currentAudioName)}
function revokeMix(){if(mixUrl){URL.revokeObjectURL(mixUrl);mixUrl=null}$("mixPlayer").removeAttribute("src")}
function invalidateRender(){renderedBuffer=null;$("downloadBtn").disabled=true;revokeMix();$("renderStatus").textContent=""}
function invalidateArrangement(){
  project.arrangement=null;project.stems={drums:null,bass:null,lead:null};invalidateRender();
  $("renderBtn").disabled=true;$("exportStemsBtn").disabled=true;
  $("arrangement").textContent="Arrangement needs regeneration.";
}
function renderRegions(){
  const host=$("regionList");host.textContent="";
  (project.regions||[]).forEach((r,i)=>{
    const row=document.createElement("div");row.className="region";
    const label=document.createElement("span");label.innerHTML=`<code>${r.startSec.toFixed(2)}–${r.endSec.toFixed(2)}s</code> ${r.label||"No accompaniment"}`;
    const btn=document.createElement("button");btn.textContent="Remove";btn.onclick=()=>{project=removeRegion(project,i);renderRegions();invalidateArrangement()};
    row.append(label,btn);host.append(row);
  });
  if(!(project.regions||[]).length)host.textContent="No blocked regions.";
}
function arrangementSummary(){
  const a=project.arrangement;
  if(!a)return "No arrangement generated.";
  return JSON.stringify({bpm:a.bpm,key:a.key,bars:a.bars,chordAware:a.chordAware,chordRegions:project.analysis?.chordTimeline?.length||0,blockedRegions:project.regions?.length||0,events:project.stems,review:project.analysis?.speechReview?.status||"unknown"},null,2);
}
function syncControls(){
  document.querySelectorAll("[data-mix]").forEach(input=>{
    const v=project.mix?.[input.dataset.mix]??Number(input.value);input.value=v;input.nextElementSibling.value=Number(v).toFixed(2);
  });
  $("masterPreset").value=project.mastering?.preset||"natural";
  $("roomAmount").value=project.mastering?.room??.12;$("roomAmount").nextElementSibling.value=Number($("roomAmount").value).toFixed(2);
  $("analysis").textContent=project.analysis?JSON.stringify(project.analysis,null,2):"Load or record a track to begin.";
  $("chordEditor").value=JSON.stringify(project.analysis?.chordTimeline||[],null,2);
  $("applyChordsBtn").disabled=!project.analysis;
  $("arrangement").textContent=arrangementSummary();renderRegions();
  const matching=hasMatchingAudio();
  $("analyzeBtn").disabled=!loadedArrayBuffer;
  $("arrangeBtn").disabled=!(project.analysis&&matching);
  $("renderBtn").disabled=!(project.arrangement&&matching);
  $("exportStemsBtn").disabled=!(project.arrangement&&matching);
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function baseName(){return (project.source?.name||"jam").replace(/\.[^.]+$/,"")}
function downloadWav(buffer,suffix){downloadBlob(new Blob([audioBufferToWav(buffer)],{type:"audio/wav"}),`${baseName()}-${suffix}.wav`)}

async function startTuner(){
  audioCtx ||= new AudioContext();micStream=await navigator.mediaDevices.getUserMedia({audio:true});
  const source=audioCtx.createMediaStreamSource(micStream);analyser=audioCtx.createAnalyser();analyser.fftSize=2048;source.connect(analyser);
  const buf=new Float32Array(analyser.fftSize);
  const tick=()=>{analyser.getFloatTimeDomainData(buf);const freq=autoCorrelate(buf,audioCtx.sampleRate);if(freq>0){const n=frequencyToNote(freq);$("note").textContent=noteName(n);$("freq").textContent=freq.toFixed(1)+" Hz";$("cents").textContent=centsOff(freq,n)+" cents"}raf=requestAnimationFrame(tick)};
  tick();$("startTuner").disabled=true;$("stopTuner").disabled=false;
}
function stopTuner(){cancelAnimationFrame(raf);micStream?.getTracks().forEach(t=>t.stop());$("startTuner").disabled=false;$("stopTuner").disabled=true}
$("startTuner").onclick=()=>startTuner().catch(e=>alert(e.message));$("stopTuner").onclick=stopTuner;

$("audioFile").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  loadedArrayBuffer=await file.arrayBuffer();decodedBuffer=null;renderedBuffer=null;currentAudioName=file.name;revokeMix();
  const reopening=project.source?.localAudioRequired&&project.source?.name===file.name;
  if(reopening)project.source={...project.source,type:file.type,size:file.size,originalPreserved:true};
  else project=setSource(project,{name:file.name,type:file.type,size:file.size});
  $("player").src=URL.createObjectURL(file);
  $("meta").textContent=`${file.name} · ${Math.round(file.size/1024)} KB · ${reopening?"project source restored":"original preserved"}`;
  syncControls();
};

$("projectFile").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const next=deserializeProject(await file.text());project=next;renderedBuffer=null;revokeMix();
    if(currentAudioName!==project.source?.name){loadedArrayBuffer=null;decodedBuffer=null;currentAudioName=null;$("player").removeAttribute("src")}
    $("meta").textContent=`Project loaded · source audio required: ${project.source?.name||"unknown"}`;syncControls();
  }catch(err){alert(err.message)}
};

$("saveProjectBtn").onclick=()=>{
  downloadBlob(new Blob([serializeProject(project)],{type:"application/json"}),`${baseName()}.omjbs.json`);
};

$("recordBtn").onclick=async()=>{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});mediaRecorder=new MediaRecorder(stream);chunks=[];
  mediaRecorder.ondataavailable=e=>chunks.push(e.data);
  mediaRecorder.onstop=async()=>{
    const blob=new Blob(chunks,{type:mediaRecorder.mimeType||"audio/webm"});loadedArrayBuffer=await blob.arrayBuffer();decodedBuffer=null;renderedBuffer=null;currentAudioName="recording";revokeMix();
    $("player").src=URL.createObjectURL(blob);project=setSource(project,{name:"recording",type:blob.type,size:blob.size});
    $("meta").textContent=`New recording · ${Math.round(blob.size/1024)} KB · original preserved`;stream.getTracks().forEach(t=>t.stop());syncControls();
  };
  mediaRecorder.start();$("recordBtn").disabled=true;$("stopRecordBtn").disabled=false;
};
$("stopRecordBtn").onclick=()=>{mediaRecorder?.stop();$("recordBtn").disabled=false;$("stopRecordBtn").disabled=true};

$("analyzeBtn").onclick=async()=>{
  try{
    const decoded=await decodeCurrent();project.analysis=await analyzeAudioBuffer(decoded);project.arrangement=null;project.stems={drums:null,bass:null,lead:null};
    $("analysis").textContent=JSON.stringify(project.analysis,null,2);$("chordEditor").value=JSON.stringify(project.analysis.chordTimeline||[],null,2);$("applyChordsBtn").disabled=false;
    $("arrangeBtn").disabled=false;$("renderBtn").disabled=true;$("exportStemsBtn").disabled=true;$("arrangement").textContent="Analysis complete. Generate an arrangement.";
  }catch(e){alert(e.message)}
};

$("applyChordsBtn").onclick=()=>{
  try{
    const timeline=JSON.parse($("chordEditor").value);if(!Array.isArray(timeline))throw new Error("Chord timeline must be a JSON array.");
    project.analysis={...project.analysis,chordTimeline:timeline};$("chordStatus").textContent=`Applied ${timeline.length} chord regions.`;invalidateArrangement();
  }catch(e){$("chordStatus").textContent=e.message}
};

$("addRegionBtn").onclick=()=>{
  project=addMuteRegion(project,$("regionStart").value,$("regionEnd").value,$("regionLabel").value||"No accompaniment");
  renderRegions();invalidateArrangement();
};

$("arrangeBtn").onclick=async()=>{
  const decoded=await decodeCurrent(),a=project.analysis,bpm=a?.tempoBpm||120,key=a?.keyEstimate?.key||"C major";
  project.arrangement=buildArrangement({bpm,durationSec:decoded.duration,key,seed:Number($("seed").value)||1,chordTimeline:a?.chordTimeline||[],muteRegions:project.regions||[]});
  project.stems={drums:{events:project.arrangement.drums.length},bass:{events:project.arrangement.bass.length},lead:{events:project.arrangement.lead.length}};
  $("arrangement").textContent=arrangementSummary();$("renderBtn").disabled=false;$("exportStemsBtn").disabled=false;invalidateRender();
};

document.querySelectorAll("[data-mix]").forEach(input=>{
  input.oninput=()=>{project.mix[input.dataset.mix]=Number(input.value);input.nextElementSibling.value=Number(input.value).toFixed(2);invalidateRender()};
});
$("masterPreset").onchange=e=>{project.mastering.preset=e.target.value;invalidateRender()};
$("roomAmount").oninput=e=>{project.mastering.room=Number(e.target.value);e.target.nextElementSibling.value=Number(e.target.value).toFixed(2);invalidateRender()};

$("renderBtn").onclick=async()=>{
  try{
    $("renderStatus").textContent="Rendering locally…";const decoded=await decodeCurrent();
    renderedBuffer=await renderProjectMix(decoded,project);
    const meter=measureAudioBuffer(renderedBuffer),channels=Array.from({length:renderedBuffer.numberOfChannels},(_,i)=>renderedBuffer.getChannelData(i));
    const tp=estimateTruePeak(channels),loud=estimateIntegratedLoudness(channels,renderedBuffer.sampleRate);
    const wav=audioBufferToWav(renderedBuffer),blob=new Blob([wav],{type:"audio/wav"});if(mixUrl)URL.revokeObjectURL(mixUrl);mixUrl=URL.createObjectURL(blob);$("mixPlayer").src=mixUrl;$("downloadBtn").disabled=false;
    $("renderStatus").textContent=`Rendered ${renderedBuffer.duration.toFixed(1)}s stereo WAV · peak ${meter.peakDb} dBFS · true-peak est. ${tp.dbTP} dBTP · loudness est. ${loud.lufs} LUFS · ${project.mastering.preset} master.`;
  }catch(e){$("renderStatus").textContent=e.message}
};
$("downloadBtn").onclick=()=>{if(renderedBuffer)downloadWav(renderedBuffer,"mix")};

$("exportStemsBtn").onclick=async()=>{
  try{
    $("renderStatus").textContent="Rendering 4 stems locally…";const decoded=await decodeCurrent();
    for(const stem of ["original","drums","bass","lead"]){const b=await renderProjectStem(decoded,project,stem);downloadWav(b,stem)}
    $("renderStatus").textContent="Stem renders complete. Your browser may ask permission for multiple downloads.";
  }catch(e){$("renderStatus").textContent=e.message}
};

syncControls();
