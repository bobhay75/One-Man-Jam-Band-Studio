import { test, expect, wavFixture, uploadAudio, renderMix, downloadBytes, expectStereoWav } from './helpers.mjs';

test('pasted Drive link offers a safe download step and preserves the current take',async({page})=>{
  await uploadAudio(page);
  await page.getByRole("button",{name:"Get audio from Google Drive",exact:true}).click();
  await expect(page.locator("#audioLink")).toBeFocused();
  await expect(page.locator("#driveReturnHelp")).toBeVisible();
  await expect(page.locator("#driveReturnHelp")).toContainText("Downloads");
  // Simulate the resulting input of a native paste without depending on OS clipboard permission.
  await page.locator('#audioLink').fill('https://drive.google.com/file/d/test_Audio-123456/view?resourcekey=0-test');
  await page.locator('#audioLink').press('Enter');
  await expect(page.locator('#audioLinkStatus')).toContainText('Drive link recognized');
  await expect(page.getByRole("link",{name:"Open Drive to download",exact:true})).toBeVisible();
  await expect(page.locator("#driveAudioLink")).toHaveAttribute("target","_blank");
  await expect(page.locator('#driveAudioLink')).toHaveAttribute('href','https://drive.google.com/file/d/test_Audio-123456/view?resourcekey=0-test');
  await expect(page.locator('#meta')).toContainText('acceptance-tone.wav');
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await page.locator('#audioLink').fill('https://drive.google.com/drive/folders/test_Audio-123456');
  await expect(page.locator('#driveAudioLink')).toBeHidden();
  await page.locator('#openAudioLink').click();
  await expect(page.locator('#audioLinkStatus')).toContainText('file link');
});

test('direct audio link enters playback, analyze, arrange, render and WAV export',async({page})=>{
  await page.route('https://audio.invalid/take.wav',route=>route.fulfill({status:200,contentType:'audio/wav',body:wavFixture()}));
  await page.locator('#audioLink').fill('https://audio.invalid/take.wav');
  await page.locator('#openAudioLink').click();
  await expect(page.locator('#meta')).toContainText('take.wav');
  await page.locator('#quickPlayBtn').click();
  await expect(page.locator('#quickPlayBtn')).toHaveText('Pause Take');
  await page.locator('#quickPlayBtn').click();
  await page.locator('#analyzeBtn').click();await page.locator('#arrangeBtn').click();await renderMix(page);
  const download=page.waitForEvent('download');await page.locator('#downloadBtn').click();
  expectStereoWav(await downloadBytes(await download));
});

for(const failure of ['html','network','oversize','invalid-audio'])test('failed '+failure+' link leaves the previous audio playable',async({page})=>{
  await uploadAudio(page);
  await page.route('https://audio.invalid/fail',route=>{
    if(failure==='network')return route.abort();
    if(failure==='oversize')return route.fulfill({status:200,headers:{'content-length':String(151*1024*1024)},body:'x'});
    return route.fulfill({status:200,contentType:failure==='html'?'text/html':'audio/wav',body:failure==='html'?'<html>Sign in</html>':'not audio'});
  });
  await page.locator('#audioLink').fill('https://audio.invalid/fail');
  await page.locator('#openAudioLink').click();
  await expect(page.locator('#audioLinkStatus')).toContainText(/previous take|current take/);
  await expect(page.locator('#meta')).toContainText('acceptance-tone.wav');
  await expect(page.locator('#quickPlayBtn')).toBeEnabled();
  await expect(page.locator('#openAudioLink')).toBeEnabled();
});

test('canceling a pending link releases the controls and cannot replace a later local take',async({page})=>{
  let release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('https://audio.invalid/slow.wav',async route=>{await gate;await route.fulfill({status:200,contentType:'audio/wav',body:wavFixture()}).catch(()=>{})});
  await page.locator('#audioLink').fill('https://audio.invalid/slow.wav');
  await page.locator('#openAudioLink').click();
  await expect(page.locator('#cancelAudioLink')).toBeEnabled();
  await page.locator('#cancelAudioLink').click();
  await expect(page.locator('#audioLinkStatus')).toContainText('canceled');
  await uploadAudio(page,'new-local.wav');
  release();
  await expect(page.locator('#meta')).toContainText('new-local.wav');
  await expect(page.locator('#cancelAudioLink')).toBeDisabled();
});

