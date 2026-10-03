function midiHz(m){return 440*Math.pow(2,(m-69)/12)}
function env(g,t,d,peak=.5){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+.005);g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.03,d))}
function tone(ctx,dest,{time,duration,midi,velocity=.5,type="sine"}){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=midiHz(midi);env(g,time,duration,velocity);o.connect(g).connect(dest);o.start(time);o.stop(time+duration+.05);
}
function drum(ctx,dest,e){
  const g=ctx.createGain(),o=ctx.createOscillator();o.connect(g).connect(dest);
  if(e.kind==="kick"){o.type="sine";o.frequency.setValueAtTime(120,e.time);o.frequency.exponentialRampToValueAtTime(48,e.time+.09);env(g,e.time,.12,.8*e.velocity)}
  else if(e.kind==="snare"){o.type="square";o.frequency.value=180;env(g,e.time,.08,.16*e.velocity)}
  else{o.type="square";o.frequency.value=6000;env(g,e.time,.025,.06*e.velocity)}
  o.start(e.time);o.stop(e.time+.15);
}
function gainNode(ctx,value){const g=ctx.createGain();g.gain.value=value;return g}
export async function renderProjectMix(sourceBuffer,project){
  const arr=project.arrangement;
  if(!arr) throw new Error("Generate an arrangement first");
  const sr=sourceBuffer.sampleRate,frames=Math.ceil(Math.max(sourceBuffer.duration,arr.durationSec)*sr);
  const ctx=new OfflineAudioContext(2,frames,sr);
  const master=gainNode(ctx,project.mix.masterGain??.9);master.connect(ctx.destination);

  const sourceGain=gainNode(ctx,project.mix.sourceGain??1);sourceGain.connect(master);
  const src=ctx.createBufferSource();src.buffer=sourceBuffer;src.connect(sourceGain);src.start(0);

  const dg=gainNode(ctx,project.mix.drumsGain??.65),bg=gainNode(ctx,project.mix.bassGain??.6),lg=gainNode(ctx,project.mix.leadGain??.45);
  dg.connect(master);bg.connect(master);lg.connect(master);
  for(const e of arr.drums)drum(ctx,dg,e);
  for(const e of arr.bass)tone(ctx,bg,{...e,type:"triangle"});
  for(const e of arr.lead)tone(ctx,lg,{...e,type:"sine"});
  const rendered=await ctx.startRendering();

  // Conservative post-render peak trim; preserves relative stem balance.
  let peak=0;
  for(let c=0;c<rendered.numberOfChannels;c++)for(const x of rendered.getChannelData(c))peak=Math.max(peak,Math.abs(x));
  if(peak>0.98){
    const scale=.98/peak;
    for(let c=0;c<rendered.numberOfChannels;c++){const ch=rendered.getChannelData(c);for(let i=0;i<ch.length;i++)ch[i]*=scale}
  }
  return rendered;
}
