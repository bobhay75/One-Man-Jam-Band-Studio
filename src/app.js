import { autoCorrelate, frequencyToNote, noteName, centsOff, tunerState } from "./tuner.js";
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
import { EXTRA_TRACKS, TRACK_NAMES, AUDIO_ACCEPT, audioIdentity, matchesSource, validateChords, mediaError } from "./session.js";

let project = createProject();
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null, decodedBuffer = null, renderedBuffer = null, mixUrl = null, currentAudioName = null;
let waveformPeaks = null, waveformDuration = 0, dragStartX = null;
let neuralStemBuffers = {drums:null,bass:null,lead:null};
let neuralStemUrls = {drums:null,bass:null,lead:null};
let neuralAbort = null;
let mediaRecorder = null;
let revision = 0, sourceEpoch = 0, importId = 0, importBusy = false, recordBusy = false, renderBusy = false;
let sourceUrl = null, sourceBlob = null, sourceIdentity = null, tunerStarting = false, tunerEpoch = 0;
let trackBuffers = {}, trackUrls = {}, stemDownloadUrls = [];
let pendingSourceRestore = false;
const $ = id => document.getElementById(id);
const quickRecord = $("quickRecordBtn"), quickPlay = $("quickPlayBtn");
function report(message){$("sessionStatus").textContent=message}
function clearStemDownloads(){
  stemDownloadUrls.forEach(url=>URL.revokeObjectURL(url));stemDownloadUrls=[];$("stemDownloads").replaceChildren();
}
function stopPlayback(){
  document.querySelectorAll("audio").forEach(audio=>audio.pause());
  quickPlay.textContent="Play Take";
}
function resetSourceUrl(blob){
  $("player").pause();if(sourceUrl)URL.revokeObjectURL(sourceUrl);
  sourceBlob=blob;sourceUrl=blob?URL.createObjectURL(blob):null;
  if(sourceUrl)$("player").src=sourceUrl;else $("player").removeAttribute("src");
  $("player").load();quickPlay.textContent="Play Take";
}
function clearTrack(id){
  if(trackUrls[id])URL.revokeObjectURL(trackUrls[id]);delete trackUrls[id];delete trackBuffers[id];
  const audio=$(`${id}Player`);audio.pause();audio.removeAttribute("src");audio.load();
}
function allAudioPresent(){return hasMatchingAudio()&&EXTRA_TRACKS.every(id=>!project.tracks?.[id]?.source||trackBuffers[id])}
function sourceChanged(){sourceEpoch++;neuralAbort?.abort();stopPlayback();clearAllNeural()}