test.describe('stable tuner scheduling',()=>{
  test.use({expectedMicRequests:1});
  test('120 display frames produce at most ten analyses per second and noise never displays a note',async({page})=>{
    await page.evaluate(()=>{
      window.tunerFrames=new Map();window.frameId=0;window.analysisCount=0;window.tunerTone=false;
      window.requestAnimationFrame=fn=>{const id=++window.frameId;window.tunerFrames.set(id,fn);return id};
      window.cancelAnimationFrame=id=>window.tunerFrames.delete(id);
      AnalyserNode.prototype.getFloatTimeDomainData=function(buffer){
        window.analysisCount++;let seed=17;
        for(let i=0;i<buffer.length;i++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          buffer[i]=window.tunerTone ? .2*Math.sin(2*Math.PI*110*i/this.context.sampleRate):(seed/2**32*2-1)*.04;
        }
      };
      navigator.mediaDevices.getUserMedia=async()=>{
        window.__acceptanceMicRequests++;
        const ctx=new AudioContext();window.tunerContext=ctx;
        const out=ctx.createMediaStreamDestination();window.tunerStream=out.stream;return out.stream;
      };
    });
    await page.locator('#startTuner').click();await expect(page.locator('#stopTuner')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>window.tunerFrames.size)).toBe(1);
    const step=async(start,end)=>page.evaluate(({start,end})=>{
      for(let i=start;i<end;i++){
        const callbacks=[...window.tunerFrames.values()];window.tunerFrames.clear();
        for(const callback of callbacks)callback(i*1000/120);
      }
    },{start,end});
    await step(0,120);
    expect(await page.evaluate(()=>window.analysisCount)).toBeLessThanOrEqual(10);
    expect(await page.evaluate(()=>window.analysisCount)).toBeGreaterThanOrEqual(9);
    await expect(page.locator('#note')).toHaveText('--');
    await page.evaluate(()=>window.tunerTone=true);await step(120,240);
    await expect(page.locator('#note')).toHaveText('A2');
    await expect(page.locator('.tuner-card')).not.toHaveAttribute('aria-live','polite');
    await page.locator('#stopTuner').click();
    expect(await page.evaluate(()=>window.tunerFrames.size)).toBe(0);
    expect(await page.evaluate(()=>window.tunerStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
    await expect(page.locator('#note')).toHaveText('--');
    await page.evaluate(()=>window.tunerContext.close());
  });
  test('Stop during pending microphone permission releases the stream when it arrives',async({page})=>{
    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia=()=>{
        window.__acceptanceMicRequests++;
        return new Promise(resolve=>window.resolveTunerMic=()=>{
          const ctx=new AudioContext();window.tunerContext=ctx;
          const out=ctx.createMediaStreamDestination();window.tunerStream=out.stream;resolve(out.stream);
        });
      };
    });
    await page.locator('#startTuner').click();
    await expect.poll(()=>page.evaluate(()=>typeof window.resolveTunerMic)).toBe('function');
    await page.locator('#stopTuner').click();await page.evaluate(()=>window.resolveTunerMic());
    await expect(page.locator('#startTuner')).toBeEnabled();
    expect(await page.evaluate(()=>window.tunerStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
    await expect(page.locator('#note')).toHaveText('--');
    await page.evaluate(()=>window.tunerContext.close());
  });
});

test('a local file supersedes a downloaded link still waiting for audio decoding',async({page})=>{
  await page.route('https://audio.invalid/old.wav',route=>route.fulfill({status:200,contentType:'audio/wav',body:wavFixture()}));
  await page.evaluate(()=>{
    const decode=AudioContext.prototype.decodeAudioData;let first=true;
    AudioContext.prototype.decodeAudioData=function(bytes){
      if(!first)return decode.call(this,bytes);
      first=false;
      return new Promise((resolve,reject)=>{window.finishLinkDecode=()=>decode.call(this,bytes).then(resolve,reject)});
    };
  });
  await page.locator('#audioLink').fill('https://audio.invalid/old.wav');
  await page.locator('#openAudioLink').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.finishLinkDecode)).toBe('function');
  await expect(page.locator('#cancelAudioLink')).toBeEnabled();
  await uploadAudio(page,'newest.wav');
  await page.evaluate(()=>window.finishLinkDecode());
  await expect(page.locator('#meta')).toContainText('newest.wav');
  await expect(page.locator('#audioLinkStatus')).toContainText('replaced by a newer take');
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await expect(page.locator('#cancelAudioLink')).toBeDisabled();
});
