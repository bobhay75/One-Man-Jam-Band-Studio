import { autoCorrelate, noteName, createTunerTracker, TUNER_INTERVAL_MS } from "./tuner.js";
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

import { parseAudioLink, fetchAudioLink } from "./audio-link.js";
import { PRESETS as VOCAL_PRESETS, enhanceAudio as enhanceVocalAudio, encodeWav as encodeVocalWav, makeDemoBuffer } from "./vocal-engine.js";

let project = createProject();
let audioLinkAbort = null;
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null, decodedBuffer = null, renderedBuffer = null, mixUrl = null, currentAudioName = null;
let waveformPeaks = null, waveformDuration = 0, dragStartX = null;
let neuralStemBuffers = {drums:null,bass:null,lead:null};
let neuralStemUrls = {drums:null,bass:null,lead:null};
let neuralAbort = null;
let mediaRecorder = null, recordingStream = null, recordingEpoch = 0;
let revision = 0, sourceEpoch = 0, importId = 0, importBusy = false, recordBusy = false, renderBusy = false;
let sourceUrl = null, sourceBlob = null, sourceIdentity = null, tunerStarting = false, tunerEpoch = 0;
let trackBuffers = {}, trackUrls = {}, stemDownloadUrls = [];
let pendingSourceRestore = false;
let vocalBusy = false, analysisBusy = false, demoBusy = false;
let vocalTarget = "track6", vocalPreviewMode = "original";
const vocalResults = new Map(), vocalSettings = new Map();
const VOCAL_TARGETS = ["track6","track7","source"];
const $ = id => document.getElementById(id);
const quickRecord = $("quickRecordBtn"), quickPlay = $("quickPlayBtn");
function report(message){$("sessionStatus").textContent=message}
function studioBusy(){return importBusy||recordBusy||renderBusy||vocalBusy||analysisBusy||demoBusy||!!neuralAbort}
function vocalName(target){return target==="source"?"Guitar / Original":TRACK_NAMES[target]||"Vocal"}
function vocalOriginal(target){return target==="source"?decodedBuffer:trackBuffers[target]||null}
function vocalOriginalUrl(target){return target==="source"?sourceUrl:trackUrls[target]||null}
function vocalState(target=vocalTarget){
  if(!vocalSettings.has(target)){
    const preset=VOCAL_PRESETS.find(item=>item.id===(target==="source"?"natural":"singing"));
    vocalSettings.set(target,{preset:preset.id,settings:{...preset.settings}});
  }
  return vocalSettings.get(target);
}
function currentVocalResult(target=vocalTarget){
  const result=vocalResults.get(target);
  return result&&result.original===vocalOriginal(target)?result:null;
}
function effectiveVocalBuffer(target,original){
  const result=vocalResults.get(target);
  return result?.active&&result.original===original?result.buffer:original;
}
function vocalFeedback(message="",error=false){
  $("vocalFeedback").textContent=message;$("vocalFeedback").hidden=!message;
  $("vocalFeedback").classList.toggle("error",error);
}
function clearVocalResult(target){
  const result=vocalResults.get(target);
  if(!result)return;
  if(vocalTarget===target){$("vocalPreviewPlayer").pause();vocalPreviewMode="original"}
  URL.revokeObjectURL(result.url);vocalResults.delete(target);
  if(result.active)invalidateRender();
}
function clearAllVocalResults(){
  for(const target of VOCAL_TARGETS)clearVocalResult(target);
  vocalSettings.clear();vocalPreviewMode="original";vocalFeedback();
}
function updateVocalPreview({resume=false,time=0}={}){
  const result=currentVocalResult();
  if(vocalPreviewMode==="enhanced"&&!result)vocalPreviewMode="original";
  const url=vocalPreviewMode==="enhanced"?result.url:vocalOriginalUrl(vocalTarget),player=$("vocalPreviewPlayer");
  if(player.getAttribute("src")!==(url||null)){
    player.pause();player.onloadedmetadata=null;
    if(url){
      player.onloadedmetadata=()=>{
        player.onloadedmetadata=null;
        if(Number.isFinite(player.duration))player.currentTime=Math.max(0,Math.min(time,player.duration));
        if(resume&&!studioBusy())player.play().catch(error=>vocalFeedback("Playback could not start. "+mediaError(error),true));
      };
      player.src=url;
    }else player.removeAttribute("src");
    player.load();
  }
  $("vocalOriginalBtn").setAttribute("aria-pressed",String(vocalPreviewMode==="original"));
  $("vocalEnhancedBtn").setAttribute("aria-pressed",String(vocalPreviewMode==="enhanced"));
  $("vocalPreviewLabel").textContent=(vocalPreviewMode==="enhanced"?"Enhanced":"Original")+" preview · "+vocalName(vocalTarget);
}
function syncVocalUi(){
  const original=vocalOriginal(vocalTarget),result=currentVocalResult(),state=vocalState(),busy=studioBusy();
  $("vocalTarget").value=vocalTarget;$("vocalTarget").disabled=busy;
  $("vocalChooseBtn").textContent="Choose "+(vocalTarget==="source"?"original":vocalName(vocalTarget))+" audio";
  $("vocalChooseBtn").disabled=busy||(vocalTarget!=="source"&&!loadedArrayBuffer);
  $("vocalRecordBtn").textContent="Record "+(vocalTarget==="source"?"original":vocalName(vocalTarget));
  $("vocalRecordBtn").disabled=busy||(vocalTarget!=="source"&&!loadedArrayBuffer);
  $("vocalDemoBtn").disabled=busy||!!project.source||!!loadedArrayBuffer;
  $("vocalEnhanceBtn").disabled=busy||!original||original.duration>300.05||original.numberOfChannels>2;
  $("vocalApplyBtn").disabled=busy||!result||result.active;
  $("vocalBypassBtn").disabled=busy||!result?.active;
  $("vocalDownloadBtn").disabled=busy||!result;
  $("vocalOriginalBtn").disabled=busy||!original;
  $("vocalEnhancedBtn").disabled=busy||!result;
  $("vocalProgressWrap").hidden=!vocalBusy;
  for(const input of document.querySelectorAll("[data-vocal-setting]")){
    input.value=state.settings[input.dataset.vocalSetting];input.disabled=busy;
    $(input.id+"Value").value=input.value;
  }
  for(const button of document.querySelectorAll("[data-vocal-preset]")){
    button.disabled=busy;button.setAttribute("aria-pressed",String(button.dataset.vocalPreset===state.preset));
  }
  if(original){
    const source=vocalTarget==="source"?project.source:project.tracks?.[vocalTarget]?.source;
    $("vocalTrackInfo").textContent=`${source?.name||vocalName(vocalTarget)} · ${original.duration.toFixed(1)}s · ${original.numberOfChannels===1?"Mono":"Stereo"}${vocalTarget==="source"?" · All sounds in this original, including guitar, will be processed.":""}`;
  }else $("vocalTrackInfo").textContent=!loadedArrayBuffer&&vocalTarget!=="source"?"Load your guitar/original take in Start Here, then add a Vocal or Harmony. Select Track 1 to polish an existing voice recording.":"Choose or record audio for "+vocalName(vocalTarget)+" to begin.";
  if(!vocalBusy){
    $("vocalStatus").textContent=!original?"The original track is preserved. Add a vocal to get started.":original.duration>300.05?"This take is over 5 minutes. Import a shorter voice take for VocalLift; the existing studio track is unchanged.":original.numberOfChannels>2?"VocalLift needs a mono or stereo take. The existing studio track is unchanged.":result?.active?"VocalLift is active on "+vocalName(vocalTarget)+". Render the studio mix or stems again to hear it with the band.":result?"Enhanced take ready to compare. The mix still uses the original until you choose Use enhanced in mix.":"Choose a sound and enhance this take. The mix currently uses the original.";
  }
  $("vocalChanges").replaceChildren();$("vocalChanges").hidden=!result;
  if(result)for(const change of result.result.changes){const item=document.createElement("li");item.textContent=change;$("vocalChanges").append(item)}
  updateVocalPreview();
}
async function enhanceSelectedVocal(){
  if(studioBusy())return;
  const target=vocalTarget,original=vocalOriginal(target);
  if(!original)return;
  const settings={...vocalState(target).settings};
  vocalBusy=true;stopTuner();stopPlayback();vocalFeedback();syncControls();
  $("vocalProgress").value=0;$("vocalProgressText").textContent="Preparing your vocal…";
  $("vocalStatus").textContent="Enhancing "+vocalName(target)+" on this device. Your original stays untouched.";
  try{
    const result=await enhanceVocalAudio(original,settings,(fraction,label)=>{
      $("vocalProgress").value=fraction;$("vocalProgressText").textContent=label||"Enhancing your vocal…";
    });
    if(vocalOriginal(target)!==original)throw new Error("The selected take changed. Enhance the current take again.");
    const blob=encodeVocalWav(result.buffer),url=URL.createObjectURL(blob);
    clearVocalResult(target);
    vocalResults.set(target,{original,buffer:result.buffer,blob,url,active:false,settings:{...settings},result});
    vocalPreviewMode="enhanced";
    vocalFeedback("Compare Original and Enhanced, then choose Use enhanced in mix. Enhancement does not change pitch or isolate a voice from other sounds.");
  }catch(error){vocalFeedback("VocalLift could not finish: "+error.message+" Your original is unchanged. A shorter take may help on a low-memory device.",true)}
  finally{vocalBusy=false;syncControls()}
}
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
  clearVocalResult(id);
  if(trackUrls[id])URL.revokeObjectURL(trackUrls[id]);delete trackUrls[id];delete trackBuffers[id];
  const audio=$(`${id}Player`);audio.pause();audio.removeAttribute("src");audio.load();
}
function allAudioPresent(){return hasMatchingAudio()&&EXTRA_TRACKS.every(id=>!project.tracks?.[id]?.source||trackBuffers[id])}
function sourceChanged(){sourceEpoch++;neuralAbort?.abort();stopPlayback();clearVocalResult("source");clearAllNeural()}

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
  const localBusy=importBusy||recordBusy||renderBusy||vocalBusy||analysisBusy||demoBusy;
  $("aceCancelBtn").disabled=!busy;
  $("aceCheckBtn").disabled=busy||localBusy;
  $("aceAllBtn").disabled=busy||localBusy||!hasMatchingAudio();
  document.querySelectorAll("[data-neural-generate]").forEach(b=>b.disabled=busy||localBusy||!hasMatchingAudio());
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
    const clear=document.querySelector(`[data-neural-clear="${stem}"]`);if(clear)clear.disabled=!active||studioBusy();
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
  const busy=studioBusy();
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
    $(`${id}State`).textContent=trackBuffers[id]?`${t.source.name} · ${currentVocalResult(id)?.active?"VocalLift in mix":"ready"}`:t?.source?`Restore ${t.source.name}`:"Empty";
    $(`${id}Remove`).disabled=!t?.source||busy;
    $(`${id}Gain`).disabled=busy;$(`${id}Offset`).disabled=busy;
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
  $("applyChordsBtn").disabled=!project.analysis||busy;
  $("arrangement").textContent=arrangementSummary();renderRegions();
  const matching=hasMatchingAudio()&&!busy;
  if(quickPlay)quickPlay.disabled=!loadedArrayBuffer||busy;
  const state1=$("trackState1");if(state1)state1.textContent=loadedArrayBuffer?(currentVocalResult("source")?.active?"VocalLift in mix":currentAudioName==="recording"?"Recorded take ready":"Imported take ready"):"Waiting for a take";
  $("analyzeBtn").disabled=!matching;
  $("arrangeBtn").disabled=!(project.analysis&&project.analysis.status!=="silent"&&project.analysis.status!=="low-confidence"&&matching);
  $("renderBtn").disabled=!(project.arrangement&&matching&&allAudioPresent())||renderBusy;
  $("exportStemsBtn").disabled=$("renderBtn").disabled;
  $("recordBtn").disabled=busy;quickRecord.disabled=busy;
  $("startTuner").disabled=busy||tunerStarting||!!micStream;
  $("openAudioLink").disabled=busy;$("cancelAudioLink").disabled=!audioLinkAbort;
  $("audioFile").disabled=busy;$("audioFileAll").disabled=busy;
  $("projectFile").disabled=busy;$("recordTarget").disabled=busy;
  $("saveOriginalBtn").disabled=!sourceBlob||busy;
  $("saveProjectBtn").disabled=busy;
  $("downloadBtn").disabled=busy||!renderedBuffer;
  $("addRegionBtn").disabled=busy;
  document.querySelectorAll('[data-track-file]').forEach(input=>input.disabled=busy||!loadedArrayBuffer);
  document.querySelectorAll('[data-mix],[data-track-gain]').forEach(input=>input.disabled=busy);
  for(const id of ["tempoBpm","beatOffset","seed","drumStyle","bassStyle","leadStyle","timingMs","swingAmount","masterPreset","roomAmount","chordEditor"])$(id).disabled=busy;
  syncNeuralUi();
  syncVocalUi();
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
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
  if(studioBusy()||!hasMatchingAudio())return;
  neuralAbort=new AbortController();stopTuner();syncControls();
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
  $("tunerAnnouncement").textContent="Play one note and let it ring.";
  $("tunerTarget").textContent="Target: --";$("tunerStatus").textContent="PLAY A NOTE";
  document.querySelector(".tuner-card").dataset.state="waiting";
  $("tunerNeedle").style.transform="translateX(-50%) rotate(0deg)";
}
async function startTuner(){
  if(tunerStarting||micStream||studioBusy())return;
  const epoch=++tunerEpoch;
  tunerStarting=true;$("startTuner").disabled=true;$("stopTuner").disabled=false;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone access needs HTTPS or localhost and a supported browser.");
    audioCtx ||= new AudioContext();await audioCtx.resume();
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(epoch!==tunerEpoch){stream.getTracks().forEach(t=>t.stop());return}
    micStream=stream;
    const source=audioCtx.createMediaStreamSource(micStream);analyser=audioCtx.createAnalyser();analyser.fftSize=4096;source.connect(analyser);
    const buf=new Float32Array(analyser.fftSize),tracker=createTunerTracker();
    let lastAnalysis=-Infinity,lastAnnouncement="";
    const tick=(now)=>{
      if(epoch!==tunerEpoch)return;
      raf=requestAnimationFrame(tick);
      if(now-lastAnalysis<TUNER_INTERVAL_MS)return;
      lastAnalysis=now;
      analyser.getFloatTimeDomainData(buf);
      const reading=tracker.update(autoCorrelate(buf,audioCtx.sampleRate),now);
      if(reading){
        const {note:n,cents,state,frequency:freq}=reading;
        $("note").textContent=noteName(n);$("freq").textContent=freq.toFixed(1)+" Hz";
        $("cents").textContent=(cents>0?"+":"")+cents+" cents";
        $("tunerTarget").textContent="Target: "+(440*Math.pow(2,(n-69)/12)).toFixed(1)+" Hz";
        $("tunerStatus").textContent=state==="in-tune"?"IN TUNE":state==="flat"?"TOO FLAT — tighten string":"TOO SHARP — loosen string";
        document.querySelector(".tuner-card").dataset.state=state;
        $("tunerNeedle").style.transform="translateX(-50%) rotate("+Math.max(-42,Math.min(42,cents*.84))+"deg)";
        const announcement=noteName(n)+": "+$("tunerStatus").textContent;
        if(announcement!==lastAnnouncement){$("tunerAnnouncement").textContent=announcement;lastAnnouncement=announcement}
      }else if(lastAnnouncement!=="waiting"){
        resetTuner();lastAnnouncement="waiting";
      }
    };
    raf=requestAnimationFrame(tick);$("stopTuner").disabled=false;
  }catch(e){if(epoch===tunerEpoch){stopTuner();report(mediaError(e))}}
  finally{tunerStarting=false;$("startTuner").disabled=studioBusy()||!!micStream}
}
function stopTuner(){
  tunerEpoch++;
  cancelAnimationFrame(raf);analyser?.disconnect();micStream?.getTracks().forEach(t=>t.stop());micStream=null;
  $("startTuner").disabled=studioBusy();$("stopTuner").disabled=true;resetTuner();
}
$("startTuner").onclick=startTuner;$("stopTuner").onclick=stopTuner;

