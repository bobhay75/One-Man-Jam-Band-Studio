import { autoCorrelate, frequencyToNote, noteName, centsOff } from "./tuner.js";
import { createProject, setSource } from "./project.js";
import { analyzeAudioBuffer } from "./analyze.js";
import { buildArrangement } from "./arranger.js";
import { renderProjectMix } from "./render.js";
import { audioBufferToWav } from "./wav.js";

let project = createProject();
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null, decodedBuffer = null, renderedBuffer = null, mixUrl = null;
let mediaRecorder = null, chunks = [];

const $ = id => document.getElementById(id);

async function decodeCurrent(){
  if(decodedBuffer) return decodedBuffer;
  if(!loadedArrayBuffer) throw new Error("Load or record a track first.");
  audioCtx ||= new AudioContext();
  decodedBuffer=await audioCtx.decodeAudioData(loadedArrayBuffer.slice(0));
  return decodedBuffer;
}
function resetDerived(){
  decodedBuffer=null; renderedBuffer=null; project.analysis=null; project.arrangement=null;
  $("arrangeBtn").disabled=true;$("renderBtn").disabled=true;$("downloadBtn").disabled=true;
  $("arrangement").textContent="Analyze a track first.";
  $("renderStatus").textContent="";
  if(mixUrl){URL.revokeObjectURL(mixUrl);mixUrl=null}
  $("mixPlayer").removeAttribute("src");
}
async function startTuner() {
  audioCtx ||= new AudioContext();
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, audioCtx.sampleRate);
    if (freq > 0) {
      const n = frequencyToNote(freq);
      $("note").textContent = noteName(n);
      $("freq").textContent = freq.toFixed(1) + " Hz";
      $("cents").textContent = centsOff(freq, n) + " cents";
    }
    raf = requestAnimationFrame(tick);
  };
  tick(); $("startTuner").disabled = true; $("stopTuner").disabled = false;
}
function stopTuner() {
  cancelAnimationFrame(raf); micStream?.getTracks().forEach(t => t.stop());
  $("startTuner").disabled = false; $("stopTuner").disabled = true;
}
$("startTuner").onclick = () => startTuner().catch(e => alert(e.message));
$("stopTuner").onclick = stopTuner;

$("audioFile").onchange = async e => {
  const file = e.target.files?.[0]; if (!file) return;
  loadedArrayBuffer = await file.arrayBuffer(); resetDerived();
  $("player").src = URL.createObjectURL(file);
  project = setSource(project, { name: file.name, type: file.type, size: file.size });
  $("meta").textContent = `${file.name} · ${Math.round(file.size/1024)} KB · original preserved`;
  $("analyzeBtn").disabled = false;
};

$("recordBtn").onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream); chunks = [];
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    loadedArrayBuffer = await blob.arrayBuffer(); resetDerived();
    $("player").src = URL.createObjectURL(blob);
    project = setSource(project, { name: "recording", type: blob.type, size: blob.size });
    $("meta").textContent = `New recording · ${Math.round(blob.size/1024)} KB · original preserved`;
    $("analyzeBtn").disabled = false; stream.getTracks().forEach(t => t.stop());
  };
  mediaRecorder.start(); $("recordBtn").disabled = true; $("stopRecordBtn").disabled = false;
};
$("stopRecordBtn").onclick = () => { mediaRecorder?.stop(); $("recordBtn").disabled=false; $("stopRecordBtn").disabled=true; };

$("analyzeBtn").onclick = async () => {
  try{
    const decoded=await decodeCurrent();
    project.analysis=await analyzeAudioBuffer(decoded);
    $("analysis").textContent=JSON.stringify(project.analysis,null,2);
    $("arrangeBtn").disabled=false;
  }catch(e){alert(e.message)}
};

$("arrangeBtn").onclick = async () => {
  const decoded=await decodeCurrent(),a=project.analysis;
  const bpm=a?.tempoBpm||120,key=a?.keyEstimate?.key||"C major";
  project.arrangement=buildArrangement({bpm,durationSec:decoded.duration,key,seed:Number($("seed").value)||1});
  project.stems={drums:{events:project.arrangement.drums.length},bass:{events:project.arrangement.bass.length},lead:{events:project.arrangement.lead.length}};
  $("arrangement").textContent=JSON.stringify({bpm,key,bars:project.arrangement.bars,events:project.stems,review:a?.speechReview?.status||"unknown"},null,2);
  $("renderBtn").disabled=false; renderedBuffer=null; $("downloadBtn").disabled=true;
};

document.querySelectorAll("[data-mix]").forEach(input=>{
  const out=input.nextElementSibling;
  input.oninput=()=>{project.mix[input.dataset.mix]=Number(input.value);out.value=Number(input.value).toFixed(2);renderedBuffer=null;$("downloadBtn").disabled=true;};
});

$("renderBtn").onclick=async()=>{
  try{
    $("renderStatus").textContent="Rendering locally…";
    const decoded=await decodeCurrent();
    renderedBuffer=await renderProjectMix(decoded,project);
    const wav=audioBufferToWav(renderedBuffer),blob=new Blob([wav],{type:"audio/wav"});
    if(mixUrl)URL.revokeObjectURL(mixUrl); mixUrl=URL.createObjectURL(blob);
    $("mixPlayer").src=mixUrl;$("downloadBtn").disabled=false;
    $("renderStatus").textContent=`Rendered ${renderedBuffer.duration.toFixed(1)}s stereo WAV locally.`;
  }catch(e){$("renderStatus").textContent=e.message}
};

$("downloadBtn").onclick=()=>{
  if(!renderedBuffer)return;
  const wav=audioBufferToWav(renderedBuffer),url=URL.createObjectURL(new Blob([wav],{type:"audio/wav"}));
  const a=document.createElement("a");a.href=url;a.download=(project.source?.name||"jam").replace(/\.[^.]+$/,"")+"-mix.wav";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