async function decodeCurrent(){
  if(decodedBuffer) return decodedBuffer;
  if(!loadedArrayBuffer) throw new Error("Load the source audio for this project first.");
  audioCtx ||= new AudioContext();
  const epoch=sourceEpoch,decoded=await audioCtx.decodeAudioData(loadedArrayBuffer.slice(0));
  if(epoch!==sourceEpoch)throw new Error("Source changed. Retry with the current take.");
  decodedBuffer=decoded;return decoded;
}
function hasMatchingAudio(){return !!loadedArrayBuffer&&matchesSource(project.source,sourceIdentity)}
function revokeMix(){$("mixPlayer").pause();if(mixUrl){URL.revokeObjectURL(mixUrl);mixUrl=null}$("mixPlayer").removeAttribute("src");$("mixPlayer").load()}
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
function invalidateRender(){revision++;renderedBuffer=null;$("downloadBtn").disabled=true;clearStemDownloads();revokeMix();$("renderStatus").textContent=""}
function setAceBusy(busy){
  $("aceCancelBtn").disabled=!busy;
  $("aceCheckBtn").disabled=busy;
  $("aceAllBtn").disabled=busy||importBusy||recordBusy||!hasMatchingAudio();
  document.querySelectorAll("[data-neural-generate]").forEach(b=>b.disabled=busy||importBusy||recordBusy||!hasMatchingAudio());
}
function revokeNeuralUrl(stem){
  if(neuralStemUrls[stem]){URL.revokeObjectURL(neuralStemUrls[stem]);neuralStemUrls[stem]=null}
}
function clearNeuralStem(stem){
  neuralStemBuffers[stem]=null;revokeNeuralUrl(stem);
  const audio=document.querySelector(`[data-neural-audio="${stem}"]`);
  if(audio){audio.pause();audio.removeAttribute("src");audio.load()}
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
  project.production=project.production||{drumStyle:"studio",bassStyle:"round",leadStyle:"clean",timingMs:2,velocityJitter:.05,swing:.02};
  document.querySelectorAll("[data-mix]").forEach(input=>{
    const v=project.mix?.[input.dataset.mix]??Number(input.value);input.value=v;input.nextElementSibling.value=Number(v).toFixed(2);
  });
  document.querySelectorAll('[data-track-gain]').forEach(input=>input.value=project.mix[input.dataset.trackGain]);
  $("tempoBpm").value=project.timing?.bpm??project.analysis?.tempoBpm??120;
  $("beatOffset").value=project.timing?.offsetSec??0;
  $("seed").value=project.arrangement?.seed??project.seed??1;
  for(const id of EXTRA_TRACKS){
    const t=project.tracks?.[id];
    $(`${id}Gain`).value=t?.gain??1;$(`${id}Offset`).value=t?.offsetSec??0;
    $(`${id}State`).textContent=trackBuffers[id]?`${t.source.name} · ready`:t?.source?`Restore ${t.source.name}`:"Empty";
    $(`${id}Remove`).disabled=!t?.source||recordBusy||importBusy;
    const save=$(`${id}Save`);save.hidden=!trackUrls[id];
    if(trackUrls[id]){save.href=trackUrls[id];save.download=t.source.name}else save.removeAttribute('href');
  }
  for(const [i,stem] of ['drums','bass','lead'].entries())$(`trackState${i+2}`).textContent=neuralStemBuffers[stem]?"Neural part ready":project.arrangement?"Local part ready":"Generate after analysis";
  $("masterPreset").value=project.mastering?.preset||"natural";
  $("roomAmount").value=project.mastering?.room??.12;$("roomAmount").nextElementSibling.value=Number($("roomAmount").value).toFixed(2);
  $("drumStyle").value=project.production.drumStyle||"studio";
  $("bassStyle").value=project.production.bassStyle||"round";
  $("leadStyle").value=project.production.leadStyle||"clean";
  $("timingMs").value=project.production.timingMs??2;$("timingMs").nextElementSibling.value=String(project.production.timingMs??2);
  $("swingAmount").value=project.production.swing??.02;$("swingAmount").nextElementSibling.value=Number(project.production.swing??.02).toFixed(2);
  $("analysis").textContent=project.analysis?JSON.stringify(project.analysis,null,2):"Load or record a track to begin.";
  $("chordEditor").value=JSON.stringify(project.analysis?.chordTimeline||[],null,2);
  $("applyChordsBtn").disabled=!project.analysis;
  $("arrangement").textContent=arrangementSummary();renderRegions();
  const busy=importBusy||recordBusy,matching=hasMatchingAudio()&&!busy;
  if(quickPlay)quickPlay.disabled=!loadedArrayBuffer||busy;
  const state1=$("trackState1");if(state1)state1.textContent=loadedArrayBuffer?(currentAudioName==="recording"?"Recorded take ready":"Imported take ready"):"Waiting for a take";
  $("analyzeBtn").disabled=!matching;
  $("arrangeBtn").disabled=!(project.analysis&&matching);
  $("renderBtn").disabled=!(project.arrangement&&matching&&allAudioPresent())||renderBusy;
  $("exportStemsBtn").disabled=$("renderBtn").disabled;
  $("recordBtn").disabled=busy;quickRecord.disabled=busy;
  $("startTuner").disabled=recordBusy||tunerStarting||!!micStream;
  $("audioFile").disabled=recordBusy;$("audioFileAll").disabled=recordBusy;
  $("projectFile").disabled=busy;$("recordTarget").disabled=busy;
  $("saveOriginalBtn").disabled=!sourceBlob||busy;
  document.querySelectorAll('[data-track-file]').forEach(input=>input.disabled=recordBusy||!loadedArrayBuffer);
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
async function generateOneNeuralStem(stem,signal,epoch){
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
  signal.throwIfAborted();
  if(epoch!==sourceEpoch)throw new DOMException("Source changed","AbortError");
  neuralStemBuffers[stem]=decoded;revokeNeuralUrl(stem);
  const blob=new Blob([bytes],{type:"audio/wav"});neuralStemUrls[stem]=URL.createObjectURL(blob);
  const audio=document.querySelector(`[data-neural-audio="${stem}"]`);if(audio)audio.src=neuralStemUrls[stem];
  const state=document.querySelector(`[data-neural-state="${stem}"]`);if(state)state.textContent="neural";
  const clear=document.querySelector(`[data-neural-clear="${stem}"]`);if(clear)clear.disabled=false;
  invalidateRender();
  return result;
}
async function runNeural(stems){
  if(neuralAbort||!hasMatchingAudio())return;
  neuralAbort=new AbortController();setAceBusy(true);
  const epoch=sourceEpoch;
  try{
    for(const stem of stems)await generateOneNeuralStem(stem,neuralAbort.signal,epoch);
    $("aceStatus").textContent=`Neural render complete: ${stems.join(", ")}. Neural stems now replace those local tracks in mix/export.`;
  }catch(e){
    $("aceStatus").textContent=e?.name==="AbortError"?"Neural render canceled.":`Neural render stopped: ${e.message}`;
  }finally{
    neuralAbort=null;setAceBusy(false);syncControls();
  }
}

function resetTuner(){
  $("note").textContent="--";$("freq").textContent="0.0 Hz";$("cents").textContent="0 cents";
  $("tunerTarget").textContent="Target: --";$("tunerStatus").textContent="PLAY A NOTE";
  document.querySelector(".tuner-card").dataset.state="waiting";
  $("tunerNeedle").style.transform="translateX(-50%) rotate(0deg)";
}
async function startTuner(){
  if(tunerStarting||micStream||recordBusy)return;
  const epoch=++tunerEpoch;
  tunerStarting=true;$("startTuner").disabled=true;$("stopTuner").disabled=false;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone access needs HTTPS or localhost and a supported browser.");
    audioCtx ||= new AudioContext();await audioCtx.resume();
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(epoch!==tunerEpoch){stream.getTracks().forEach(t=>t.stop());return}
    micStream=stream;
    const source=audioCtx.createMediaStreamSource(micStream);analyser=audioCtx.createAnalyser();analyser.fftSize=4096;source.connect(analyser);
    const buf=new Float32Array(analyser.fftSize);
    const tick=()=>{
      analyser.getFloatTimeDomainData(buf);const freq=autoCorrelate(buf,audioCtx.sampleRate);
      if(freq>0){
        const n=frequencyToNote(freq),cents=centsOff(freq,n),state=tunerState(cents);
        $("note").textContent=noteName(n);$("freq").textContent=freq.toFixed(1)+" Hz";
        $("cents").textContent=(cents>0?"+":"")+cents+" cents";
        $("tunerTarget").textContent="Target: "+(440*Math.pow(2,(n-69)/12)).toFixed(1)+" Hz";
        $("tunerStatus").textContent=state==="in-tune"?"IN TUNE":state==="flat"?"TOO FLAT — tighten string":"TOO SHARP — loosen string";
        document.querySelector(".tuner-card").dataset.state=state;
        $("tunerNeedle").style.transform="translateX(-50%) rotate("+Math.max(-42,Math.min(42,cents*.84))+"deg)";
      }else resetTuner();
      raf=requestAnimationFrame(tick);
    };
    tick();$("stopTuner").disabled=false;
  }catch(e){if(epoch===tunerEpoch){stopTuner();report(mediaError(e))}}
  finally{tunerStarting=false;$("startTuner").disabled=recordBusy||!!micStream}
}
function stopTuner(){
  tunerEpoch++;
  cancelAnimationFrame(raf);analyser?.disconnect();micStream?.getTracks().forEach(t=>t.stop());micStream=null;
  $("startTuner").disabled=recordBusy;$("stopTuner").disabled=true;resetTuner();
}
$("startTuner").onclick=startTuner;$("stopTuner").onclick=stopTuner;

