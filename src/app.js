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
import { buildWaveformPeaks, selectionToRegion, drawWaveform } from "./waveform.js";
import { checkAceStep, submitLego, waitForTask, fetchGeneratedAudio, defaultCaption } from "./providers/acestep.js";

let project = createProject();
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null, decodedBuffer = null, renderedBuffer = null, mixUrl = null, currentAudioName = null;
let waveformPeaks = null, waveformDuration = 0, dragStartX = null;
let neuralStemBuffers = {drums:null,bass:null,lead:null};
let neuralStemUrls = {drums:null,bass:null,lead:null};
let neuralAbort = null;
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
function clearWaveform(){
  waveformPeaks=null;waveformDuration=0;
  const c=$("waveformCanvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);
  $("waveformStatus").textContent="Load audio to draw the waveform.";
}
async function refreshWaveform(){
  if(!loadedArrayBuffer){clearWaveform();return}
  const decoded=await decodeCurrent(),samples=decoded.getChannelData(0),canvas=$("waveformCanvas");
  waveformDuration=decoded.duration;
  waveformPeaks=buildWaveformPeaks(samples,Math.max(320,Math.min(1400,Math.round(canvas.clientWidth||800))));
  drawWaveform(canvas,waveformPeaks,waveformDuration,project.regions||[]);
  $("waveformStatus").textContent=`${waveformDuration.toFixed(1)}s · drag to add a no-accompaniment region`;
}
function invalidateRender(){renderedBuffer=null;$("downloadBtn").disabled=true;revokeMix();$("renderStatus").textContent=""}
function setAceBusy(busy){
  $("aceCancelBtn").disabled=!busy;
  $("aceCheckBtn").disabled=busy;
  $("aceAllBtn").disabled=busy||!hasMatchingAudio();
  document.querySelectorAll("[data-neural-generate]").forEach(b=>b.disabled=busy||!hasMatchingAudio());
}
function revokeNeuralUrl(stem){
  if(neuralStemUrls[stem]){URL.revokeObjectURL(neuralStemUrls[stem]);neuralStemUrls[stem]=null}
}
function clearNeuralStem(stem){
  neuralStemBuffers[stem]=null;revokeNeuralUrl(stem);
  const audio=document.querySelector(`[data-neural-audio="${stem}"]`);audio?.removeAttribute("src");
  const state=document.querySelector(`[data-neural-state="${stem}"]`);if(state)state.textContent="local";
  const clear=document.querySelector(`[data-neural-clear="${stem}"]`);if(clear)clear.disabled=true;
  invalidateRender();
}
function clearAllNeural(){
  for(const stem of ["drums","bass","lead"])clearNeuralStem(stem);
}
function syncNeuralUi(){
  for(const stem of ["drums","bass","lead"]){
    const active=!!neuralStemBuffers[stem],state=document.querySelector(`[data-neural-state="${stem}"]`);
    if(state)state.textContent=active?"neural":"local";
    const clear=document.querySelector(`[data-neural-clear="${stem}"]`);if(clear)clear.disabled=!active;
  }
  setAceBusy(!!neuralAbort);
}
function invalidateArrangement(){
  project.arrangement=null;project.stems={drums:null,bass:null,lead:null};invalidateRender();
  $("renderBtn").disabled=true;$("exportStemsBtn").disabled=true;
  $("arrangement").textContent="Arrangement needs regeneration.";
}
function renderRegions(){
  const host=$("regionList");host.textContent="";
  (project.regions||[]).forEach((r,i)=>{
    const row=document.createElement("div");row.className="region";
    const label=document.createElement("span"),code=document.createElement("code");
    code.textContent=`${r.startSec.toFixed(2)}–${r.endSec.toFixed(2)}s`;
    label.append(code,document.createTextNode(" "+(r.label||"No accompaniment")));
    const btn=document.createElement("button");btn.textContent="Remove";
    btn.onclick=()=>{project=removeRegion(project,i);renderRegions();invalidateArrangement()};
    row.append(label,btn);host.append(row);
  });
  if(!(project.regions||[]).length)host.textContent="No blocked regions.";
  if(waveformPeaks)drawWaveform($("waveformCanvas"),waveformPeaks,waveformDuration,project.regions||[]);
}
function arrangementSummary(){
  const a=project.arrangement;if(!a)return "No arrangement generated.";
  const p=project.production||{};
  return JSON.stringify({
    bpm:a.bpm,key:a.key,bars:a.bars,chordAware:a.chordAware,
    chordRegions:project.analysis?.chordTimeline?.length||0,
    blockedRegions:project.regions?.length||0,
    band:{drums:p.drumStyle,bass:p.bassStyle,lead:p.leadStyle,humanizeMs:p.timingMs,swing:p.swing},
    events:project.stems,review:project.analysis?.speechReview?.status||"unknown"
  },null,2);
}
function syncControls(){
  project.production=project.production||{drumStyle:"studio",bassStyle:"round",leadStyle:"clean",timingMs:10,velocityJitter:.05,swing:.08};
  document.querySelectorAll("[data-mix]").forEach(input=>{
    const v=project.mix?.[input.dataset.mix]??Number(input.value);input.value=v;input.nextElementSibling.value=Number(v).toFixed(2);
  });
  $("masterPreset").value=project.mastering?.preset||"natural";
  $("roomAmount").value=project.mastering?.room??.12;$("roomAmount").nextElementSibling.value=Number($("roomAmount").value).toFixed(2);
  $("drumStyle").value=project.production.drumStyle||"studio";
  $("bassStyle").value=project.production.bassStyle||"round";
  $("leadStyle").value=project.production.leadStyle||"clean";
  $("timingMs").value=project.production.timingMs??10;$("timingMs").nextElementSibling.value=String(project.production.timingMs??10);
  $("swingAmount").value=project.production.swing??.08;$("swingAmount").nextElementSibling.value=Number(project.production.swing??.08).toFixed(2);
  $("analysis").textContent=project.analysis?JSON.stringify(project.analysis,null,2):"Load or record a track to begin.";
  $("chordEditor").value=JSON.stringify(project.analysis?.chordTimeline||[],null,2);
  $("applyChordsBtn").disabled=!project.analysis;
  $("arrangement").textContent=arrangementSummary();renderRegions();
  const matching=hasMatchingAudio();
  $("analyzeBtn").disabled=!loadedArrayBuffer;
  $("arrangeBtn").disabled=!(project.analysis&&matching);
  $("renderBtn").disabled=!(project.arrangement&&matching);
  $("exportStemsBtn").disabled=!(project.arrangement&&matching);
  syncNeuralUi();
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function baseName(){return (project.source?.name||"jam").replace(/\.[^.]+$/,"")}
function downloadWav(buffer,suffix){downloadBlob(new Blob([audioBufferToWav(buffer)],{type:"audio/wav"}),`${baseName()}-${suffix}.wav`)}
function setProduction(key,value){
  project.production={...(project.production||{}),[key]:value};invalidateRender();
  if(project.arrangement)$("arrangement").textContent=arrangementSummary();
}
function aceRuntime(){
  return {endpoint:$("aceEndpoint").value.trim(),apiKey:$("aceApiKey").value};
}
function sourceAudioBlob(){
  if(!loadedArrayBuffer)throw new Error("Load the source recording first.");
  return new Blob([loadedArrayBuffer],{type:project.source?.type||"audio/wav"});
}
async function decodeGenerated(arrayBuffer){
  audioCtx ||= new AudioContext();
  return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
}
async function generateOneNeuralStem(stem,signal){
  const {endpoint,apiKey}=aceRuntime(),analysis=project.analysis||{};
  const caption=[$("acePrompt").value.trim(),defaultCaption(stem)].filter(Boolean).join(". ");
  $("aceStatus").textContent=`Submitting neural ${stem}…`;
  const submitted=await submitLego({
    endpoint,apiKey,audioBlob:sourceAudioBlob(),stem,caption,
    bpm:analysis.tempoBpm,key:analysis.keyEstimate?.key,seed:Number($("seed").value)||1,signal
  });
  $("aceStatus").textContent=`Neural ${stem} queued (${submitted.taskId.slice(0,8)}…).`;
  const result=await waitForTask({
    endpoint,apiKey,taskId:submitted.taskId,signal,
    onProgress:p=>{$("aceStatus").textContent=`Neural ${stem}: server working · poll ${p.poll}`;}
  });
  $("aceStatus").textContent=`Downloading neural ${stem}…`;
  const bytes=await fetchGeneratedAudio({endpoint,apiKey,file:result.file,signal});
  const decoded=await decodeGenerated(bytes);
  neuralStemBuffers[stem]=decoded;revokeNeuralUrl(stem);
  const blob=new Blob([bytes],{type:"audio/wav"});neuralStemUrls[stem]=URL.createObjectURL(blob);
  const audio=document.querySelector(`[data-neural-audio="${stem}"]`);if(audio)audio.src=neuralStemUrls[stem];
  const state=document.querySelector(`[data-neural-state="${stem}"]`);if(state)state.textContent="neural";
  const clear=document.querySelector(`[data-neural-clear="${stem}"]`);if(clear)clear.disabled=false;
  invalidateRender();
  return result;
}
async function runNeural(stems){
  if(neuralAbort)throw new Error("A neural render is already running.");
  neuralAbort=new AbortController();setAceBusy(true);
  try{
    for(const stem of stems)await generateOneNeuralStem(stem,neuralAbort.signal);
    $("aceStatus").textContent=`Neural render complete: ${stems.join(", ")}. Neural stems now replace those local tracks in mix/export.`;
  }catch(e){
    $("aceStatus").textContent=e?.name==="AbortError"?"Neural render canceled.":`Neural render stopped: ${e.message}`;
  }finally{
    neuralAbort=null;setAceBusy(false);syncNeuralUi();
  }
}

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
  const previousName=project.source?.name;
  loadedArrayBuffer=await file.arrayBuffer();decodedBuffer=null;renderedBuffer=null;currentAudioName=file.name;revokeMix();
  if(previousName&&previousName!==file.name)clearAllNeural();
  const reopening=project.source?.localAudioRequired&&project.source?.name===file.name;
  if(reopening)project.source={...project.source,type:file.type,size:file.size,originalPreserved:true};
  else project=setSource(project,{name:file.name,type:file.type,size:file.size});
  $("player").src=URL.createObjectURL(file);
  $("meta").textContent=`${file.name} · ${Math.round(file.size/1024)} KB · ${reopening?"project source restored":"original preserved"}`;
  syncControls();await refreshWaveform();
};

$("projectFile").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    project=deserializeProject(await file.text());renderedBuffer=null;revokeMix();clearAllNeural();
    if(currentAudioName!==project.source?.name){loadedArrayBuffer=null;decodedBuffer=null;currentAudioName=null;$("player").removeAttribute("src");clearWaveform()}
    $("meta").textContent=`Project loaded · source audio required: ${project.source?.name||"unknown"}`;syncControls();
    if(loadedArrayBuffer)await refreshWaveform();
  }catch(err){alert(err.message)}
};

