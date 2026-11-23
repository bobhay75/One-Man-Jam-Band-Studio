import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioLink, fetchAudioLink, MAX_AUDIO_BYTES } from '../src/audio-link.js';
test('Drive sharing formats resolve to an explicit download handoff, preserving resource keys',()=>{
  const id='test_Audio-123456';
  for(const url of ['https://drive.google.com/file/d/'+id+'/view?usp=sharing','https://drive.google.com/open?id='+id,'https://drive.google.com/uc?id='+id]){
    assert.deepEqual(parseAudioLink(url),{kind:'drive',url:'https://drive.google.com/file/d/'+id+'/view'});
  }
  assert.match(parseAudioLink('https://drive.google.com/file/d/'+id+'/view?resourcekey=0-abc').url,/resourcekey=0-abc$/);
  assert.throws(()=>parseAudioLink('https://drive.google.com/drive/folders/'+id),/file link/);
  for(const url of ['javascript:alert(1)','http://audio.invalid/a.wav','https://user:pass@audio.invalid/a.wav','bad link'])assert.throws(()=>parseAudioLink(url));
  assert.equal(parseAudioLink(' https://audio.invalid/take.wav ').kind,'audio');
});
test('direct download omits credentials and keeps the decoded filename',async()=>{
  let options;
  const file=await fetchAudioLink('https://audio.invalid/my%20take.wav',{fetchImpl:async(url,opts)=>{
    options=opts;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/wav'}});
  }});
  assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  assert.equal(file.name,'my take.wav');assert.equal(file.size,3);assert.equal(file.type,'audio/wav');
});
test('download rejects pages, HTTP failures, empty files and oversized headers',async()=>{
  for(const response of [
    new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}),
    new Response('denied',{status:403}),new Response(''),
    new Response('x',{headers:{'Content-Length':String(MAX_AUDIO_BYTES+1)}})
  ])await assert.rejects(fetchAudioLink('https://audio.invalid/file',{fetchImpl:async()=>response}));
});
test('stream size is enforced even without Content-Length and the stream is canceled',async()=>{
  let canceled=false;
  const chunk=new Uint8Array(1024*1024);
  const body=new ReadableStream({pull(controller){controller.enqueue(chunk)},cancel(){canceled=true}});
  await assert.rejects(fetchAudioLink('https://audio.invalid/file',{fetchImpl:async()=>new Response(body)}),/150 MB/);
  assert.equal(canceled,true);
});
test('canceled downloads cannot finish as an imported file',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(fetchAudioLink('https://audio.invalid/file',{signal:controller.signal,fetchImpl:async()=>new Response('audio')}),{name:'AbortError'});
});

test('early response rejection cancels the body instead of continuing to download',async()=>{
  for(const options of [{headers:{'Content-Type':'text/html'}},{headers:{'Content-Length':String(MAX_AUDIO_BYTES+1)}},{status:403}]){
    let canceled=false;
    const body=new ReadableStream({cancel(){canceled=true}});
    await assert.rejects(fetchAudioLink('https://audio.invalid/file',{fetchImpl:async()=>new Response(body,options)}));
    assert.equal(canceled,true);
  }
});