async function importTake(file,target="source"){
  const token=++importId;importBusy=true;invalidateRender();syncControls();report("Opening "+file.name+"…");
  try{
    if(!file.size)throw new Error("This file is empty. Choose a recording with audio.");
    if(file.size>150*1024*1024)throw new Error("This file is larger than 150 MB. Trim it or use a smaller recording.");
    const bytes=await file.arrayBuffer();
    audioCtx ||= new AudioContext();
    let decoded;
    try{decoded=await audioCtx.decodeAudioData(bytes.slice(0))}catch{throw new Error("Cannot decode this audio format in this browser. Try a WAV or MP3 file, or record a take here.")}
    if(!decoded.length||!Number.isFinite(decoded.duration))throw new Error("No playable audio was found.");
    const identity={name:file.name,type:file.type,size:file.size,sha256:await audioIdentity(bytes)};
    if(token!==importId)return;
    if(target==="source"){
      const reopening=pendingSourceRestore&&matchesSource(project.source,identity);
      const legacy=pendingSourceRestore&&!project.source?.sha256&&project.source?.name===file.name&&(!project.source.size||project.source.size===file.size);
      sourceChanged();
      if(reopening)project.source={...project.source,...identity,originalPreserved:true};
      else if(legacy){
        project={...project,source:{...identity,originalPreserved:true},analysis:null,arrangement:null,stems:{drums:null,bass:null,lead:null}};
      }
      else{
        project=setSource(project,identity);
      }
      pendingSourceRestore=false;
      loadedArrayBuffer=bytes;decodedBuffer=decoded;sourceIdentity=identity;currentAudioName=file.name;resetSourceUrl(file);
      $("meta").textContent=file.name+" · "+Math.round(file.size/1024)+" KB · "+(reopening?"project source restored":legacy?"legacy source attached — analyze again; verify saved regions":"original preserved");
      await refreshWaveform();
    }else{
      const previous=project.tracks[target],restoring=matchesSource(previous?.source,identity);
      clearTrack(target);trackBuffers[target]=decoded;trackUrls[target]=URL.createObjectURL(file);$(target+"Player").src=trackUrls[target];
      project.tracks[target]={gain:previous?.gain??1,offsetSec:previous?.offsetSec??0,source:{...identity,originalPreserved:true,...(restoring?{localAudioRequired:true}:{})}};
    }
    report(file.name+" is ready. "+(target==="source"?"Play the take, then analyze it.":"Adjust its start offset if needed, then render the mix."));
  }catch(e){if(token===importId)report(mediaError(e)+" Your previous take is still available.")}
  finally{if(token===importId){importBusy=false;syncControls()}}
}
for(const id of ["audioFile","audioFileAll"]){
  const input=$(id);if(id==="audioFile")input.accept=AUDIO_ACCEPT;
  input.onchange=()=>{const file=input.files?.[0];input.value="";if(file)void importTake(file)};
  input.addEventListener("cancel",()=>report("File selection canceled. Your current take is unchanged."));
}
quickRecord?.addEventListener("click",()=>$("recordBtn").click());
quickPlay?.addEventListener("click",async()=>{
  const player=$("player");
  try{if(player.paused){stopPlayback();await player.play()}else player.pause()}
  catch(e){report("Playback could not start. "+mediaError(e))}
});
$("player").addEventListener("play",()=>quickPlay.textContent="Pause Take");
for(const event of ["pause","ended"])$("player").addEventListener(event,()=>quickPlay.textContent="Play Take");
$("player").addEventListener("error",()=>report("Playback failed. Try a WAV or MP3 recording."));
$("saveOriginalBtn").onclick=()=>{if(sourceBlob)downloadBlob(sourceBlob,currentAudioName)};


