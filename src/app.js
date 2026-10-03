import { autoCorrelate, frequencyToNote, noteName, centsOff } from "./tuner.js";
import { createProject, setSource } from "./project.js";
import { analyzeAudioBuffer } from "./analyze.js";

let project = createProject();
let audioCtx, analyser, micStream, raf;
let loadedArrayBuffer = null;
let mediaRecorder = null, chunks = [];

const $ = id => document.getElementById(id);

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
  tick();
  $("startTuner").disabled = true;
  $("stopTuner").disabled = false;
}

function stopTuner() {
  cancelAnimationFrame(raf);
  micStream?.getTracks().forEach(t => t.stop());
  $("startTuner").disabled = false;
  $("stopTuner").disabled = true;
}

$("startTuner").onclick = () => startTuner().catch(e => alert(e.message));
$("stopTuner").onclick = stopTuner;

$("audioFile").onchange = async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  loadedArrayBuffer = await file.arrayBuffer();
  $("player").src = URL.createObjectURL(file);
  project = setSource(project, { name: file.name, type: file.type, size: file.size });
  $("meta").textContent = `${file.name} · ${Math.round(file.size/1024)} KB · original preserved`;
  $("analyzeBtn").disabled = false;
};

$("recordBtn").onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  chunks = [];
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    loadedArrayBuffer = await blob.arrayBuffer();
    $("player").src = URL.createObjectURL(blob);
    project = setSource(project, { name: "recording", type: blob.type, size: blob.size });
    $("meta").textContent = `New recording · ${Math.round(blob.size/1024)} KB · original preserved`;
    $("analyzeBtn").disabled = false;
    stream.getTracks().forEach(t => t.stop());
  };
  mediaRecorder.start();
  $("recordBtn").disabled = true;
  $("stopRecordBtn").disabled = false;
};

$("stopRecordBtn").onclick = () => {
  mediaRecorder?.stop();
  $("recordBtn").disabled = false;
  $("stopRecordBtn").disabled = true;
};

$("analyzeBtn").onclick = async () => {
  if (!loadedArrayBuffer) return;
  audioCtx ||= new AudioContext();
  const decoded = await audioCtx.decodeAudioData(loadedArrayBuffer.slice(0));
  project.analysis = await analyzeAudioBuffer(decoded);
  $("analysis").textContent = JSON.stringify(project.analysis, null, 2);
};

document.querySelectorAll("[data-stem]").forEach(btn => {
  btn.onclick = () => {
    const stem = btn.dataset.stem;
    alert(`${stem} generation adapter is scaffolded but not connected yet.`);
  };
});
