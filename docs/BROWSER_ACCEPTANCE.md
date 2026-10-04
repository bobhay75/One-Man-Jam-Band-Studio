# v0.5.0 browser acceptance

This is the browser acceptance contract for the consolidated v0.5.0 application. The runner covers existing music generation and rendering, plus the stale-download invalidation fixes described below. A successful automated run is one part of acceptance; it does not close the Chromebook/Android production gate. Keep this build undeployed until the remaining findings and device checks are reviewed and deployment is separately authorized.

## Run the automated checks

Use the committed checkout and lockfile. Install Node.js/npm and the supported Chromium dependencies, then run:

```bash
npm ci
npx playwright install --with-deps chromium
npm run verify
```

`verify` runs JavaScript syntax checks, the Node test suite, and Playwright browser acceptance. The Playwright configuration starts its local test server. No ACE-Step service, microphone, private recording, API key, or deployment is required.

```bash
# Both browser projects
npm run test:browser

# One browser project
npm run test:browser -- --project=chromium-desktop
npm run test:browser -- --project=chromium-mobile

# Interactive local debugging (requires a graphical session)
npm run test:browser -- --headed
```

Record `git rev-parse HEAD` with every run. Retain the command results and failure artifacts with that SHA; a later commit needs a new run. The mobile project is Android-sized Chromium emulation, not a Samsung Galaxy A17 or ChromeOS test.

The runner writes an HTML report in `playwright-report/` and a machine-readable report at `test-results/browser-results.json`. CI uploads both under an artifact name containing the exact tested head SHA and run ID. Reports/traces use only generated fixtures and the fake key. All 14 cases per viewport are normal passing assertions (28 total); there are no expected-failure cases. Inspect `expectedStatus` versus actual `status` in the JSON/HTML report when recording results.