$("projectFile").onchange=async e=>{
  const file=e.target.files?.[0];e.target.value="";if(!file)return;
  const token=++importId;importBusy=true;syncControls();
  try{
    const next=deserializeProject(await file.text());if(token!==importId)return;
    sourceChanged();invalidateRender();
    if(!matchesSource(next.source,sourceIdentity)){
      loadedArrayBuffer=null;decodedBuffer=null;currentAudioName=null;sourceIdentity=null;resetSourceUrl(null);clearWaveform();
    }
    for(const id of EXTRA_TRACKS)if(!matchesSource(next.tracks?.[id]?.source,project.tracks?.[id]?.source))clearTrack(id);
    project=next;
    pendingSourceRestore=!hasMatchingAudio();
    $("meta").textContent="Project loaded · source audio required: "+(project.source?.name||"unknown");
    syncControls();if(loadedArrayBuffer)await refreshWaveform();
    report(allAudioPresent()?"Project restored. Ready to render.":"Project settings restored. Reselect the saved source and any additional takes. Audio is not embedded in project files.");
  }catch(err){if(token===importId)report("Project could not be loaded: "+err.message)}
  finally{if(token===importId){importBusy=false;syncControls()}}
};
$("saveProjectBtn").onclick=()=>{
  try{const json=serializeProject(project);deserializeProject(json);downloadBlob(new Blob([json],{type:"application/json"}),baseName()+".omjbs.json")}
  catch(e){report("Project cannot be saved: "+e.message)}
};