async function importTake(file,target="source",fromLink=false){
  if(recordBusy||renderBusy||vocalBusy||analysisBusy||neuralAbort)return;
  stopTuner();
  if(!fromLink)cancelAudioLink("Link import replaced by a newer take.");
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

function cancelAudioLink(message="") {
  if(!audioLinkAbort)return;
  audioLinkAbort.abort();audioLinkAbort=null;importId++;importBusy=false;
  if(message)$("audioLinkStatus").textContent=message;
  syncControls();
}
$("cancelAudioLink").onclick=()=>cancelAudioLink("Link import canceled. Your current take is unchanged.");
$("getDriveAudio").onclick=()=>{
  $("driveReturnHelp").hidden=false;
  $("audioLink").focus();
  $("audioLink").scrollIntoView({block:"nearest",behavior:"smooth"});
};
$("audioLink").oninput=()=>{
  cancelAudioLink("Link changed. Press Use Audio Link when ready.");
  $("driveAudioLink").hidden=true;$("driveAudioLink").removeAttribute("href");
};
$("audioLinkForm").onsubmit=async event=>{
  event.preventDefault();
  if(studioBusy())return;
  const drive=$("driveAudioLink");drive.hidden=true;drive.removeAttribute("href");
  let link;
  try{link=parseAudioLink($("audioLink").value)}
  catch(error){$("audioLinkStatus").textContent=error.message;return}
  if(link.kind==="drive"){
    drive.href=link.url;drive.hidden=false;$("driveReturnHelp").hidden=false;
    $("audioLinkStatus").textContent="Drive link recognized. Open the file below, download the audio, then return and use Choose Audio File or Browse all files. Studio cannot sign in to Drive for you. Your current take is unchanged.";
    return;
  }
  const controller=new AbortController(),token=++importId;
  audioLinkAbort=controller;importBusy=true;syncControls();
  $("audioLinkStatus").textContent="Downloading audio…";
  let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},30000);
  try{
    const file=await fetchAudioLink(link.url,{signal:controller.signal});
    if(token!==importId||controller.signal.aborted)return;
    clearTimeout(timeout);
    $("audioLinkStatus").textContent="Download complete. Checking audio…";
    const imported=importTake(file,"source",true),decodeToken=importId;
    await imported;
    if(decodeToken===importId)$("audioLinkStatus").textContent=$("sessionStatus").textContent;
  }catch(error){
    if(token===importId)$("audioLinkStatus").textContent=(timedOut?"The download timed out.":error.name==="TypeError"?"This host does not allow Studio to download the audio.":error.message)+" Download the file yourself and use Choose Audio File. Your current take is unchanged.";
  }finally{
    clearTimeout(timeout);controller.abort();
    if(audioLinkAbort===controller){audioLinkAbort=null;importBusy=false;syncControls()}
  }
};

