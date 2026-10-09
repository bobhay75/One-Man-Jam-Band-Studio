import { test, expect, wavFixture, uploadAudio, prepareArrangement, renderMix, saveProject, loadProject, setRange, downloadBytes, expectStereoWav } from './helpers.mjs';

for(const action of ['pointer','keyboard','all-files'])test(`native ${action} chooser activates and decodes a selected file`,async({page,isMobile})=>{
  const input=page.locator(action==='all-files'?'#audioFileAll':'#audioFile');
  const pending=page.waitForEvent('filechooser');
  if(action==='keyboard'){await input.focus();await page.keyboard.press('Space')}
  else if(isMobile)await input.tap({position:{x:30,y:20}});
  else await input.click({position:{x:30,y:20}});
  const chooser=await pending;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({name:'phone-take.wav',mimeType:action==='all-files'?'application/octet-stream':'',buffer:wavFixture()});
  await expect(page.locator('#sessionStatus')).toContainText('phone-take.wav is ready');
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await expect(input).toHaveValue(''); // permits selecting the same file again
  await page.locator('#quickPlayBtn').click();
  await expect.poll(()=>page.locator('#player').evaluate(a=>a.currentTime)).toBeGreaterThan(0);
  await expect(page.locator('#quickPlayBtn')).toHaveText('Play Take',{timeout:5000}); // ended event
  await expect(page.locator('#sessionStatus')).toHaveAttribute('role','status');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('cancel, empty and corrupt files preserve the prior take and expose useful feedback',async({page})=>{
  await prepareArrangement(page);const before=(await saveProject(page)).project;
  await page.locator('#audioFile').dispatchEvent('cancel');
  await expect(page.locator('#sessionStatus')).toContainText('selection canceled');
  for(const [buffer,message] of [[Buffer.alloc(0),'file is empty'],[Buffer.from('not audio'),'Cannot decode']]){
    await page.locator('#audioFileAll').setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer});
    await expect(page.locator('#sessionStatus')).toContainText(message);
    await expect(page.locator('#analyzeBtn')).toBeEnabled();
    expect((await saveProject(page)).project).toEqual(before);
  }
  await uploadAudio(page);await expect(page.locator('#arrangeBtn')).toBeDisabled();
});

test('out-of-order file reads cannot overwrite the most recent selection',async({page})=>{
  await page.evaluate(()=>{
    const read=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=async function(){
      if(this.name==='slow.wav')await new Promise(resolve=>window.releaseFile=resolve);
      return read.call(this);
    };
  });
  await page.locator('#audioFile').setInputFiles({name:'slow.wav',mimeType:'audio/wav',buffer:wavFixture()});
  await uploadAudio(page,'latest.wav');
  await page.evaluate(()=>window.releaseFile());
  await expect(page.locator('#meta')).toContainText('latest.wav');
  expect((await saveProject(page)).project.source.name).toBe('latest.wav');
});

test('same-name different bytes cannot restore saved analysis or arrangement',async({page})=>{
  await prepareArrangement(page);const saved=await saveProject(page);
  await page.reload();await loadProject(page,saved.json);
  const changed=wavFixture();changed.writeInt16LE(1234,100);
  await page.locator('#audioFile').setInputFiles({name:'acceptance-tone.wav',mimeType:'audio/wav',buffer:changed});
  await expect(page.locator('#sessionStatus')).toContainText('is ready');
  await expect(page.locator('#renderBtn')).toBeDisabled();
  expect((await saveProject(page)).project.analysis).toBeNull();
});

