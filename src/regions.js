export function normalizeRegions(regions=[],durationSec=Infinity){
  return regions
    .map(r=>({startSec:Math.max(0,Number(r.startSec)||0),endSec:Math.max(0,Number(r.endSec)||0),kind:r.kind||"mute",label:r.label||""}))
    .filter(r=>r.endSec>r.startSec&&r.startSec<durationSec)
    .map(r=>({...r,endSec:Math.min(durationSec,r.endSec)}))
    .sort((a,b)=>a.startSec-b.startSec);
}
export function isBlocked(time,regions=[]){
  return regions.some(r=>time>=r.startSec&&time<r.endSec);
}
export function addMuteRegion(project,startSec,endSec,label="No accompaniment"){
  const next={startSec:Number(startSec),endSec:Number(endSec),kind:"mute",label};
  return {...project,regions:normalizeRegions([...(project.regions||[]),next],project.analysis?.durationSec??Infinity)};
}
export function removeRegion(project,index){
  return {...project,regions:(project.regions||[]).filter((_,i)=>i!==index)};
}
