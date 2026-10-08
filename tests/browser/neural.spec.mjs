import {
  test, expect, uploadAudio, prepareArrangement, renderMix, saveProject,
  wavFixture, FAKE_KEY, NEURAL_ENDPOINT,
} from './helpers.mjs';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

async function configureNeural(page) {
  await page.locator('#aceEndpoint').fill(NEURAL_ENDPOINT);
  await page.locator('#aceApiKey').fill(FAKE_KEY);
}

async function jsonResponse(route, data) {
  await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify(data) });
}

// Only the optional provider is mocked. Uploads, generated-audio decoding,
// arrangement, mixing, and project downloads use the real application.
async function mockSuccessfulProvider(page) {
  const requests = [];
  const submissions = [];
  await page.route(`${NEURAL_ENDPOINT}/**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    requests.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postData() });
    if (request.url() === `${NEURAL_ENDPOINT}/health`) {
      await jsonResponse(route, { status: 'ok' });
    } else if (request.url() === `${NEURAL_ENDPOINT}/release_task`) {
      const form = await new Response(request.postDataBuffer(), {
        headers: { 'content-type': request.headers()['content-type'] },
      }).formData();
      submissions.push({ form, source: Buffer.from(await form.get('src_audio').arrayBuffer()) });
      await jsonResponse(route, { code: 200, data: { task_id: `browser-task-${submissions.length}` } });
    } else if (request.url() === `${NEURAL_ENDPOINT}/query_result`) {
      const { task_id_list: [taskId] } = request.postDataJSON();
      await jsonResponse(route, { code: 200, data: [{ status: 1, result: [{ file: `generated/${taskId}.wav` }] }] });
    } else if (request.url().startsWith(`${NEURAL_ENDPOINT}/generated/`)) {
      await route.fulfill({ status: 200, contentType: 'audio/wav', headers: corsHeaders, body: wavFixture() });
    } else {
      await route.abort('blockedbyclient');
    }
  });
  return { requests, submissions };
}

function assertSubmission(submission, instruction) {
  const { form, source } = submission;
  expect(form.get('task_type')).toBe('lego');
  expect(form.get('model')).toBe('acestep-v15-base');
  expect(form.get('audio_format')).toBe('wav');
  expect(form.get('instruction')).toBe(`Generate the ${instruction} track based on the audio context:`);
  expect(source.equals(wavFixture())).toBe(true);
}

test('same-name source replacement clears completed neural audio and cancels audio still decoding',async({page})=>{
  await mockSuccessfulProvider(page);await configureNeural(page);await prepareArrangement(page);
  await page.locator('[data-neural-generate="drums"]').click();
  await expect(page.locator('[data-neural-state="drums"]')).toHaveText('neural');
  await uploadAudio(page);
  await expect(page.locator('[data-neural-state="drums"]')).toHaveText('local');
  await page.evaluate(()=>{
    const decode=AudioContext.prototype.decodeAudioData;let held=false;
    AudioContext.prototype.decodeAudioData=async function(...args){
      const decoded=await decode.apply(this,args);
      if(!held){held=true;await new Promise(resolve=>window.releaseNeuralDecode=resolve)}
      return decoded;
    };
  });
  await page.locator('[data-neural-generate="bass"]').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseNeuralDecode)).toBe('function');
  await uploadAudio(page,'replacement.wav');await page.evaluate(()=>window.releaseNeuralDecode());
  await expect(page.locator('#aceStatus')).toHaveText('Neural render canceled.');
  await expect(page.locator('[data-neural-state]')).toHaveText(['local','local','local']);
  await expect(page.locator('[data-neural-audio="bass"]')).not.toHaveAttribute('src');
});

test('local actions do not contact neural service; explicit health check sends no recording', async ({ page }) => {
  const { requests, submissions } = await mockSuccessfulProvider(page);
  await configureNeural(page);
  await prepareArrangement(page);
  await renderMix(page);
  expect(requests).toEqual([]);

  await page.locator('#aceCheckBtn').click();
  await expect(page.locator('#aceStatus')).toHaveText(`Neural server reachable at ${NEURAL_ENDPOINT}.`);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ url: `${NEURAL_ENDPOINT}/health`, method: 'GET', body: null });
  expect(requests[0].headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
  expect(submissions).toEqual([]);
  for (const stem of ['drums', 'bass', 'lead']) {
    await expect(page.locator(`[data-neural-state="${stem}"]`)).toHaveText('local');
  }
});

test('single-stem opt-in uploads the source and local fallback invalidates the mix', async ({ page }) => {
  const { requests, submissions } = await mockSuccessfulProvider(page);
  await configureNeural(page);
  await prepareArrangement(page);
  await renderMix(page);
  await page.locator('[data-neural-generate="drums"]').click();
  await expect(page.locator('#aceStatus')).toContainText('Neural render complete: drums.');
  expect(submissions).toHaveLength(1);
  assertSubmission(submissions[0], 'DRUMS');
  expect(requests.map(request => request.method)).toEqual(['POST', 'POST', 'GET']);
  expect(requests.every(request => request.headers.authorization === `Bearer ${FAKE_KEY}`)).toBe(true);
  await expect(page.locator('[data-neural-state="drums"]')).toHaveText('neural');
  await expect(page.locator('[data-neural-audio="drums"]')).toHaveAttribute('src', /^blob:/);
  for (const stem of ['bass', 'lead']) {
    await expect(page.locator(`[data-neural-state="${stem}"]`)).toHaveText('local');
  }
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await renderMix(page);
  await page.locator('[data-neural-audio="drums"]').evaluate(audio=>audio.play());
  await page.locator('[data-neural-clear="drums"]').click();
  expect(await page.locator('[data-neural-audio="drums"]').evaluate(audio=>audio.paused)).toBe(true);
  await expect(page.locator('#trackState2')).toHaveText('Local part ready');
  await expect(page.locator('[data-neural-state="drums"]')).toHaveText('local');
  await expect(page.locator('[data-neural-clear="drums"]')).toBeDisabled();
  await expect(page.locator('[data-neural-audio="drums"]')).not.toHaveAttribute('src');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#mixPlayer')).not.toHaveAttribute('src');
  await expect(page.locator('#renderBtn')).toBeEnabled();
});

test('whole-band opt-in generates sequential stems and project save excludes neural runtime data', async ({ page }) => {
  const { requests, submissions } = await mockSuccessfulProvider(page);
  await configureNeural(page);
  await prepareArrangement(page);
  await page.locator('#aceAllBtn').click();
  await expect(page.locator('#aceStatus')).toContainText('Neural render complete: drums, bass, lead.');
  expect(submissions).toHaveLength(3);
  ['DRUMS', 'BASS', 'GUITAR'].forEach((instruction, index) => assertSubmission(submissions[index], instruction));
  expect(requests.map(request => new URL(request.url).pathname)).toEqual([
    '/ace/release_task', '/ace/query_result', '/ace/generated/browser-task-1.wav',
    '/ace/release_task', '/ace/query_result', '/ace/generated/browser-task-2.wav',
    '/ace/release_task', '/ace/query_result', '/ace/generated/browser-task-3.wav',
  ]);
  for (const stem of ['drums', 'bass', 'lead']) {
    await expect(page.locator(`[data-neural-state="${stem}"]`)).toHaveText('neural');
  }
  const saved = await saveProject(page);
  expect(saved.project.source.localAudioRequired).toBe(true);
  expect(saved.project.arrangement).toBeTruthy();
  expect(saved.project).not.toHaveProperty('apiKey');
  expect(saved.project).not.toHaveProperty('runtime');
  expect(saved.project).not.toHaveProperty('neuralRuntime');
  expect(saved.json).not.toContain(FAKE_KEY);
  expect(saved.json).not.toContain(NEURAL_ENDPOINT);
  expect(saved.json).not.toContain('blob:');
  expect(saved.json).not.toContain(wavFixture().toString('base64'));
  await page.locator('#projectFile').setInputFiles({
    name: 'neural-session.omjbs.json', mimeType: 'application/json', buffer: Buffer.from(saved.json),
  });
  await expect(page.locator('#meta')).toContainText('Project loaded');
  for (const stem of ['drums', 'bass', 'lead']) {
    await expect(page.locator(`[data-neural-state="${stem}"]`)).toHaveText('local');
    await expect(page.locator(`[data-neural-audio="${stem}"]`)).not.toHaveAttribute('src');
    await expect(page.locator(`[data-neural-clear="${stem}"]`)).toBeDisabled();
  }
  expect(submissions).toHaveLength(3);
});

test('cancel interrupts a pending whole-band task and restores local controls without submitting the next stem', async ({ page }) => {
  let submissions = 0;
  let pendingQuery;
  const queryReceived = new Promise(resolve => { pendingQuery = resolve; });
  let releaseQuery;
  const queryRelease = new Promise(resolve => { releaseQuery = resolve; });
  await page.route(`${NEURAL_ENDPOINT}/**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
    } else if (request.url().endsWith('/release_task')) {
      submissions++;
      await jsonResponse(route, { code: 200, data: { task_id: 'pending-browser-task' } });
    } else if (request.url().endsWith('/query_result')) {
      pendingQuery();
      await queryRelease;
      // The request was aborted by the app; release the test route as well.
      await route.abort('aborted').catch(() => {});
    } else {
      await route.abort('blockedbyclient');
    }
  });
  await configureNeural(page);
  await uploadAudio(page);
  try {
    await page.locator('#aceAllBtn').click();
    await queryReceived;
    await expect(page.locator('#aceCancelBtn')).toBeEnabled();
    await expect(page.locator('#aceCheckBtn')).toBeDisabled();
    await expect(page.locator('#aceAllBtn')).toBeDisabled();
    for (const stem of ['drums', 'bass', 'lead']) {
      await expect(page.locator(`[data-neural-generate="${stem}"]`)).toBeDisabled();
    }
    await page.locator('#aceCancelBtn').click();
    await expect(page.locator('#aceStatus')).toHaveText('Neural render canceled.');
    await expect(page.locator('#aceCancelBtn')).toBeDisabled();
    await expect(page.locator('#aceCheckBtn')).toBeEnabled();
    await expect(page.locator('#aceAllBtn')).toBeEnabled();
    for (const stem of ['drums', 'bass', 'lead']) {
      await expect(page.locator(`[data-neural-generate="${stem}"]`)).toBeEnabled();
      await expect(page.locator(`[data-neural-state="${stem}"]`)).toHaveText('local');
    }
    expect(submissions).toBe(1);
  } finally {
    releaseQuery();
  }
});

test('remote HTTP and provider-returned off-server audio URLs are rejected before unsafe requests', async ({ page }) => {
  const unsafeRequests = [];
  for (const pattern of ['http://neural.invalid/**', 'https://untrusted.invalid/**']) {
    await page.route(pattern, async route => {
      unsafeRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
  }
  await configureNeural(page);
  await uploadAudio(page);
  await page.locator('#aceEndpoint').fill('http://neural.invalid/ace');
  await page.locator('#aceCheckBtn').click();
  await expect(page.locator('#aceStatus')).toContainText('Use HTTPS for remote ACE-Step servers.');
  await page.locator('[data-neural-generate="lead"]').click();
  await expect(page.locator('#aceStatus')).toContainText('Neural render stopped: Use HTTPS');
  expect(unsafeRequests).toEqual([]);

  await page.locator('#aceEndpoint').fill(NEURAL_ENDPOINT);
  await page.route(`${NEURAL_ENDPOINT}/**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
    } else if (request.url().endsWith('/release_task')) {
      await jsonResponse(route, { code: 200, data: { task_id: 'unsafe-output-task' } });
    } else if (request.url().endsWith('/query_result')) {
      await jsonResponse(route, { code: 200, data: [{ status: 1, result: [{ file: 'https://untrusted.invalid/stolen.wav' }] }] });
    } else {
      await route.abort('blockedbyclient');
    }
  });
  await page.locator('[data-neural-generate="lead"]').click();
  await expect(page.locator('#aceStatus')).toHaveText('Neural render stopped: ACE-Step returned an unexpected audio URL.');
  expect(unsafeRequests).toEqual([]);
  await expect(page.locator('[data-neural-state="lead"]')).toHaveText('local');
  await expect(page.locator('[data-neural-audio="lead"]')).not.toHaveAttribute('src');
  await expect(page.locator('#aceCancelBtn')).toBeDisabled();
  await expect(page.locator('[data-neural-generate="lead"]')).toBeEnabled();
});