$("saveProjectBtn").onclick=()=>downloadBlob(new Blob([serializeProject(project)],{type:"application/json"}),`${baseName()}.omjbs.json`);

$("recordBtn").onclick=async()=>{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});mediaRecorder=new MediaRecorder(stream);chunks=[];
  mediaRecorder.ondataavailable=e=>chunks.push(e.data);
  mediaRecorder.onstop=async()=>{
    const blob=new Blob(chunks,{type:mediaRecorder.mimeType||"audio/webm"});loadedArrayBuffer=await blob.arrayBuffer();decodedBuffer=null;renderedBuffer=null;currentAudioName="recording";revokeMix();clearAllNeural();
    $("player").src=URL.createObjectURL(blob);project=setSource(project,{name:"recording",type:blob.type,size:blob.size});
    $("meta").textContent=`New recording · ${Math.round(blob.size/1024)} KB · original preserved`;stream.getTracks().forEach(t=>t.stop());syncControls();await refreshWaveform();
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

const canvas=$("waveformCanvas");
canvas.addEventListener("pointerdown",e=>{
  if(!waveformPeaks||!waveformDuration)return;
  const rect=canvas.getBoundingClientRect();dragStartX=e.clientX-rect.left;canvas.setPointerCapture?.(e.pointerId);
  $("waveformStatus").textContent="Drag to the end of the section to block.";
});
canvas.addEventListener("pointerup",e=>{
  if(dragStartX===null||!waveformDuration)return;
  const rect=canvas.getBoundingClientRect(),endX=e.clientX-rect.left;
  const region=selectionToRegion(dragStartX,endX,rect.width,waveformDuration,"Waveform exclusion");dragStartX=null;
  if(region.endSec-region.startSec<.1){$("waveformStatus").textContent="Selection too short; drag a wider section.";return}
  project=addMuteRegion(project,region.startSec,region.endSec,region.label);
  $("regionStart").value=region.startSec;$("regionEnd").value=region.endSec;renderRegions();invalidateArrangement();
  $("waveformStatus").textContent=`Blocked ${region.startSec.toFixed(2)}–${region.endSec.toFixed(2)}s.`;
});
window.addEventListener("resize",()=>{if(waveformPeaks)drawWaveform(canvas,waveformPeaks,waveformDuration,project.regions||[])});

$("arrangeBtn").onclick=async()=>{
  const decoded=await decodeCurrent(),a=project.analysis,bpm=a?.tempoBpm||120,key=a?.keyEstimate?.key||"C major";
  project.arrangement=buildArrangement({bpm,durationSec:decoded.duration,key,seed:Number($("seed").value)||1,chordTimeline:a?.chordTimeline||[],muteRegions:project.regions||[]});
  project.stems={drums:{events:project.arrangement.drums.length},bass:{events:project.arrangement.bass.length},lead:{events:project.arrangement.lead.length}};
  $("arrangement").textContent=arrangementSummary();$("renderBtn").disabled=false;$("exportStemsBtn").disabled=false;invalidateRender();
};

$("drumStyle").onchange=e=>setProduction("drumStyle",e.target.value);
$("bassStyle").onchange=e=>setProduction("bassStyle",e.target.value);
$("leadStyle").onchange=e=>setProduction("leadStyle",e.target.value);
$("timingMs").oninput=e=>{e.target.nextElementSibling.value=e.target.value;setProduction("timingMs",Number(e.target.value))};
$("swingAmount").oninput=e=>{e.target.nextElementSibling.value=Number(e.target.value).toFixed(2);setProduction("swing",Number(e.target.value))};

document.querySelectorAll("[data-mix]").forEach(input=>{
  input.oninput=()=>{project.mix[input.dataset.mix]=Number(input.value);input.nextElementSibling.value=Number(input.value).toFixed(2);invalidateRender()};
});
$("masterPreset").onchange=e=>{project.mastering.preset=e.target.value;invalidateRender()};
$("roomAmount").oninput=e=>{project.mastering.room=Number(e.target.value);e.target.nextElementSibling.value=Number(e.target.value).toFixed(2);invalidateRender()};

$("renderBtn").onclick=async()=>{
  try{
    $("renderStatus").textContent="Rendering expressive local band…";const decoded=await decodeCurrent();
    renderedBuffer=await renderProjectMix(decoded,project,neuralStemBuffers);
    const meter=measureAudioBuffer(renderedBuffer),channels=Array.from({length:renderedBuffer.numberOfChannels},(_,i)=>renderedBuffer.getChannelData(i));
    const tp=estimateTruePeak(channels),loud=estimateIntegratedLoudness(channels,renderedBuffer.sampleRate);
    const wav=audioBufferToWav(renderedBuffer),blob=new Blob([wav],{type:"audio/wav"});if(mixUrl)URL.revokeObjectURL(mixUrl);mixUrl=URL.createObjectURL(blob);$("mixPlayer").src=mixUrl;$("downloadBtn").disabled=false;
    $("renderStatus").textContent=`Rendered ${renderedBuffer.duration.toFixed(1)}s stereo WAV · ${project.production.drumStyle}/${project.production.bassStyle}/${project.production.leadStyle} · peak ${meter.peakDb} dBFS · true-peak est. ${tp.dbTP} dBTP · loudness est. ${loud.lufs} LUFS.`;
  }catch(e){$("renderStatus").textContent=e.message}
};
$("downloadBtn").onclick=()=>{if(renderedBuffer)downloadWav(renderedBuffer,"mix")};

$("exportStemsBtn").onclick=async()=>{
  try{
    $("renderStatus").textContent="Rendering 4 stems locally…";const decoded=await decodeCurrent();
    for(const stem of ["original","drums","bass","lead"]){const b=await renderProjectStem(decoded,project,stem,neuralStemBuffers);downloadWav(b,stem)}
    $("renderStatus").textContent="Stem renders complete. Your browser may ask permission for multiple downloads.";
  }catch(e){$("renderStatus").textContent=e.message}
};

$("aceCheckBtn").onclick=async()=>{
  try{
    const {endpoint,apiKey}=aceRuntime();$("aceStatus").textContent="Checking neural server…";
    const result=await checkAceStep({endpoint,apiKey});$("aceStatus").textContent=`Neural server reachable at ${result.endpoint}.`;
  }catch(e){$("aceStatus").textContent=`Neural server check failed: ${e.message}`}
};
$("aceAllBtn").onclick=()=>runNeural(["drums","bass","lead"]);
document.querySelectorAll("[data-neural-generate]").forEach(btn=>btn.onclick=()=>runNeural([btn.dataset.neuralGenerate]));
document.querySelectorAll("[data-neural-clear]").forEach(btn=>btn.onclick=()=>{clearNeuralStem(btn.dataset.neuralClear);$("aceStatus").textContent=`${btn.dataset.neuralClear} reverted to local renderer.`});
$("aceCancelBtn").onclick=()=>neuralAbort?.abort();

syncControls();
clearWaveform();