quickRecord?.addEventListener("click",()=>{
  if(studioBusy())return;
  $("recordTarget").value="source";$("recordBtn").click();
});
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
  if(studioBusy())return;
  cancelAudioLink();
  const token=++importId;importBusy=true;syncControls();
  try{
    const next=deserializeProject(await file.text());if(token!==importId)return;
    sourceChanged();clearAllVocalResults();invalidateRender();
    if(!matchesSource(next.source,sourceIdentity)){
      loadedArrayBuffer=null;decodedBuffer=null;currentAudioName=null;sourceIdentity=null;resetSourceUrl(null);clearWaveform();
    }
    for(const id of EXTRA_TRACKS)if(!matchesSource(next.tracks?.[id]?.source,project.tracks?.[id]?.source))clearTrack(id);
    project=next;
    pendingSourceRestore=!hasMatchingAudio();
    $("meta").textContent="Project loaded · source audio required: "+(project.source?.name||"unknown");
    syncControls();if(loadedArrayBuffer)await refreshWaveform();
    report((allAudioPresent()?"Project restored. Ready to render.":"Project settings restored. Reselect the saved source and any additional takes. Audio is not embedded in project files.")+" VocalLift results are session-only; reapply them or import a saved enhanced WAV.");
  }catch(err){if(token===importId)report("Project could not be loaded: "+err.message)}
  finally{if(token===importId){importBusy=false;syncControls()}}
};
$("saveProjectBtn").onclick=()=>{
  if(studioBusy())return;
  try{const json=serializeProject(project);deserializeProject(json);downloadBlob(new Blob([json],{type:"application/json"}),baseName()+".omjbs.json");report("Project settings download requested. Keep every original take and download enhanced VocalLift WAVs separately; VocalLift results are not saved in the project.")}
  catch(e){report("Project cannot be saved: "+e.message)}
};