$("recordBtn").onclick=async()=>{
  if(recordBusy||importBusy)return;
  recordBusy=true;syncControls();stopTuner();stopPlayback();
  const target=$("recordTarget").value;
  let stream;
  try{
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined")throw new Error("Recording needs HTTPS or localhost and a browser with microphone recording support. You can still choose an audio file.");
    if(target!=="source"&&!loadedArrayBuffer)throw new Error("Load or record the original take before recording another track.");
    report("Waiting for microphone permission…");
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const mimeType=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(t=>MediaRecorder.isTypeSupported(t));
    const recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined),parts=[];let failed=false;
    mediaRecorder=recorder;
    recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
    recorder.onerror=e=>{failed=true;report("Recording failed. "+mediaError(e.error));stream.getTracks().forEach(t=>t.stop());recordBusy=false;$("stopRecordBtn").disabled=true;syncControls()};
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());mediaRecorder=null;
      if(failed)return;
      const type=recorder.mimeType||parts[0]?.type||"audio/webm",ext=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
      const blob=new File(parts,[target,"recording",Date.now()].join("-")+"."+ext,{type});
      recordBusy=false;$("stopRecordBtn").disabled=true;
      await importTake(blob,target);syncControls();
    };
    recorder.start(250);$("stopRecordBtn").disabled=false;report("Recording "+(TRACK_NAMES[target]||"Original")+"… Press Stop when finished.");
  }catch(e){stream?.getTracks().forEach(t=>t.stop());recordBusy=false;syncControls();report(mediaError(e))}
};
$("stopRecordBtn").onclick=()=>{
  if(mediaRecorder?.state==="recording"){ $("stopRecordBtn").disabled=true;report("Finishing recording…");mediaRecorder.stop() }
};


$("analyzeBtn").onclick=async()=>{
  const epoch=sourceEpoch;
  try{
    invalidateArrangement();report("Analyzing tempo and chords…");
    const decoded=await decodeCurrent(),analysis=await analyzeAudioBuffer(decoded);
    if(epoch!==sourceEpoch)return;
    project.analysis=analysis;syncControls();
    $("arrangement").textContent="Analysis complete. Generate an arrangement.";
    report("Analysis complete. Review the estimated tempo and chords; set the first beat if the take starts with silence or a count-in.");
  }catch(e){report(mediaError(e))}
};


$("applyChordsBtn").onclick=()=>{
  try{
    const timeline=validateChords(JSON.parse($("chordEditor").value),decodedBuffer?.duration??Infinity);
    project.analysis={...project.analysis,chordTimeline:timeline};$("chordStatus").textContent=`Applied ${timeline.length} chord regions.`;invalidateArrangement();
  }catch(e){$("chordStatus").textContent=e.message}
};