test('all eight tracks mix, export, save and restore with paired mixer controls',async({page})=>{
  test.setTimeout(60_000);
  await prepareArrangement(page);
  for(let n=5;n<=8;n++){
    await page.locator(`#track${n}File`).setInputFiles({name:`part-${n}.wav`,mimeType:'audio/wav',buffer:wavFixture()});
    await expect(page.locator(`#track${n}State`)).toContainText(`part-${n}.wav · ready`);
    await expect(page.locator(`#track${n}Save`)).toHaveAttribute('download',`part-${n}.wav`);
    expect((await page.locator(`#track${n}Gain`).boundingBox()).width).toBeGreaterThan(100);
  }
  await setRange(page,'[data-track-gain="bassGain"]',.32);
  await expect(page.locator('[data-mix="bassGain"]')).toHaveValue('0.32');
  await setRange(page,'[data-mix="bassGain"]',.47);
  await expect(page.locator('[data-track-gain="bassGain"]')).toHaveValue('0.47');
  await setRange(page,'#track5Gain',.25);
  await page.locator('#track5Offset').fill('-0.25');
  await renderMix(page);
  const saved=await saveProject(page);
  expect(saved.project.tracks.track5).toMatchObject({gain:.25,offsetSec:-.25});
  expect(saved.json).not.toContain('blob:');
  await page.locator('#exportStemsBtn').click();
  await expect(page.locator('#stemDownloads a')).toHaveCount(8);
  for(const link of await page.locator('#stemDownloads a').all()){
    const pending=page.waitForEvent('download');await link.click();expectStereoWav(await downloadBytes(await pending));
  }
  await page.locator('#track5Offset').fill('0');
  await expect(page.locator('#stemDownloads a')).toHaveCount(0);
  await page.reload();await loadProject(page,saved.json);await uploadAudio(page);
  await expect(page.locator('#renderBtn')).toBeDisabled();
  for(let n=5;n<=8;n++){
    await page.locator(`#track${n}File`).setInputFiles({name:`part-${n}.wav`,mimeType:'audio/wav',buffer:wavFixture()});
    await expect(page.locator(`#track${n}State`)).toContainText('ready');
  }
  await expect(page.locator('#renderBtn')).toBeEnabled();
  await expect(page.locator('#track5Offset')).toHaveValue('-0.25');
  await expect(page.locator('#track5Gain')).toHaveValue('0.25');
  await page.locator('#track8Remove').click();
  await expect(page.locator('#track8State')).toHaveText('Empty');
  await renderMix(page);
  await uploadAudio(page,'replacement-original.wav');
  await expect(page.locator('#track5State')).toContainText('part-5.wav · ready');
});

test('legacy v0.5 project settings and exclusions survive attaching audio for reanalysis',async({page})=>{
  await prepareArrangement(page);
  await page.locator('#regionStart').fill('.2');await page.locator('#regionEnd').fill('.4');await page.locator('#addRegionBtn').click();
  const saved=await saveProject(page);delete saved.project.source.sha256;
  await page.reload();await loadProject(page,JSON.stringify(saved.project));await uploadAudio(page);
  await expect(page.locator('#meta')).toContainText('legacy source attached');
  await expect(page.locator('#arrangeBtn')).toBeDisabled();
  const attached=(await saveProject(page)).project;expect(attached.regions).toEqual(saved.project.regions);expect(attached.mix).toEqual(saved.project.mix);
  await page.locator('#analyzeBtn').click();await page.locator('#arrangeBtn').click();await renderMix(page);
});

test('editing during stem rendering exposes no partial or stale stem links',async({page})=>{
  await prepareArrangement(page);
  await page.evaluate(()=>{
    const start=OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering=async function(){const b=await start.call(this);await new Promise(resolve=>window.releaseStems=resolve);return b};
  });
  await page.locator('#exportStemsBtn').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseStems)).toBe('function');
  await setRange(page,'[data-mix="drumsGain"]',.1);await page.evaluate(()=>window.releaseStems());
  await expect(page.locator('#renderStatus')).toContainText('Session changed');await expect(page.locator('#stemDownloads a')).toHaveCount(0);
});

for(const change of ['mixer','source','seed','project'])test(`${change} during render never revives a stale download`,async({page})=>{
  await prepareArrangement(page);const saved=await saveProject(page);
  await page.evaluate(()=>{
    const start=OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering=async function(){
      const result=await start.call(this);
      await new Promise(resolve=>window.releaseRender=resolve);
      return result;
    };
  });
  await page.locator('#renderBtn').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseRender)).toBe('function');
  if(change==='mixer')await setRange(page,'[data-mix="sourceGain"]',.3);
  if(change==='source')await uploadAudio(page,'new-source.wav');
  if(change==='seed')await page.locator('#seed').fill('3');
  if(change==='project')await loadProject(page,saved.json);
  await page.evaluate(()=>window.releaseRender());
  await expect(page.locator('#renderStatus')).toContainText('Session changed');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#mixPlayer')).not.toHaveAttribute('src');
});

test('overlapping exclusions mute procedural tails and neural stems; extra takes actually contribute',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {renderProjectStem,renderProjectMix}=await import('/src/render.js');
    const {createProject}=await import('/src/project.js');
    const {buildArrangement}=await import('/src/arranger.js');
    const ctx=new AudioContext({sampleRate:16000}),source=ctx.createBuffer(1,32000,16000),external=ctx.createBuffer(1,32000,16000);
    external.getChannelData(0).fill(.2);
    const p=createProject();p.arrangement=buildArrangement({durationSec:2,bpm:120});
    p.regions=[{startSec:.4,endSec:1.6},{startSec:.7,endSec:1.0}];
    p.production={...p.production,leadStyle:'ambient',timingMs:20,swing:.2};
    const peaks=[];
    for(const stem of ['drums','bass','lead'])for(const neural of [false,true]){
      const b=await renderProjectStem(source,p,stem,neural?{[stem]:external}:{});
      peaks.push(Math.max(...b.getChannelData(0).slice(7200,24800).map(Math.abs)));
    }
    for(const key of ['sourceGain','drumsGain','bassGain','leadGain'])p.mix[key]=0;
    p.tracks={track5:{gain:1,offsetSec:.2}};
    const mix=await renderProjectMix(source,p,{}, {track5:external});
    const peak=Math.max(...mix.getChannelData(0).map(Math.abs));
    await ctx.close();return {peaks,peak,duration:mix.duration};
  });
  expect(result.peaks.every(p=>p<1e-7)).toBe(true);
  expect(result.peak).toBeGreaterThan(.001);
  expect(result.duration).toBeCloseTo(2.2,2);
});

