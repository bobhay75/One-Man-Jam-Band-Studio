import {
  test, expect, uploadAudio, prepareArrangement, renderMix, saveProject,
  loadProject, setRange, downloadBytes, expectStereoWav, FAKE_KEY, NEURAL_ENDPOINT,
} from './helpers.mjs';

test('boots with safe disabled states and keyboard-wired controls', async ({ page }) => {
  await expect(page).toHaveTitle('One-Man Jam Band Studio');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(9);
  for (const id of ['stopTuner', 'stopRecordBtn', 'analyzeBtn', 'arrangeBtn',
    'renderBtn', 'downloadBtn', 'exportStemsBtn', 'aceAllBtn', 'aceCancelBtn']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  for (const id of ['startTuner', 'recordBtn', 'saveProjectBtn', 'aceCheckBtn']) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }
  await expect(page.locator('[data-neural-state]')).toHaveText(['local', 'local', 'local']);
  await page.locator('[data-mix="sourceGain"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-mix="sourceGain"]')).toHaveValue('0.99');
  await expect(page.locator('[data-mix="sourceGain"] + output')).toHaveText('0.99');
  await page.getByText('Edit detected chord timeline', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#chordEditor')).toBeVisible();
  await expect(page.locator('#applyChordsBtn')).toBeDisabled();
  await expect(page.locator('#waveformStatus')).toHaveText('Load audio to draw the waveform.');
});

test('visible Choose Audio File control directly targets the native audio picker', async ({ page }) => {
  const picker = page.locator('#audioFile');
  const action = page.locator('#quickImportBtn');
  await expect(action.locator('label')).toHaveAttribute('for', 'audioFile');
  await expect(picker).toHaveAttribute('type', 'file');
  await expect(picker).toHaveAttribute('accept', /audio\/\*.*\.m4a/);
  await expect(action).toBeVisible();
});

test('local upload, analyze, arrange, render and five WAV downloads use browser audio', async ({ page }) => {
  // Merely entering neural settings must not opt in or contact the endpoint.
  await page.locator('#aceEndpoint').fill(NEURAL_ENDPOINT);
  await page.locator('#aceApiKey').fill(FAKE_KEY);
  await uploadAudio(page);
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await expect(page.locator('#arrangeBtn')).toBeDisabled();
  await expect(page.locator('#renderBtn')).toBeDisabled();
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#arrangeBtn')).toBeEnabled();
  const analysis = JSON.parse(await page.locator('#analysis').textContent());
  expect(analysis.durationSec).toBe(2);
  expect(analysis.chordTimeline.length).toBeGreaterThan(0);
  expect(analysis.speechReview.status).toBe('human-review-required');
  await page.locator('#arrangeBtn').click();
  await expect(page.locator('#exportStemsBtn')).toBeEnabled();
  const summary = JSON.parse(await page.locator('#arrangement').textContent());
  for (const stem of ['drums', 'bass', 'lead']) expect(summary.events[stem].events).toBeGreaterThan(0);
  await renderMix(page);
  await expect(page.locator('#mixPlayer')).toHaveAttribute('src', /^blob:/);
  const pending = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const mix = await pending;
  expect(mix.suggestedFilename()).toBe('acceptance-tone-mix.wav');
  expectStereoWav(await downloadBytes(mix));

  const stems = [];
  await page.locator('#exportStemsBtn').click();
  await expect(page.locator('#renderStatus')).toContainText('Stem renders complete.');
  await expect(page.locator('#stemDownloads a')).toHaveCount(4);
  for(const link of await page.locator('#stemDownloads a').all()){
    const pending=page.waitForEvent('download');await link.click();stems.push(await pending);
  }
  expect(stems.map(d => d.suggestedFilename()).sort()).toEqual(
    ['bass', 'drums', 'lead', 'original'].map(s => `acceptance-tone-${s}.wav`));
  for (const download of stems) expectStereoWav(await downloadBytes(download));
  await expect(page.locator('[data-neural-state]')).toHaveText(['local', 'local', 'local']);
});

