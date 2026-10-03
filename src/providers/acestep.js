const TRACK_MAP={drums:"drums",bass:"bass",lead:"guitar"};
const DEFAULT_CAPTIONS={
  drums:"supportive live studio drums that follow the source performance, natural dynamics, no vocals",
  bass:"supportive electric bass line locked to the source guitar, musical and restrained, no vocals",
  lead:"tasteful expressive lead guitar that answers the source guitar without covering it, melodic, no vocals"
};

export function normalizeEndpoint(input){
  const raw=String(input||"").trim().replace(/\/+$/,"");
  if(!raw)throw new Error("ACE-Step endpoint is required.");
  const u=new URL(raw);
  const local=["localhost","127.0.0.1","::1"].includes(u.hostname);
  if(u.protocol!=="https:"&&!(u.protocol==="http:"&&local)){
    throw new Error("Use HTTPS for remote ACE-Step servers. Plain HTTP is allowed only for localhost.");
  }
  return u.toString().replace(/\/$/,"");
}
export function neuralTrackName(stem){
  const track=TRACK_MAP[stem];
  if(!track)throw new Error("Unsupported neural stem.");
  return track;
}
export function defaultCaption(stem){return DEFAULT_CAPTIONS[stem]||""}
export function buildInstruction(stem){
  const track=neuralTrackName(stem).toUpperCase();
  return `Generate the ${track} track based on the audio context:`;
}
export function parseTaskEnvelope(json){
  if(!json||Number(json.code)!==200||json.error)throw new Error(json?.error||"ACE-Step request failed.");
  return json.data;
}
export function parseTaskResult(json){
  const data=parseTaskEnvelope(json);
  const item=Array.isArray(data)?data[0]:null;
  if(!item)throw new Error("ACE-Step returned no task result.");
  if(Number(item.status)===2)throw new Error(item.error||"ACE-Step generation failed.");
  if(Number(item.status)!==1)return {done:false,status:Number(item.status)||0};
  let results=item.result;
  if(typeof results==="string")results=JSON.parse(results);
  const first=Array.isArray(results)?results[0]:results;
  if(!first?.file)throw new Error("ACE-Step completed without an audio file.");
  return {done:true,file:first.file,meta:first.metas||null,seed:first.seed_value||null};
}
function headers(apiKey,json=false){
  const h={};if(apiKey)h.Authorization=`Bearer ${apiKey}`;if(json)h["Content-Type"]="application/json";return h;
}
export async function checkAceStep({endpoint,apiKey="",fetchImpl=fetch,signal}){
  const base=normalizeEndpoint(endpoint);
  const r=await fetchImpl(base+"/health",{headers:headers(apiKey),signal});
  if(!r.ok)throw new Error(`ACE-Step health check failed (${r.status}).`);
  const body=await r.json().catch(()=>({}));
  return {ok:true,endpoint:base,body};
}
export async function submitLego({endpoint,apiKey="",audioBlob,stem,caption,bpm,key,seed=1,fetchImpl=fetch,signal}){
  if(!(audioBlob instanceof Blob))throw new Error("Source audio blob is required.");
  const base=normalizeEndpoint(endpoint),track=neuralTrackName(stem),form=new FormData();
  form.set("task_type","lego");
  form.set("instruction",buildInstruction(stem));
  form.set("prompt",caption||defaultCaption(stem));
  form.set("model","acestep-v15-base");
  form.set("thinking","true");
  form.set("audio_format","wav");
  form.set("seed",String(Math.max(0,Math.trunc(Number(seed)||1))));
  if(Number.isFinite(Number(bpm)))form.set("bpm",String(Math.round(Number(bpm))));
  if(key)form.set("key_scale",String(key).replace(/\bmajor\b/i,"Major").replace(/\bminor\b/i,"Minor"));
  form.set("src_audio",audioBlob,"source-audio");
  const r=await fetchImpl(base+"/release_task",{method:"POST",headers:headers(apiKey),body:form,signal});
  if(!r.ok)throw new Error(`ACE-Step submission failed (${r.status}).`);
  const data=parseTaskEnvelope(await r.json());
  if(!data?.task_id)throw new Error("ACE-Step returned no task id.");
  return {taskId:data.task_id,endpoint:base,track};
}
export async function queryTask({endpoint,apiKey="",taskId,fetchImpl=fetch,signal}){
  const base=normalizeEndpoint(endpoint);
  const r=await fetchImpl(base+"/query_result",{
    method:"POST",headers:headers(apiKey,true),
    body:JSON.stringify({task_id_list:[taskId]}),signal
  });
  if(!r.ok)throw new Error(`ACE-Step status query failed (${r.status}).`);
  return parseTaskResult(await r.json());
}
export async function waitForTask({endpoint,apiKey="",taskId,fetchImpl=fetch,signal,onProgress,intervalMs=2000,maxPolls=300}){
  for(let i=0;i<maxPolls;i++){
    if(signal?.aborted)throw new DOMException("Aborted","AbortError");
    const result=await queryTask({endpoint,apiKey,taskId,fetchImpl,signal});
    onProgress?.({poll:i+1,...result});
    if(result.done)return result;
    await new Promise((resolve,reject)=>{
      const id=setTimeout(resolve,intervalMs);
      signal?.addEventListener("abort",()=>{clearTimeout(id);reject(new DOMException("Aborted","AbortError"))},{once:true});
    });
  }
  throw new Error("ACE-Step generation timed out.");
}
export async function fetchGeneratedAudio({endpoint,apiKey="",file,fetchImpl=fetch,signal}){
  const base=normalizeEndpoint(endpoint),url=new URL(file,base+"/").toString();
  if(!url.startsWith(base+"/"))throw new Error("ACE-Step returned an unexpected audio URL.");
  const r=await fetchImpl(url,{headers:headers(apiKey),signal});
  if(!r.ok)throw new Error(`ACE-Step audio download failed (${r.status}).`);
  return await r.arrayBuffer();
}
