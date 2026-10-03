export function buildWaveformPeaks(samples,buckets=800){
  const count=Math.max(16,Math.min(4000,Math.floor(buckets)||800)),out=[];
  if(!samples?.length)return Array.from({length:count},()=>({min:0,max:0}));
  const step=samples.length/count;
  for(let b=0;b<count;b++){
    const start=Math.floor(b*step),end=Math.min(samples.length,Math.max(start+1,Math.floor((b+1)*step)));
    let min=1,max=-1;
    for(let i=start;i<end;i++){const x=samples[i];if(x<min)min=x;if(x>max)max=x}
    out.push({min:+min.toFixed(5),max:+max.toFixed(5)});
  }
  return out;
}
export function selectionToRegion(x1,x2,width,durationSec,label="No accompaniment"){
  const w=Math.max(1,Number(width)||1),d=Math.max(0,Number(durationSec)||0);
  const a=Math.max(0,Math.min(w,Math.min(x1,x2))),b=Math.max(0,Math.min(w,Math.max(x1,x2)));
  return {startSec:+(a/w*d).toFixed(2),endSec:+(b/w*d).toFixed(2),kind:"mute",label};
}
export function drawWaveform(canvas,peaks,durationSec,regions=[]){
  if(!canvas||!peaks)return;
  const ratio=window.devicePixelRatio||1,w=Math.max(1,canvas.clientWidth||800),h=Math.max(1,canvas.clientHeight||180);
  canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);
  const ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#0d0d0d";ctx.fillRect(0,0,w,h);
  for(const r of regions||[]){
    const x=(r.startSec/durationSec)*w,rw=((r.endSec-r.startSec)/durationSec)*w;
    ctx.fillStyle="rgba(255,120,80,.22)";ctx.fillRect(x,0,rw,h);
  }
  ctx.strokeStyle="#d8d8d8";ctx.lineWidth=1;ctx.beginPath();
  const mid=h/2,xstep=w/peaks.length;
  for(let i=0;i<peaks.length;i++){
    const x=i*xstep+.5,y1=mid-peaks[i].max*mid*.9,y2=mid-peaks[i].min*mid*.9;
    ctx.moveTo(x,y1);ctx.lineTo(x,y2);
  }
  ctx.stroke();
  ctx.strokeStyle="#555";ctx.beginPath();ctx.moveTo(0,mid+.5);ctx.lineTo(w,mid+.5);ctx.stroke();
}