test('portable project round-trips edits/settings and gates rendering until source is restored', async ({ page }) => {
  await prepareArrangement(page);
  await page.getByText('Edit detected chord timeline', { exact: true }).click();
  const chords = [{ startSec: 0, endSec: 2, chord: 'Am', root: 9, mode: 'minor', confidence: 1 }];
  await page.locator('#chordEditor').fill(JSON.stringify(chords));
  await page.locator('#applyChordsBtn').click();
  await page.locator('#regionStart').fill('0.5');
  await page.locator('#regionEnd').fill('0.8');
  await page.locator('#regionLabel').fill('Count-in correction');
  await page.locator('#addRegionBtn').click();
  await page.locator('#drumStyle').selectOption('brush');
  await page.locator('#bassStyle').selectOption('woody');
  await page.locator('#leadStyle').selectOption('ambient');
  await setRange(page, '#timingMs', 14);
  await setRange(page, '#swingAmount', 0.21);
  const mix = { sourceGain: 0.8, drumsGain: 0.5, bassGain: 0.4, leadGain: 0.3, masterGain: 0.7 };
  for (const [key, value] of Object.entries(mix)) await setRange(page, `[data-mix="${key}"]`, value);
  await page.locator('#masterPreset').selectOption('warm');
  await setRange(page, '#roomAmount', 0.2);
  await page.locator('#aceEndpoint').fill(NEURAL_ENDPOINT);
  await page.locator('#aceApiKey').fill(FAKE_KEY);
  await page.locator('#arrangeBtn').click();
  await expect(page.locator('#renderBtn')).toBeEnabled();
  const saved = await saveProject(page);
  expect(saved.download.suggestedFilename()).toBe('acceptance-tone.omjbs.json');
  expect(saved.project.source).toMatchObject({ name: 'acceptance-tone.wav', type: 'audio/wav',
    size: 64044, originalPreserved: true, localAudioRequired: true });
  expect(saved.project.analysis.chordTimeline).toEqual(chords);
  expect(saved.project.mix).toEqual(mix);
  expect(saved.project.regions).toEqual([{ startSec: 0.5, endSec: 0.8, label: 'Count-in correction', kind: 'mute' }]);
  expect(saved.json).not.toContain(FAKE_KEY);
  expect(saved.json).not.toContain(NEURAL_ENDPOINT);
  expect(saved.project).not.toHaveProperty('runtime');
  expect(saved.project).not.toHaveProperty('neuralRuntime');

  await page.reload();
  await loadProject(page, saved.json);
  await expect(page.locator('#aceApiKey')).toHaveValue('');
  for (const id of ['analyzeBtn', 'arrangeBtn', 'renderBtn', 'exportStemsBtn', 'downloadBtn', 'aceAllBtn']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('#player')).not.toHaveAttribute('src', /.+/);
  await expect(page.locator('#drumStyle')).toHaveValue('brush');
  await expect(page.locator('#bassStyle')).toHaveValue('woody');
  await expect(page.locator('#leadStyle')).toHaveValue('ambient');
  await expect(page.locator('#timingMs')).toHaveValue('14');
  await expect(page.locator('#swingAmount')).toHaveValue('0.21');
  await expect(page.locator('#masterPreset')).toHaveValue('warm');
  await expect(page.locator('#roomAmount')).toHaveValue('0.2');
  for (const [key, value] of Object.entries(mix)) {
    await expect(page.locator(`[data-mix="${key}"]`)).toHaveValue(String(value));
    await expect(page.locator(`[data-mix="${key}"] + output`)).toHaveText(value.toFixed(2));
  }
  await uploadAudio(page);
  await expect(page.locator('#meta')).toContainText('project source restored');
  await expect(page.locator('#renderBtn')).toBeEnabled();
  await expect(page.locator('#exportStemsBtn')).toBeEnabled();
  const restored = await saveProject(page);
  expect(restored.project).toEqual(saved.project);
  await renderMix(page);

  await uploadAudio(page, 'different-source.wav');
  await expect(page.locator('#arrangeBtn')).toBeDisabled();
  await expect(page.locator('#renderBtn')).toBeDisabled();
  await expect(page.locator('#exportStemsBtn')).toBeDisabled();
  await expect(page.locator('#downloadBtn')).toBeDisabled();
});

test('invalid project is reported without replacing the current editable project', async ({ page }) => {
  await prepareArrangement(page);
  const before = (await saveProject(page)).project;
  await page.locator('#projectFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('#sessionStatus')).toContainText('Project version missing');
  expect((await saveProject(page)).project).toEqual(before);
  await expect(page.locator('#renderBtn')).toBeEnabled();
});

test('waveform drag and manual region removal invalidate arrangement and rendered exports', async ({ page }) => {
  await prepareArrangement(page);
  await renderMix(page);
  const canvas = page.locator('#waveformCanvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#regionList .region')).toHaveCount(1);
  const region = (await saveProject(page)).project.regions[0];
  expect(region.startSec).toBeCloseTo(0.4, 1);
  expect(region.endSec).toBeCloseTo(0.8, 1);
  expect(region.label).toBe('Waveform exclusion');
  for (const id of ['renderBtn', 'downloadBtn', 'exportStemsBtn']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.locator('#mixPlayer')).not.toHaveAttribute('src', /.+/);
  await page.locator('#arrangeBtn').click();
  await expect(page.locator('#renderBtn')).toBeEnabled();
  await page.locator('#regionList').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('#regionList')).toHaveText('No blocked regions.');
  await expect(page.locator('#renderBtn')).toBeDisabled();
  // A click alone must not create an accidental exclusion.
  await canvas.click();
  await expect(page.locator('#waveformStatus')).toHaveText('Selection too short; drag a wider section.');
  await expect(page.locator('#regionList')).toHaveText('No blocked regions.');
});

