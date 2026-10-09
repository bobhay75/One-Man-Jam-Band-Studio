import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export { expect };
export const FAKE_KEY = 'browser-test-not-a-credential';
export const NEURAL_ENDPOINT = 'https://neural.invalid/ace';

// Independent PCM fixture: no production encoder, binary asset, or user recording.
export function wavFixture() {
  const rate = 16000, frames = rate * 2;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const pulse = 0.35 + 0.65 * Math.exp(-20 * (t % 0.5));
    const sample = pulse * (Math.sin(2 * Math.PI * 130.8128 * t)
      + Math.sin(2 * Math.PI * 164.8138 * t) + Math.sin(2 * Math.PI * 195.9977 * t)) / 6;
    bytes.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return bytes;
}

export const test = base.extend({
  expectedMicRequests: [0, { option: true }],
  page: async ({ page, expectedMicRequests }, use) => {
    const errors = [], unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    // Per-test neural mocks are registered later and take precedence. Everything
    // else must stay local. An accidental upload is aborted before network I/O.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4173') return route.continue();
      unexpectedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await page.addInitScript(() => {
      window.__acceptanceMicRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.__acceptanceMicRequests++;
        throw new Error('Hardware microphone is outside deterministic acceptance.');
      };
    });
    await page.goto('/');
    await expect(page.locator('#arrangement')).toHaveText('No arrangement generated.');
    await use(page);
    expect(errors, 'Unhandled page errors').toEqual([]);
    expect(unexpectedRequests, 'Unexpected non-local network activity').toEqual([]);
    expect(await page.evaluate(() => window.__acceptanceMicRequests)).toBe(expectedMicRequests);
  },
});

export async function uploadAudio(page, name = 'acceptance-tone.wav') {
  await page.locator('#audioFile').setInputFiles({ name, mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.locator('#meta')).toContainText(name);
  await expect(page.locator('#waveformStatus')).toContainText('2.0s');
}
export async function prepareArrangement(page) {
  await uploadAudio(page);
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#arrangeBtn')).toBeEnabled();
  await page.locator('#arrangeBtn').click();
  await expect(page.locator('#renderBtn')).toBeEnabled();
}
export async function renderMix(page) {
  await page.locator('#renderBtn').click();
  await expect(page.locator('#renderStatus')).toContainText('stereo WAV');
  await expect(page.locator('#downloadBtn')).toBeEnabled();
}
export async function downloadBytes(download) {
  expect(await download.failure()).toBeNull();
  return readFile(await download.path());
}
export async function saveProject(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#saveProjectBtn').click();
  const download = await pending;
  const json = (await downloadBytes(download)).toString('utf8');
  return { project: JSON.parse(json), json, download };
}
export async function loadProject(page, json) {
  await page.locator('#projectFile').setInputFiles({
    name: 'acceptance.omjbs.json', mimeType: 'application/json', buffer: Buffer.from(json),
  });
  await expect(page.locator('#meta')).toContainText('Project loaded');
}
export async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await expect(page.locator(selector)).toHaveValue(String(value));
}
export function expectStereoWav(bytes) {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(bytes.readUInt16LE(20)).toBe(1); // PCM
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.toString('ascii', 36, 40)).toBe('data');
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  const rate = bytes.readUInt32LE(24), frames = (bytes.length - 44) / 4;
  expect(rate).toBeGreaterThanOrEqual(16000);
  expect(rate).toBeLessThanOrEqual(192000);
  expect(frames / rate).toBeCloseTo(2, 2);
  let peak = 0;
  for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(32114); // existing .98 peak protection
}
