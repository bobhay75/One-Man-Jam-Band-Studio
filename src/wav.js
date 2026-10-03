export function encodeWavBuffer(channels,sampleRate){
  if(!channels?.length) throw new Error("No channels");
  const frames=channels[0].length;
  for(const c of channels) if(c.length!==frames) throw new Error("Channel length mismatch");
  const bytes=44+frames*channels.length*2;
  const ab=new ArrayBuffer(bytes),v=new DataView(ab);
  const s=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))};
  s(0,"RIFF");v.setUint32(4,bytes-8,true);s(8,"WAVE");s(12,"fmt ");
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels.length,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels.length*2,true);
  v.setUint16(32,channels.length*2,true);v.setUint16(34,16,true);s(36,"data");v.setUint32(40,bytes-44,true);
  let o=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels.length;c++){
    const x=Math.max(-1,Math.min(1,channels[c][i]));
    v.setInt16(o,x<0?x*0x8000:x*0x7fff,true);o+=2;
  }
  return ab;
}
export function audioBufferToWav(audioBuffer){
  return encodeWavBuffer(Array.from({length:audioBuffer.numberOfChannels},(_,i)=>audioBuffer.getChannelData(i)),audioBuffer.sampleRate);
}
