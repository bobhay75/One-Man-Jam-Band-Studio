# One-Man-Jam-Band-Studio

Local-first music production studio for turning raw guitar performances into complete arrangements while preserving the untouched original recording.

## Working now
- Live chromatic tuner
- Import or record audio in the browser
- Visible native file chooser plus an unrestricted all-files fallback and inline import errors
- Eight working tracks: original, drums, bass, lead, and four extra takes with import/record destination, preview, gain, signed start offset, removal and original-audio saving
- Local tempo, key and chord-region inference
- Editable chord timeline
- Drag-to-edit waveform exclusions plus manual no-accompaniment regions
- Deterministic chord-aware arrangement engine
- Editable tempo and first-beat position; seed/phase-aware regeneration
- Expressive local procedural instruments:
  - Drums: Studio / Loose / Brush
  - Bass: Round / Picked / Woody
  - Lead: Clean / Blues / Ambient
- Repeatable timing/velocity humanization and swing
- Lead bends, vibrato, drive and optional ambient delay
- Optional **ACE-Step 1.5 neural stem renderer**
  - Lego-mode Drums, Bass, or Lead Guitar generated from the source recording
  - Generate one neural stem or all three
  - Neural stems replace only their matching local track
  - Clear any neural stem to fall back instantly to the procedural renderer
  - Runtime-only API key; not stored in Git or project JSON
  - HTTPS required for remote endpoints; HTTP allowed only on localhost
- Eight-track gain structure plus master; workspace and mixer controls stay synchronized
- Room ambience control
- Master bus with high-pass cleanup, tonal shaping and compression presets (Natural / Warm / Open)
- Offline stereo rendering with conservative peak protection
- Peak/RMS metering plus estimated true peak and gated loudness
- Mix WAV preview/download
- Individual Original / Drums / Bass / Lead plus populated extra-track WAV downloads, with explicit links that avoid automatic multiple-download blocking
- Portable `.omjbs.json` project save/load without embedding raw audio
- Deterministic Node and Chromium browser acceptance suites, plus recursive JavaScript syntax checks in GitHub CI

## Neural renderer architecture
The local procedural band remains the zero-service default. The optional ACE-Step adapter talks to an owner-selected ACE-Step 1.5 REST API and uses the **base model's Lego task** to add one instrument at a time. Generated WAVs remain runtime assets and are not embedded in the project file.

See `docs/ACE_STEP.md` for setup and security details.

## Sound-quality boundary
The built-in band is a musical procedural renderer, not a claim of session-player realism. The optional neural provider is the path for higher-fidelity generation while preserving the same waveform editor, arrangement, mixer, mastering, stem export, and project model.

## Project privacy model
Project files contain settings, edits, analysis, arrangement metadata and audio SHA-256 identities. They do **not** contain source audio, neural audio, API endpoint, or API key. Save each original recording using its **Save Original Audio** control as well as saving the project. Reopening requires reselecting each matching local take before rendering. Same-named different audio cannot inherit saved analysis. Legacy v0.5 projects without identities retain settings/exclusions but require explicit reselection and reanalysis. Raw recordings remain outside Git.

Extra recordings share a timeline with the original; use a negative start offset to trim an input delay or a positive offset to delay a part. Live monitor mixing and automatic recording-latency compensation are not implemented. Replacing the original resets its analysis/arrangement/exclusions and preserves extra takes. Stems are aligned, pre-fader, without master effects; they are not a promise that their sum reproduces the mastered mix.

## Important meter note
The current true-peak and LUFS displays are engineering estimates for production guidance, not yet standards-certified BS.1770/EBU R128 metering. They are labeled as estimates in the UI.

## Safety / ownership
- Original audio is never overwritten.
- Raw recordings are not committed to this repository.
- Source audio is sent to a neural server only after an explicit generation action.
- Remote neural endpoints must use HTTPS.
- Generated neural URLs are accepted only from the configured ACE-Step server origin/path policy.
- Speech/music ambiguity is surfaced for review instead of silently treated as musical evidence.

## Next production gates
1. Physical Chromebook/Android acceptance with real uploaded tracks; deterministic browser coverage is automated, including stale-download invalidation regressions
2. Standards-grade LUFS/true-peak target normalization
3. Optional sampled instrument pack with explicit licensing/local caching
4. Section labels, waveform zoom and transport-linked timeline editing
5. Owner-controlled GPU deployment recipe for ACE-Step base/XL-base

## Browser acceptance

```bash
npm ci
npx playwright install --with-deps chromium
npm run verify
```

`npm run verify` runs portable syntax checks, Node tests, and browser acceptance on desktop and Android-sized Chromium viewports. `npm run test:browser` runs only the browser suite. Tests use generated audio, actual chooser activation and Web Audio/MediaRecorder APIs, synthetic microphone streams, and intercepted neural requests; no physical microphone, service or credentials are required. Revision-checked render snapshots prevent mix/stem downloads from becoming stale while work is still in progress.

See [the acceptance checklist](docs/BROWSER_ACCEPTANCE.md) for coverage, stale-download regression checks, and the remaining physical-device checks. Emulated mobile results do not close the Chromebook/Android production gate. The build remains undeployed.

See [the workflow audit](docs/STUDIO_AUDIT.md) for the inspected PR #9/#10 baseline, defects repaired and release disposition. **HOLD** release pending physical-device and listening acceptance; production deployment requires Robert's explicit approval.
