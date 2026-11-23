import { readFile } from 'node:fs/promises';
import { test, expect, uploadAudio, prepareArrangement, renderMix, saveProject, wavFixture, downloadBytes } from './helpers.mjs';

test('VocalLift renders preserve original audio, route processed buffers and restore dry mixes',async({page})=>{
  const body=await readFile(new URL('./vocal-integration.html',import.meta.url),'utf8');
  await page.route('http://127.0.0.1:4173/vocal-engine-checks',route=>route.fulfill({contentType:'text/html',body}));
  await page.goto('/vocal-engine-checks');
  await page.locator('#run').click();
  await expect(page.locator('#summary')).toHaveAttribute('data-failed','0');
  await expect(page.locator('#summary')).toHaveAttribute('data-passed','14');
});

test('enhancement is explicitly applied, downloadable and reversible without changing the original',async({page})=>{
  await prepareArrangement(page);
  const original=wavFixture();
  await page.locator('#track6File').setInputFiles({name:'voice.wav',mimeType:'audio/wav',buffer:original});
  await expect(page.locator('#vocalTrackInfo')).toContainText('voice.wav');
  await renderMix(page);
  await page.locator('#vocalEnhanceBtn').click();
  await expect(page.locator('#vocalApplyBtn')).toBeEnabled();
  await expect(page.locator('#track6State')).toContainText('ready');
  await expect(page.locator('#vocalStatus')).toContainText('mix still uses the original');
  await page.locator('#vocalOriginalBtn').click();
  await expect(page.locator('#vocalOriginalBtn')).toHaveAttribute('aria-pressed','true');
  await page.locator('#vocalEnhancedBtn').click();
  await expect(page.locator('#vocalEnhancedBtn')).toHaveAttribute('aria-pressed','true');
  const pending=page.waitForEvent('download');await page.locator('#vocalDownloadBtn').click();
  const enhanced=await pending,bytes=await downloadBytes(enhanced);
  expect(enhanced.suggestedFilename()).toBe('voice-vocallift.wav');
  expect(bytes.toString('ascii',0,4)).toBe('RIFF');
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect((bytes.length-44)/2/bytes.readUInt32LE(24)).toBeCloseTo(2,2);
  await page.locator('#vocalApplyBtn').click();
  await expect(page.locator('#track6State')).toContainText('VocalLift in mix');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await renderMix(page);
  await expect(page.locator('#renderStatus')).toContainText('VocalLift applied: Vocal');
  await page.locator('#vocalBypassBtn').click();
  await expect(page.locator('#track6State')).toContainText('ready');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  const originalPending=page.waitForEvent('download');await page.locator('#track6Save').click();
  expect((await downloadBytes(await originalPending)).equals(original)).toBe(true);
  const saved=await saveProject(page);
  expect(saved.json).not.toContain('vocallift');
  expect(saved.json).not.toContain('blob:');
});

test('synthetic demo is labeled, enhances locally and cannot replace an existing session',async({page})=>{
  await page.locator('#vocalDemoBtn').click();
  await expect(page.locator('#track6State')).toContainText('Synthetic vocal demo.wav');
  await expect(page.locator('#vocalDemoBtn')).toBeDisabled();
  await expect(page.locator('#vocalTrackInfo')).toContainText('9.0s');
  await page.locator('#vocalEnhanceBtn').click();
  await expect(page.locator('#vocalApplyBtn')).toBeEnabled();
  await page.locator('#vocalApplyBtn').click();
  await renderMix(page);
  await expect(page.locator('#renderStatus')).toContainText('Rendered 9.0s stereo WAV');
});

test.describe('VocalLift recording destinations',()=>{
  test.use({expectedMicRequests:1});
  async function syntheticMicrophone(page){
    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        window.__acceptanceMicRequests++;
        const context=new AudioContext(),osc=context.createOscillator(),out=context.createMediaStreamDestination();
        osc.frequency.value=220;osc.connect(out);osc.start();await context.resume();
        window.recordingTestContext=context;window.recordingTestStream=out.stream;return out.stream;
      };
    });
  }
  for(const target of ['source','track6','track7'])test('Record follows the selected '+target+' destination',async({page})=>{
    if(target!=='source')await uploadAudio(page);
    await page.locator('#vocalTarget').selectOption(target);
    await expect(page.locator('#vocalRecordBtn')).toBeEnabled();
    await expect(page.locator('#vocalRecordBtn')).toHaveText(target==='source'?'Record original':target==='track6'?'Record Vocal':'Record Harmony');
    await syntheticMicrophone(page);
    await page.locator('#vocalRecordBtn').click();
    await expect(page.locator('#sessionStatus')).toContainText('Recording ');
    await page.waitForTimeout(650);
    await page.locator('#stopRecordBtn').click();
    await expect(page.locator('#sessionStatus')).toContainText('is ready');
    if(target==='source'){
      await expect(page.locator('#meta')).toContainText('source-recording-');
      await expect(page.locator('#track6State')).toHaveText('Empty');
    }else{
      await expect(page.locator('#meta')).toContainText('acceptance-tone.wav');
      await expect(page.locator('#'+target+'State')).toContainText(target+'-recording-');
      await expect(page.locator(target==='track6'?'#track7State':'#track6State')).toHaveText('Empty');
    }
    expect(await page.evaluate(()=>window.recordingTestStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
    await page.evaluate(()=>window.recordingTestContext.close());
  });
  test('Quick Record Guitar resets a previous Harmony recording destination',async({page})=>{
    await uploadAudio(page);await page.locator('#recordTarget').selectOption('track7');
    await syntheticMicrophone(page);await page.locator('#quickRecordBtn').click();
    await expect(page.locator('#sessionStatus')).toContainText('Recording Original');
    await page.waitForTimeout(650);await page.locator('#stopRecordBtn').click();
    await expect(page.locator('#meta')).toContainText('source-recording-');
    await expect(page.locator('#track7State')).toHaveText('Empty');
    expect(await page.evaluate(()=>window.recordingTestStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
    await page.evaluate(()=>window.recordingTestContext.close());
  });
});