$("recordBtn").onclick=async()=>{
  if(studioBusy())return;
  const epoch=++recordingEpoch;
  recordBusy=true;syncControls();$("stopRecordBtn").disabled=false;stopTuner();stopPlayback();
  const target=$("recordTarget").value;
  let stream;
  try{
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined")throw new Error("Recording needs HTTPS or localhost and a browser with microphone recording support. You can still choose an audio file.");
    if(target!=="source"&&!loadedArrayBuffer)throw new Error("Load or record the original take before recording another track.");
    report("Waiting for microphone permission…");
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(epoch!==recordingEpoch){stream.getTracks().forEach(t=>t.stop());return}
    recordingStream=stream;
    const mimeType=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(t=>MediaRecorder.isTypeSupported(t));
    const recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined),parts=[];let failed=false;
    mediaRecorder=recorder;
    recorder.ondataavailable=e=>{if(epoch===recordingEpoch&&e.data.size)parts.push(e.data)};
    recorder.onerror=e=>{stream.getTracks().forEach(t=>t.stop());if(epoch!==recordingEpoch)return;failed=true;report("Recording failed. "+mediaError(e.error));stream.getTracks().forEach(t=>t.stop());recordBusy=false;$("stopRecordBtn").disabled=true;syncControls()};
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      if(epoch!==recordingEpoch)return;
      mediaRecorder=null;recordingStream=null;
      if(failed)return;
      const type=recorder.mimeType||parts[0]?.type||"audio/webm",ext=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
      const blob=new File(parts,[target,"recording",Date.now()].join("-")+"."+ext,{type});
      recordBusy=false;$("stopRecordBtn").disabled=true;
      await importTake(blob,target);syncControls();
    };
    recorder.start(250);$("stopRecordBtn").disabled=false;report("Recording "+(TRACK_NAMES[target]||"Original")+"… Press Stop when finished.");
  }catch(e){stream?.getTracks().forEach(t=>t.stop());if(epoch!==recordingEpoch)return;recordingStream=null;recordBusy=false;$("stopRecordBtn").disabled=true;syncControls();report(mediaError(e))}
};
function cancelRecording(){
  recordingEpoch++;
  recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;
  const recorder=mediaRecorder;mediaRecorder=null;
  if(recorder?.state==="recording")recorder.stop();
  recordBusy=false;$("stopRecordBtn").disabled=true;syncControls();
  report("Recording canceled. Your current take is unchanged.");
}
$("stopRecordBtn").onclick=()=>{
  if(mediaRecorder?.state==="recording"){ $("stopRecordBtn").disabled=true;report("Finishing recording…");mediaRecorder.stop() }
  else if(recordBusy)cancelRecording();
};


