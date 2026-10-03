const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const hz=m=>440*Math.pow(2,(m-69)/12);
function seeded(seed=1){let x=(seed>>>0)||1;return ()=>((x=Math.imul(1664525,x)+1013904223>>>0)/4294967296)}
function gain(ctx,value=1){const g=ctx.createGain();g.gain.value=value;return g}
function noiseBuffer(ctx,seconds=.5,seed=7331){
  const length=Math.max(1,Math.floor(ctx.sampleRate*seconds)),b=ctx.createBuffer(1,length,ctx.sampleRate),ch=b.getChannelData(0),rnd=seeded(seed);
  for(let i=0;i<length;i++)ch[i]=rnd()*2-1;
  return b;
}
function curve(amount=12){
  const n=1024,c=new Float32Array(n),k=Math.max(0,amount);
  for(let i=0;i<n;i++){const x=i*2/n-1;c[i]=(1+k)*x/(1+k*Math.abs(x))}
  return c;
}
function pulse(ctx,dest,time,duration,peak,attack=.004){
  const g=gain(ctx,0);g.connect(dest);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(Math.max(.0001,peak),time+attack);g.gain.exponentialRampToValueAtTime(.0001,time+Math.max(attack+.01,duration));return g;
}
export const INSTRUMENT_PRESETS={
  drums:["studio","loose","brush"],
  bass:["round","picked","woody"],
  lead:["clean","blues","ambient"]
};
export function normalizeInstrumentOptions(options={}){
  const pick=(group,value,fallback)=>INSTRUMENT_PRESETS[group].includes(value)?value:fallback;
  return {
    drumStyle:pick("drums",options.drumStyle,"studio"),
    bassStyle:pick("bass",options.bassStyle,"round"),
    leadStyle:pick("lead",options.leadStyle,"clean")
  };
}
export function createInstrumentRack(ctx,options={}){
  const o=normalizeInstrumentOptions(options),noise=noiseBuffer(ctx,.6,99173);

  function kick(dest,e){
    const osc=ctx.createOscillator(),g=pulse(ctx,dest,e.time,.18,(o.drumStyle==="loose"?.82:1)*e.velocity,.003);
    osc.type="sine";osc.frequency.setValueAtTime(o.drumStyle==="loose"?105:135,e.time);osc.frequency.exponentialRampToValueAtTime(47,e.time+.12);osc.connect(g);osc.start(e.time);osc.stop(e.time+.2);
    if(o.drumStyle!=="brush"){
      const src=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),cg=pulse(ctx,dest,e.time,.025,.05*e.velocity,.001);
      src.buffer=noise;hp.type="highpass";hp.frequency.value=3500;src.connect(hp).connect(cg);src.start(e.time,0,.03);src.stop(e.time+.03);
    }
  }
  function snare(dest,e){
    const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),ng=pulse(ctx,dest,e.time,o.drumStyle==="brush"?.16:.12,(o.drumStyle==="brush"?.18:.34)*e.velocity,.002);
    src.buffer=noise;bp.type="bandpass";bp.frequency.value=o.drumStyle==="brush"?2600:1900;bp.Q.value=.7;src.connect(bp).connect(ng);src.start(e.time,0,.18);src.stop(e.time+.18);
    const osc=ctx.createOscillator(),tg=pulse(ctx,dest,e.time,.11,.14*e.velocity,.002);osc.type="triangle";osc.frequency.value=185;osc.connect(tg);osc.start(e.time);osc.stop(e.time+.13);
  }
  function hat(dest,e){
    const src=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),g=pulse(ctx,dest,e.time,o.drumStyle==="brush"?.055:.038,(o.drumStyle==="brush"?.06:.11)*e.velocity,.001);
    src.buffer=noise;hp.type="highpass";hp.frequency.value=o.drumStyle==="brush"?4300:6200;src.connect(hp).connect(g);src.start(e.time,0,.07);src.stop(e.time+.07);
  }
  function scheduleDrum(dest,e){
    if(e.kind==="kick")kick(dest,e);else if(e.kind==="snare")snare(dest,e);else hat(dest,e);
  }
  function scheduleBass(dest,e){
    const config=o.bassStyle==="picked"?{cut:1450,a:.003,r:.09,saw:.22}:o.bassStyle==="woody"?{cut:980,a:.008,r:.16,saw:.08}:{cut:720,a:.012,r:.2,saw:.03};
    const bus=gain(ctx,1),filter=ctx.createBiquadFilter(),g=gain(ctx,0);
    filter.type="lowpass";filter.frequency.value=config.cut;filter.Q.value=.8;bus.connect(filter).connect(g).connect(dest);
    const t=e.time,d=Math.max(.08,e.duration),peak=.42*e.velocity;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+config.a);g.gain.exponentialRampToValueAtTime(.0001,t+d+config.r);
    const fundamental=ctx.createOscillator();fundamental.type="triangle";fundamental.frequency.value=hz(e.midi);fundamental.connect(bus);fundamental.start(t);fundamental.stop(t+d+config.r+.02);
    if(config.saw>0){const edge=ctx.createOscillator(),eg=gain(ctx,config.saw);edge.type="sawtooth";edge.frequency.value=hz(e.midi);edge.detune.value=-3;edge.connect(eg).connect(bus);edge.start(t);edge.stop(t+d+config.r+.02)}
  }
  function scheduleLead(dest,e){
    const cfg=o.leadStyle==="blues"?{drive:18,cut:3200,vib:24,rate:5.2,release:.28,wave:"sawtooth"}:o.leadStyle==="ambient"?{drive:3,cut:5200,vib:16,rate:4.5,release:.65,wave:"triangle"}:{drive:5,cut:4300,vib:12,rate:5.6,release:.22,wave:"triangle"};
    const t=e.time,d=Math.max(.08,e.duration),bus=gain(ctx,1),filter=ctx.createBiquadFilter(),shaper=ctx.createWaveShaper(),g=gain(ctx,0);
    filter.type="lowpass";filter.frequency.value=cfg.cut;filter.Q.value=.5;shaper.curve=curve(cfg.drive);shaper.oversample="2x";
    bus.connect(filter).connect(shaper).connect(g).connect(dest);
    const peak=.34*e.velocity;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+.018);g.gain.setValueAtTime(peak*.78,t+Math.min(.09,d*.45));g.gain.exponentialRampToValueAtTime(.0001,t+d+cfg.release);
    const osc=ctx.createOscillator();osc.type=cfg.wave;const target=hz(e.midi),bend=Number(e.bendSemitones)||0;
    if(bend){osc.frequency.setValueAtTime(target*Math.pow(2,-Math.abs(bend)/12),t);osc.frequency.exponentialRampToValueAtTime(target,t+Math.min(.09,d*.35))}
    else osc.frequency.value=target;
    const lfo=ctx.createOscillator(),lfoGain=gain(ctx,0);lfo.frequency.value=cfg.rate;lfoGain.gain.setValueAtTime(0,t);lfoGain.gain.linearRampToValueAtTime(cfg.vib,t+Math.min(.12,d*.5));lfo.connect(lfoGain).connect(osc.detune);
    osc.connect(bus);lfo.start(t);osc.start(t);lfo.stop(t+d+cfg.release+.03);osc.stop(t+d+cfg.release+.03);
    if(o.leadStyle==="ambient"){
      const echo=ctx.createDelay(.8),fb=gain(ctx,.22),wet=gain(ctx,.18);echo.delayTime.value=.28;bus.connect(echo).connect(wet).connect(dest);echo.connect(fb).connect(echo);
    }
  }
  return {options:o,scheduleDrum,scheduleBass,scheduleLead};
}