$("addRegionBtn").onclick=()=>{
  const start=Number($("regionStart").value),end=Number($("regionEnd").value);
  if(!decodedBuffer||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>decodedBuffer.duration){report("Choose a start and end within the take, with the end after the start.");return}
  project=addMuteRegion(project,start,end,$("regionLabel").value||"No accompaniment");
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
canvas.addEventListener("pointercancel",()=>{dragStartX=null});
window.addEventListener("resize",()=>{if(waveformPeaks)drawWaveform(canvas,waveformPeaks,waveformDuration,project.regions||[])});

$("arrangeBtn").onclick=async()=>{
  const epoch=sourceEpoch;
  try{
    const decoded=await decodeCurrent();if(epoch!==sourceEpoch)return;
    const a=project.analysis,bpm=Number($("tempoBpm").value),offsetSec=Number($("beatOffset").value),seed=Number($("seed").value);
    if(!Number.isFinite(bpm)||bpm<40||bpm>220||!Number.isFinite(offsetSec)||offsetSec<0||offsetSec>=decoded.duration||!Number.isInteger(seed)||seed<1)throw new Error("Use a tempo from 40 to 220 BPM, a first beat within the take, and a positive whole-number seed.");
    project.timing={bpm,offsetSec};project.seed=seed;
    project.arrangement=buildArrangement({bpm,offsetSec,durationSec:decoded.duration,key:a?.keyEstimate?.key||"C major",seed,chordTimeline:a?.chordTimeline||[],muteRegions:project.regions||[]});
    project.stems={drums:{events:project.arrangement.drums.length},bass:{events:project.arrangement.bass.length},lead:{events:project.arrangement.lead.length}};
    invalidateRender();syncControls();report("Band ready. Adjust track levels, then render and listen.");
  }catch(e){report(e.message)}
};
for(const id of ["tempoBpm","beatOffset","seed"])$(id).oninput=()=>{
  project.timing={bpm:Number($("tempoBpm").value),offsetSec:Number($("beatOffset").value)};project.seed=Number($("seed").value);invalidateArrangement();
};


$("drumStyle").onchange=e=>setProduction("drumStyle",e.target.value);
$("bassStyle").onchange=e=>setProduction("bassStyle",e.target.value);
$("leadStyle").onchange=e=>setProduction("leadStyle",e.target.value);
$("timingMs").oninput=e=>{e.target.nextElementSibling.value=e.target.value;setProduction("timingMs",Number(e.target.value))};
$("swingAmount").oninput=e=>{e.target.nextElementSibling.value=Number(e.target.value).toFixed(2);setProduction("swing",Number(e.target.value))};

document.querySelectorAll("[data-mix]").forEach(input=>{
  input.oninput=()=>{project.mix[input.dataset.mix]=Number(input.value);input.nextElementSibling.value=Number(input.value).toFixed(2);const track=document.querySelector('[data-track-gain="'+input.dataset.mix+'"]');if(track)track.value=input.value;invalidateRender()};
});
document.querySelectorAll("[data-track-gain]").forEach(input=>{
  input.oninput=()=>{const key=input.dataset.trackGain;project.mix[key]=Number(input.value);const mixer=document.querySelector(`[data-mix="${key}"]`);if(mixer){mixer.value=input.value;mixer.nextElementSibling.value=Number(input.value).toFixed(2)}invalidateRender()};
});
$("masterPreset").onchange=e=>{project.mastering.preset=e.target.value;invalidateRender()};
$("roomAmount").oninput=e=>{project.mastering.room=Number(e.target.value);e.target.nextElementSibling.value=Number(e.target.value).toFixed(2);invalidateRender()};

async function renderSession(stems=false){
  if(renderBusy||!allAudioPresent()||!project.arrangement)return;
  if(stems)clearStemDownloads();else invalidateRender();
  const token=revision,snapshot=structuredClone(project),external={...neuralStemBuffers},takes={...trackBuffers};
  renderBusy=true;syncControls();$("renderStatus").textContent=stems?"Preparing individual WAV stems…":"Rendering studio mix…";
  try{
    const decoded=await decodeCurrent();
    if(stems){
      const results=[];
      for(const stem of ["original","drums","bass","lead",...EXTRA_TRACKS.filter(id=>takes[id])]){
        const buffer=await renderProjectStem(decoded,snapshot,stem,external,takes);
        if(token!==revision)return;
        results.push({stem,blob:new Blob([audioBufferToWav(buffer)],{type:"audio/wav"})});
      }
      for(const {stem,blob} of results){
        const a=document.createElement("a"),url=URL.createObjectURL(blob);stemDownloadUrls.push(url);
        a.href=url;a.download=baseName()+"-"+stem+".wav";a.textContent="Download "+(TRACK_NAMES[stem]||stem)+" WAV";$("stemDownloads").append(a);
      }
      $("renderStatus").textContent="Stem renders complete. Download each WAV below. Stems are aligned, pre-fader and without master effects.";
    }else{
      const buffer=await renderProjectMix(decoded,snapshot,external,takes);
      if(token!==revision)return;
      const meter=measureAudioBuffer(buffer),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
      const tp=estimateTruePeak(channels),loud=estimateIntegratedLoudness(channels,buffer.sampleRate);
      renderedBuffer=buffer;mixUrl=URL.createObjectURL(new Blob([audioBufferToWav(buffer)],{type:"audio/wav"}));$("mixPlayer").src=mixUrl;$("downloadBtn").disabled=false;
      $("renderStatus").textContent="Rendered "+buffer.duration.toFixed(1)+"s stereo WAV · peak "+meter.peakDb+" dBFS · true-peak est. "+tp.dbTP+" dBTP · loudness est. "+loud.lufs+" LUFS.";
    }
  }catch(e){if(token===revision)$("renderStatus").textContent="Render failed: "+e.message}
  finally{
    renderBusy=false;syncControls();
    if(token!==revision)$("renderStatus").textContent="Session changed during rendering. Render again to use the current settings.";
  }
}
$("renderBtn").onclick=()=>renderSession();
$("downloadBtn").onclick=()=>{if(renderedBuffer)downloadWav(renderedBuffer,"mix")};
$("exportStemsBtn").onclick=()=>renderSession(true);


$("aceCheckBtn").onclick=async()=>{
  try{
    const {endpoint,apiKey}=aceRuntime();$("aceStatus").textContent="Checking neural server…";
    const result=await checkAceStep({endpoint,apiKey});$("aceStatus").textContent=`Neural server reachable at ${result.endpoint}.`;
  }catch(e){$("aceStatus").textContent=`Neural server check failed: ${e.message}`}
};
$("aceAllBtn").onclick=()=>runNeural(["drums","bass","lead"]);
document.querySelectorAll("[data-neural-generate]").forEach(btn=>btn.onclick=()=>runNeural([btn.dataset.neuralGenerate]));
document.querySelectorAll("[data-neural-clear]").forEach(btn=>btn.onclick=()=>{clearNeuralStem(btn.dataset.neuralClear);syncControls();$("aceStatus").textContent=`${btn.dataset.neuralClear} reverted to local renderer.`});
$("aceCancelBtn").onclick=()=>neuralAbort?.abort();

for(const id of EXTRA_TRACKS){
  const save=document.createElement('a');save.id=id+'Save';save.textContent='Save '+TRACK_NAMES[id]+' Original Audio';save.hidden=true;
  $(id+'Remove').after(save);
  const input=$(id+"File");input.accept=AUDIO_ACCEPT;
  input.onchange=()=>{const file=input.files?.[0];input.value="";if(file)void importTake(file,id)};
  $(id+"Gain").oninput=e=>{project.tracks[id]={...(project.tracks[id]||{}),gain:Number(e.target.value)};invalidateRender()};
  $(id+"Offset").oninput=e=>{
    const offset=Number(e.target.value);if(!Number.isFinite(offset)||Math.abs(offset)>600){e.target.value=project.tracks[id]?.offsetSec??0;report("Track offset must be between -600 and 600 seconds.");return}
    project.tracks[id]={...(project.tracks[id]||{}),offsetSec:offset};invalidateRender();
  };
  $(id+"Remove").onclick=()=>{clearTrack(id);delete project.tracks[id];invalidateRender();syncControls()};
}
window.addEventListener("pagehide",()=>{stopTuner();if(mediaRecorder?.state==="recording")mediaRecorder.stop();neuralAbort?.abort()});
syncControls();
clearWaveform();
