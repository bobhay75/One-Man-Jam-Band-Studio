function seeded(seed=1){
  let x=(seed>>>0)||1;
  return ()=>((x=Math.imul(1664525,x)+1013904223>>>0)/4294967296);
}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function humanizeEvents(events,{timingMs=10,velocityJitter=.05,swing=0,beatSec=.5,seed=1}={}){
  const rnd=seeded(seed),timing=Math.max(0,Number(timingMs)||0)/1000,vel=Math.max(0,Number(velocityJitter)||0);
  const swingAmount=clamp(Number(swing)||0,0,1);
  return (events||[]).map((e,i)=>{
    const beatPos=beatSec>0?((e.time/beatSec)%1+1)%1:0;
    const offbeat=beatPos>.42&&beatPos<.58;
    const swingDelay=offbeat?swingAmount*beatSec*.18:0;
    const jitter=(rnd()*2-1)*timing;
    const velocity=clamp((e.velocity??.5)+(rnd()*2-1)*vel,.03,1);
    return {...e,time:+Math.max(0,e.time+jitter+swingDelay).toFixed(5),velocity:+velocity.toFixed(4),humanized:true,index:i};
  });
}