test('invalid chord ranges, tempo and exclusions report errors without breaking the session',async({page})=>{
  await prepareArrangement(page);await renderMix(page);
  await page.getByText('Edit detected chord timeline',{exact:true}).click();
  await page.locator('#chordEditor').fill('[null]');await page.locator('#applyChordsBtn').click();
  await expect(page.locator('#chordStatus')).toContainText('ordered');
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  await page.locator('#regionStart').fill('3');await page.locator('#addRegionBtn').click();
  await expect(page.locator('#sessionStatus')).toContainText('within the take');
  await page.locator('#tempoBpm').fill('0');await page.locator('#arrangeBtn').click();
  await expect(page.locator('#sessionStatus')).toContainText('40 to 220');
  await expect(page.locator('#renderBtn')).toBeDisabled();
  await page.locator('#tempoBpm').fill('120');await page.locator('#beatOffset').fill('0.25');await page.locator('#arrangeBtn').click();
  const p=(await saveProject(page)).project;expect(p.arrangement.drums[0].time).toBe(.25);
  await renderMix(page);
});

test.describe('microphone paths',()=>{
  test.use({expectedMicRequests:1});
  test('permission denial is visible, recoverable, and does not destroy an imported take',async({page})=>{
    await uploadAudio(page);
    await page.evaluate(()=>navigator.mediaDevices.getUserMedia=async()=>{window.__acceptanceMicRequests++;throw new DOMException('Denied','NotAllowedError')});
    await page.locator('#quickRecordBtn').click();
    await expect(page.locator('#sessionStatus')).toContainText('permission was denied');
    await expect(page.locator('#recordBtn')).toBeEnabled();await expect(page.locator('#quickRecordBtn')).toBeEnabled();
    await expect(page.locator('#analyzeBtn')).toBeEnabled();await expect(page.locator('#stopRecordBtn')).toBeDisabled();
  });
  test('real MediaRecorder encodes a synthetic stream and releases it on Stop',async({page})=>{
    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        window.__acceptanceMicRequests++;
        const context=new AudioContext(),osc=context.createOscillator(),out=context.createMediaStreamDestination();
        osc.frequency.value=220;osc.connect(out);osc.start();context.resume();
        window.testStream=out.stream;window.testContext=context;return out.stream;
      };
    });
    await page.locator('#quickRecordBtn').click();await expect(page.locator('#stopRecordBtn')).toBeEnabled();
    await expect(page.locator('#quickRecordBtn')).toBeDisabled();
    await page.waitForTimeout(650); // acquire a nonempty real encoder packet
    await page.locator('#stopRecordBtn').click();
    await expect(page.locator('#sessionStatus')).toContainText('is ready');
    await expect(page.locator('#analyzeBtn')).toBeEnabled();
    expect(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
    const pending=page.waitForEvent('download');await page.locator('#saveOriginalBtn').click();
    expect((await downloadBytes(await pending)).length).toBeGreaterThan(100);
    await page.locator('#analyzeBtn').click();await page.locator('#arrangeBtn').click();await renderMix(page);
    await page.evaluate(()=>window.testContext.close());
  });
  test('tuner UI reports flat/sharp and clears stale readings when stopped',async({page})=>{
    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        window.__acceptanceMicRequests++;
        const ctx=new AudioContext(),osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination();
        osc.frequency.value=440*2**(-20/1200);osc.connect(out);osc.start();ctx.resume();
        window.testOsc=osc;window.testContext=ctx;return out.stream;
      };
    });
    await page.locator('#startTuner').click();
    await expect(page.locator('#tunerStatus')).toContainText('TOO FLAT');
    await page.evaluate(()=>window.testOsc.frequency.value=440*2**(20/1200));
    await expect(page.locator('#tunerStatus')).toContainText('TOO SHARP');
    await page.evaluate(()=>window.testOsc.frequency.value=440);
    await expect(page.locator('#tunerStatus')).toHaveText('IN TUNE');
    await page.locator('#stopTuner').click();await expect(page.locator('#note')).toHaveText('--');
    await expect(page.locator('#tunerStatus')).toHaveText('PLAY A NOTE');
    await page.evaluate(()=>window.testContext.close());
  });
});