$("analyzeBtn").onclick=async()=>{
  if(studioBusy())return;
  const epoch=sourceEpoch;
  analysisBusy=true;stopTuner();syncControls();
  try{
    invalidateArrangement();report("Analyzing tempo and chords…");
    const decoded=await decodeCurrent(),analysis=await analyzeAudioBuffer(decoded);
    if(epoch!==sourceEpoch)return;
    project.analysis=analysis;syncControls();
    if(analysis.status!=="ready"){
      $("arrangement").textContent="No reliable musical analysis. Choose another take or enter a reviewed chord timeline.";
      report(analysis.status==="silent"?"This take is silent or too quiet to analyze. No backing band was generated.":"Musical analysis has low confidence. Review or enter chords before generating a band.");return;
    }
    $("arrangement").textContent="Analysis complete. Generate an arrangement.";
    report("Analysis complete. Review the estimated tempo and chords; set the first beat if the take starts with silence or a count-in.");
  }catch(e){report(mediaError(e))}
  finally{analysisBusy=false;syncControls()}
};


$("applyChordsBtn").onclick=()=>{
  if(studioBusy())return;
  try{
    const timeline=validateChords(JSON.parse($("chordEditor").value),decodedBuffer?.duration??Infinity);
    if(!timeline.length)throw new Error("Enter at least one reviewed chord region.");
    project.analysis={...project.analysis,status:"ready",chordTimeline:timeline};$("chordStatus").textContent=`Applied ${timeline.length} chord regions.`;invalidateArrangement();syncControls();
  }catch(e){$("chordStatus").textContent=e.message}
};