test('chord JSON errors preserve arrangement; valid edits require regeneration', async ({ page }) => {
  await prepareArrangement(page);
  await renderMix(page);
  await page.getByText('Edit detected chord timeline', { exact: true }).click();
  const previous = (await saveProject(page)).project.analysis.chordTimeline;
  for (const invalid of ['{', '{}']) {
    await page.locator('#chordEditor').fill(invalid);
    await page.locator('#applyChordsBtn').click();
    await expect(page.locator('#chordStatus')).not.toBeEmpty();
    if (invalid === '{}') await expect(page.locator('#chordStatus')).toHaveText('Chord timeline must be a JSON array.');
    expect((await saveProject(page)).project.analysis.chordTimeline).toEqual(previous);
    await expect(page.locator('#downloadBtn')).toBeEnabled();
  }
  const timeline = [{ startSec: 0, endSec: 2, chord: 'G', root: 7, mode: 'major' }];
  await page.locator('#chordEditor').fill(JSON.stringify(timeline));
  await page.locator('#applyChordsBtn').click();
  await expect(page.locator('#chordStatus')).toHaveText('Applied 1 chord regions.');
  for (const id of ['renderBtn', 'downloadBtn', 'exportStemsBtn']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.locator('#arrangeBtn').click();
  await expect(page.locator('#renderBtn')).toBeEnabled();
  expect((await saveProject(page)).project.analysis.chordTimeline).toEqual(timeline);
});

test('mixer, mastering and production edits invalidate download and allow a fresh render', async ({ page }) => {
  await prepareArrangement(page);
  await renderMix(page);
  const changes = [
    () => setRange(page, '[data-mix="leadGain"]', 0.27),
    () => page.locator('#masterPreset').selectOption('open'),
    () => setRange(page, '#roomAmount', 0.18),
    () => page.locator('#drumStyle').selectOption('loose'),
    () => page.locator('#bassStyle').selectOption('picked'),
    () => page.locator('#leadStyle').selectOption('blues'),
    () => setRange(page, '#timingMs', 19),
    () => setRange(page, '#swingAmount', 0.3),
  ];
  for (const change of changes) {
    await change();
    await expect(page.locator('#downloadBtn')).toBeDisabled();
    await expect(page.locator('#mixPlayer')).not.toHaveAttribute('src', /.+/);
    await expect(page.locator('#renderBtn')).toBeEnabled();
    await expect(page.locator('#exportStemsBtn')).toBeEnabled();
    await renderMix(page);
  }
});

for (const action of ['re-analyze', 'reselect same filename']) {
  test(`${action} invalidates the old mix and allows a fresh download`, async ({ page }) => {
    await prepareArrangement(page);
    await renderMix(page);
    if (action === 're-analyze') {
      await page.locator('#analyzeBtn').click();
      await expect(page.locator('#arrangement')).toHaveText('Analysis complete. Generate an arrangement.');
    } else {
      await uploadAudio(page);
      await expect(page.locator('#arrangeBtn')).toBeDisabled();
    }
    await expect(page.locator('#downloadBtn')).toBeDisabled({ timeout: 1000 });
    await expect(page.locator('#mixPlayer')).not.toHaveAttribute('src', /.+/);
    await expect(page.locator('#renderStatus')).toBeEmpty();
    for (const id of ['renderBtn', 'exportStemsBtn']) await expect(page.locator(`#${id}`)).toBeDisabled();
    if (action === 'reselect same filename') await page.locator('#analyzeBtn').click();
    await page.locator('#arrangeBtn').click();
    await expect(page.locator('#downloadBtn')).toBeDisabled();
    await renderMix(page);
    await expect(page.locator('#mixPlayer')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#exportStemsBtn')).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('acceptance-tone-mix.wav');
    expectStereoWav(await downloadBytes(download));
  });
}