For a constrained local runner with Chromium already installed, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium npm run verify` selects that executable. Record its version with the result. CI uses the browser pinned by the Playwright lockfile, without this override.

## What the runner establishes

The tests drive the visible page and use a generated short PCM WAV. Browser file selection, Web Audio decoding/rendering, project download/upload, and WAV downloads use their real browser APIs. The deterministic fixture makes state assertions reproducible; it is not evidence of musical quality, real-recording compatibility, or long-session performance.

| Area | Automated boundary | Remaining evidence |
| --- | --- | --- |
| Core UI | Initial controls, source-dependent actions, analysis and arrangement wiring | Real microphone, hardware input/output, device usability |
| Project save/load | Downloaded project JSON, saved edits/settings, matching-source requirement, absence of source/neural audio and runtime credentials | Native file picker/download folder, reopening actual recordings; full control fidelity is not claimed |
| Waveform and chords | Canvas selection, manual exclusion controls, editable chord timeline, invalid JSON feedback, downstream state transitions | Finger drag/scroll interaction, guitar-derived analysis accuracy |
| Mixer and exports | Mixer/mastering controls, render/download states, real short-fixture WAV/stem download plumbing | Native multiple-download permission, listening, full-track duration and memory use |
| Neural opt-in | Explicit actions and intercepted request boundaries; fake sentinel key and generated WAV response | Real owner-selected server integration, latency and generated music quality |

Neural routes are intercepted by the runner. The sentinel key is deliberately fake; no real credentials are supplied and no source audio is sent to a real neural provider. A server check is an explicit metadata request; submitting source audio requires an explicit neural-generation action. The tests do not authorize or provision a service.

## Stale-download regressions fixed

Two stale-export transitions originally reproduced against v0.5.0 now use the existing `invalidateRender()` helper:

- Successful re-analysis clears the previous rendered buffer, preview URL and status, and disables mix download while the arrangement needs regeneration.
- Source upload clears the same render state and disables mix download even when the filename is unchanged. Project reopening and neural-stem retention rules are unchanged.

Both regressions run as normal assertions on both viewports. Each requires download, render and stem export to be disabled after invalidation, the old preview/status to be cleared, and a fresh arrangement/render to produce a valid downloadable stereo WAV. The four former expected failures are no longer exempted from passing.

## Remaining project limitations

Project/source matching currently uses the filename, not an audio-content fingerprint. Keep the intended original recording and verify it when reopening; the suite does not establish content identity for same-named files. The arrangement seed input also is not restored to the UI from a loaded arrangement, so the suite does not claim that every control round-trips. These behaviors are outside the stale-download fix.

## Real-device checklist — not yet verified

Run every row on **Acer Chromebook 315 (4 GB RAM)** and **Samsung Galaxy A17** using the exact reviewed commit. Record the actual OS/browser version. Use an approved private HTTPS preview or device-local localhost so microphone access has a secure context; an ordinary remote HTTP page is not a valid microphone test. This checklist does not authorize production deployment.

Use a short fresh guitar recording first, then one representative full-length recording. Keep the original files unchanged and private. Start a clean page session, leave neural generation unused, and use headphones when checking recording/playback to avoid feedback. Mark each device result `PASS`, `FAIL`, or `NOT RUN`; write what happened rather than inferring a pass from automation.

| ID | Reproducible action on each physical device | Evidence required / acceptance check |
| --- | --- | --- |
| D1 — Tuner permission | With microphone permission reset, select **Start Tuner**, deny, then allow through browser/site settings and retry. Select **Stop Tuner**; repeat start/stop. | Denial and recovery are understandable; UI recovers; microphone indicator ends when stopped. Record errors, repeated prompts or a stuck permission state. |
| D2 — Guitar tuning | Play each open guitar string, then small sharp/flat adjustments, with a reference tuner for comparison. Try quiet room, normal playing distance, and a brief background/resume cycle. | Record note/frequency/cents stability, estimated response delay, missed notes and restart behavior. Decide usability from actual playing; a synthetic waveform does not establish tuner responsiveness. |
| D3 — Recording permission and codec | Reset permission again. Select **Record**, deny, then allow and retry. Record 10–20 seconds, stop, listen and inspect the waveform. Repeat; separately try tuner and recorder together, stopping each. | Record actual browser recording MIME type/codec where available, UI errors and decode/playback result. No microphone remains active after both features stop; when one still uses it, continued access is expected. Permission-denial recovery is an open check, not an asserted pass. |
| D4 — Real uploads and capacity | Use the native file picker to upload the actual phone/Chromebook recording and a representative full-length track. Play, analyze, arrange and render it. Repeat a source replacement and a render. | Note format, file size, duration, analysis/render elapsed time, memory observation if available, tab reloads/crashes, stalls or thermal slowdown. Do not assume every `audio/*` format decodes. Establish usable limits for the 4 GB Chromebook. |
| D5 — Touch and editing | On A17, drag a waveform exclusion with a finger, then scroll past the canvas and repeat in both directions. Edit/apply a chord region; add/remove a manual exclusion. On Chromebook, repeat with trackpad and keyboard. | Correct time interval and region list; ordinary navigation remains usable; regenerated accompaniment respects the edited regions. Capture any accidental scroll/selection. Emulated pointer events do not prove touch behavior. |
| D6 — Portable project privacy | Make recognizable chord, region and mixer edits; save the `.omjbs.json`. Inspect it locally, reopen in a fresh session, select the original source file and render. Try opening the project before selecting audio. Use only a fake sentinel if checking the API-key field. | Settings/edits retained as supported; source must be selected locally; no raw source/neural audio, endpoint or API key in saved JSON. Reload must not retain the runtime key. Record filename-matching and seed-control limitations above. Do not place private JSON/audio in Git or public evidence. |
| D7 — Native downloads and listening | Render, download the mix, then select **Export 4 Stems**. Accept native multiple-download permission if requested. Find all five WAV files using the device's file manager and play them in another player. | Record actual download location and names: `*-mix.wav`, `*-original.wav`, `*-drums.wav`, `*-bass.wav`, `*-lead.wav`. Confirm nonempty valid WAVs, channel count, sample rate and duration against the source/render. Listen to beginning/middle/end for expected content, correct stem isolation, dropouts, clipping and usable levels. Note browser blocks, duplicate names, missing files or playback errors. |

The built-in loudness and true-peak displays remain estimates. A green test run or a successful file download does not establish standards-certified metering, musical quality, or acceptable output levels.

## Evidence record

Copy this per exact commit and device. Reference private evidence without attaching recordings or credentials to a public repository.

```text
Commit SHA:
Test date/time and timezone:
Automated command(s), exit status, CI/run link:
Browser projects passed / failed / expected failures:

Physical device and RAM:
OS version / browser version:
Private preview origin and build identification:
Source format / size / duration (no private recording contents):

D1: NOT RUN — observation / evidence reference:
D2: NOT RUN — observation / response delay / reference tuner:
D3: NOT RUN — permission recovery / codec / mic release:
D4: NOT RUN — timings / memory / limits:
D5: NOT RUN — input method / observed selection:
D6: NOT RUN — restored edits / privacy / limitations:
D7: NOT RUN — names / location / WAV metadata / listening:

Open defects and reproduction steps:
Retest SHA and results after any fix:
Device gate: NOT COMPLETE / COMPLETE (with evidence)
Owner release decision: PENDING
Deployment: NOT PERFORMED
```

The physical-device gate remains open until both device records are complete and any failures have an explicit release disposition. All D1–D7 physical checks remain NOT RUN; the automated stale-download regressions do not change that status. Keep browser acceptance, device acceptance, optional neural service integration, and deployment authorization as separate evidence.