$("addRegionBtn").onclick=()=>{
  if(studioBusy())return;
  const start=Number($("regionStart").value),end=Number($("regionEnd").value);
  if(!decodedBuffer||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>decodedBuffer.duration){report("Choose a start and end within the take, with the end after the start.");return}
  project=addMuteRegion(project,start,end,$("regionLabel").value||"No accompaniment");
  renderRegions();invalidateArrangement();
};

const canvas=$("waveformCanvas");
canvas.addEventListener("pointerdown",e=>{
  if(studioBusy()||!waveformPeaks||!waveformDuration)return;
  const rect=canvas.getBoundingClientRect();dragStartX=e.clientX-rect.left;canvas.setPointerCapture?.(e.pointerId);
  $("waveformStatus").textContent="Drag to the end of the section to block.";
});
canvas.addEventListener("pointerup",e=>{
  if(studioBusy()){dragStartX=null;return}
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
  if(studioBusy())return;
  const epoch=sourceEpoch;
  analysisBusy=true;stopTuner();syncControls();
  try{
    const decoded=await decodeCurrent();if(epoch!==sourceEpoch)return;
    if(["silent","low-confidence"].includes(project.analysis?.status))throw new Error("Review the musical analysis or enter chords before generating a band.");
    const a=project.analysis,bpm=Number($("tempoBpm").value),offsetSec=Number($("beatOffset").value),seed=Number($("seed").value);
    if(!Number.isFinite(bpm)||bpm<40||bpm>220||!Number.isFinite(offsetSec)||offsetSec<0||offsetSec>=decoded.duration||!Number.isInteger(seed)||seed<1)throw new Error("Use a tempo from 40 to 220 BPM, a first beat within the take, and a positive whole-number seed.");
    project.timing={bpm,offsetSec};project.seed=seed;
    project.arrangement=buildArrangement({bpm,offsetSec,durationSec:decoded.duration,key:a?.keyEstimate?.key||"C major",seed,chordTimeline:a?.chordTimeline||[],muteRegions:project.regions||[]});
    project.stems={drums:{events:project.arrangement.drums.length},bass:{events:project.arrangement.bass.length},lead:{events:project.arrangement.lead.length}};
    invalidateRender();syncControls();report("Band ready. Adjust track levels, then render and listen.");
  }catch(e){report(e.message)}
  finally{analysisBusy=false;syncControls()}
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
  if(studioBusy()||!allAudioPresent()||!project.arrangement)return;
  if(stems)clearStemDownloads();else invalidateRender();
  const token=revision,snapshot=structuredClone(project),external={...neuralStemBuffers};
  const takes=Object.fromEntries(Object.entries(trackBuffers).map(([id,buffer])=>[id,effectiveVocalBuffer(id,buffer)]));
  const enhancedTargets=VOCAL_TARGETS.filter(id=>currentVocalResult(id)?.active);
  const liftNote=enhancedTargets.length?" VocalLift applied: "+enhancedTargets.map(vocalName).join(", ")+".":"";
  renderBusy=true;stopTuner();stopPlayback();syncControls();$("renderStatus").textContent=stems?"Preparing individual WAV stems…":"Rendering studio mix…";
  try{
    const original=await decodeCurrent(),decoded=effectiveVocalBuffer("source",original);
    if(stems){
      const results=[];
      for(const stem of ["original","drums","bass","lead",...EXTRA_TRACKS.filter(id=>takes[id])]){
        const buffer=await renderProjectStem(decoded,snapshot,stem,external,takes);
        if(token!==revision)return;
        results.push({stem,blob:new Blob([audioBufferToWav(buffer)],{type:"audio/wav"})});
      }
      for(const {stem,blob} of results){
        const a=document.createElement("a"),url=URL.createObjectURL(blob);stemDownloadUrls.push(url);
        const lifted=enhancedTargets.includes(stem==="original"?"source":stem);
        a.href=url;a.download=baseName()+"-"+stem+(lifted?"-vocallift":"")+".wav";a.textContent="Download "+(TRACK_NAMES[stem]||stem)+(lifted?" · VocalLift":"")+" WAV";$("stemDownloads").append(a);
      }
      $("renderStatus").textContent="Stem renders complete. Download each WAV below. Stems are aligned, pre-fader and without master effects."+liftNote;
    }else{
      const buffer=await renderProjectMix(decoded,snapshot,external,takes);
      if(token!==revision)return;
      const meter=measureAudioBuffer(buffer),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
      const tp=estimateTruePeak(channels),loud=estimateIntegratedLoudness(channels,buffer.sampleRate);
      renderedBuffer=buffer;mixUrl=URL.createObjectURL(new Blob([audioBufferToWav(buffer)],{type:"audio/wav"}));$("mixPlayer").src=mixUrl;$("downloadBtn").disabled=false;
      $("renderStatus").textContent="Rendered "+buffer.duration.toFixed(1)+"s stereo WAV · peak "+meter.peakDb+" dBFS · true-peak est. "+tp.dbTP+" dBTP · loudness est. "+loud.lufs+" LUFS."+liftNote;
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
  if(studioBusy())return;
  try{
    const {endpoint,apiKey}=aceRuntime();$("aceStatus").textContent="Checking neural server…";
    const result=await checkAceStep({endpoint,apiKey});$("aceStatus").textContent=`Neural server reachable at ${result.endpoint}.`;
  }catch(e){$("aceStatus").textContent=`Neural server check failed: ${e.message}`}
};
$("aceAllBtn").onclick=()=>runNeural(["drums","bass","lead"]);
document.querySelectorAll("[data-neural-generate]").forEach(btn=>btn.onclick=()=>runNeural([btn.dataset.neuralGenerate]));
document.querySelectorAll("[data-neural-clear]").forEach(btn=>btn.onclick=()=>{if(studioBusy())return;clearNeuralStem(btn.dataset.neuralClear);syncControls();$("aceStatus").textContent=`${btn.dataset.neuralClear} reverted to local renderer.`});
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
  $(id+"Remove").onclick=()=>{if(studioBusy())return;clearTrack(id);delete project.tracks[id];invalidateRender();syncControls()};
}

$("vocalTarget").onchange=event=>{
  if(studioBusy()||!VOCAL_TARGETS.includes(event.target.value))return;
  $("vocalPreviewPlayer").pause();vocalTarget=event.target.value;vocalPreviewMode="original";vocalFeedback();syncVocalUi();
};
$("vocalChooseBtn").onclick=()=>{if(!studioBusy())$(vocalTarget==="source"?"audioFile":vocalTarget+"File").click()};
$("vocalRecordBtn").onclick=()=>{
  if(studioBusy()||(vocalTarget!=="source"&&!loadedArrayBuffer))return;
  vocalPreviewMode="original";$("recordTarget").value=vocalTarget;syncVocalUi();$("recordBtn").click();
};
$("vocalDemoBtn").onclick=async()=>{
  if(studioBusy()||project.source||loadedArrayBuffer)return;
  demoBusy=true;syncControls();
  try{
    audioCtx ||= new AudioContext();await audioCtx.resume();
    const vocal=makeDemoBuffer(audioCtx),guitar=audioCtx.createBuffer(1,vocal.length,vocal.sampleRate),data=guitar.getChannelData(0);
    const notes=[130.8128,164.8138,195.9977],beat=.6;
    for(let i=0;i<data.length;i++){
      const t=i/guitar.sampleRate,local=t%beat,attack=Math.min(1,local/.008),envelope=attack*Math.exp(-local*6);
      let sample=0;
      for(const frequency of notes)sample+=Math.sin(2*Math.PI*frequency*t)+.24*Math.sin(4*Math.PI*frequency*t);
      data[i]=sample*.052*envelope;
    }
    await importTake(new File([encodeVocalWav(guitar)],"Synthetic guitar demo.wav",{type:"audio/wav"}));
    if(!loadedArrayBuffer||currentAudioName!=="Synthetic guitar demo.wav")throw new Error("The demo guitar could not be loaded.");
    await importTake(new File([encodeVocalWav(vocal)],"Synthetic vocal demo.wav",{type:"audio/wav"}),"track6");
    if(!trackBuffers.track6)throw new Error("The demo vocal could not be loaded.");
    const duration=decodedBuffer.duration,chords=[{startSec:0,endSec:duration,chord:"C"}];
    project.analysis={status:"ready",durationSec:duration,tempoBpm:100,keyEstimate:{key:"C major"},chordTimeline:chords,method:"Known synthetic demonstration; not detected from a real performance"};
    project.timing={bpm:100,offsetSec:0};
    project.arrangement=buildArrangement({bpm:100,offsetSec:0,durationSec:duration,key:"C major",seed:1,chordTimeline:chords,muteRegions:[]});
    project.stems=Object.fromEntries(["drums","bass","lead"].map(stem=>[stem,{events:project.arrangement[stem].length}]));
    vocalTarget="track6";vocalPreviewMode="original";invalidateRender();
    report("Synthetic demo session ready: generated guitar and a synthetic vowel melody. No person was recorded. Enhance the vocal, use it in the mix, and render to hear the band.");
    vocalFeedback("Synthetic demo only. Try Enhance voice, compare the result, then Use enhanced in mix and Render Studio Mix.");
  }catch(error){vocalFeedback("Demo could not load: "+error.message,true)}
  finally{demoBusy=false;syncControls()}
};
document.querySelectorAll("[data-vocal-preset]").forEach(button=>button.onclick=()=>{
  if(studioBusy())return;
  const preset=VOCAL_PRESETS.find(item=>item.id===button.dataset.vocalPreset);
  if(!preset)return;
  clearVocalResult(vocalTarget);vocalSettings.set(vocalTarget,{preset:preset.id,settings:{...preset.settings}});
  vocalFeedback("Preset selected. Enhance again to hear it. The mix uses the original until you apply the new result.");syncControls();
});
document.querySelectorAll("[data-vocal-setting]").forEach(input=>input.oninput=()=>{
  if(studioBusy())return;
  const state=vocalState();state.settings[input.dataset.vocalSetting]=Math.max(0,Math.min(100,Number(input.value)||0));state.preset="custom";
  clearVocalResult(vocalTarget);vocalFeedback("Settings changed. Enhance again, then use the new result in the mix.");syncControls();
});
$("vocalEnhanceBtn").onclick=enhanceSelectedVocal;
$("vocalApplyBtn").onclick=()=>{
  const result=currentVocalResult();if(studioBusy()||!result)return;
  result.active=true;invalidateRender();syncControls();vocalFeedback("Enhanced "+vocalName(vocalTarget)+" will be used in the next studio mix and stem renders. The original recording and its download are preserved.");
};
$("vocalBypassBtn").onclick=()=>{
  const result=currentVocalResult();if(studioBusy()||!result)return;
  result.active=false;vocalPreviewMode="original";invalidateRender();syncControls();vocalFeedback("Original "+vocalName(vocalTarget)+" restored in the mix. Render again to refresh the mix; the enhanced take is still available to compare or download.");
};
$("vocalDownloadBtn").onclick=()=>{
  const result=currentVocalResult();if(studioBusy()||!result)return;
  const source=vocalTarget==="source"?project.source:project.tracks?.[vocalTarget]?.source;
  const name=(source?.name||vocalName(vocalTarget)).replace(/\.[^.]+$/,"").replace(/[^a-z0-9 _-]/gi,"").slice(0,80)||"vocal";
  downloadBlob(result.blob,name+"-vocallift.wav");vocalFeedback("Enhanced WAV download requested. Keep this file to reimport your sound in a future session.");
};
for(const [id,mode] of [["vocalOriginalBtn","original"],["vocalEnhancedBtn","enhanced"]])$(id).onclick=()=>{
  if(studioBusy()||!vocalOriginal(vocalTarget)||(mode==="enhanced"&&!currentVocalResult()))return;
  const player=$("vocalPreviewPlayer"),resume=!player.paused,time=Number.isFinite(player.currentTime)?player.currentTime:0;
  vocalPreviewMode=mode;updateVocalPreview({resume,time});
};
$("vocalPreviewPlayer").addEventListener("play",()=>{
  for(const player of document.querySelectorAll("audio"))if(player!==$("vocalPreviewPlayer"))player.pause();
});
$("vocalPreviewPlayer").addEventListener("error",()=>{
  if($("vocalPreviewPlayer").getAttribute("src"))vocalFeedback("This preview could not play in the browser. Try a WAV or MP3 take; your original is unchanged.",true);
});
document.addEventListener("visibilitychange",()=>{if(document.hidden)stopTuner()});
window.addEventListener("pagehide",()=>{cancelAudioLink();stopTuner();cancelRecording();neuralAbort?.abort()});
syncControls();
clearWaveform();
