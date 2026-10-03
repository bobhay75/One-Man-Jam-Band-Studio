# One-Man-Jam-Band-Studio

Local-first music production studio for turning raw guitar performances into complete arrangements while preserving the untouched original recording.

## Working now
- Live chromatic tuner
- Import or record audio in the browser
- Local tempo, key and chord-region inference
- Editable chord timeline
- Drag-to-edit waveform exclusions plus manual no-accompaniment regions
- Deterministic chord-aware arrangement engine
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
- Five-channel gain structure: original, drums, bass, lead and master
- Room ambience control
- Master bus with high-pass cleanup, tonal shaping and compression presets (Natural / Warm / Open)
- Offline stereo rendering with conservative peak protection
- Peak/RMS metering plus estimated true peak and gated loudness
- Mix WAV preview/download
- Individual Original / Drums / Bass / Lead WAV stem export
- Portable `.omjbs.json` project save/load without embedding raw audio
- Deterministic test suite and recursive JavaScript syntax checks in GitHub CI

## Neural renderer architecture
The local procedural band remains the zero-service default. The optional ACE-Step adapter talks to an owner-selected ACE-Step 1.5 REST API and uses the **base model's Lego task** to add one instrument at a time. Generated WAVs remain runtime assets and are not embedded in the project file.

See `docs/ACE_STEP.md` for setup and security details.

## Sound-quality boundary
The built-in band is a musical procedural renderer, not a claim of session-player realism. The optional neural provider is the path for higher-fidelity generation while preserving the same waveform editor, arrangement, mixer, mastering, stem export, and project model.

## Project privacy model
Project files contain settings, edits, analysis and arrangement metadata. They do **not** contain the source audio, neural audio, API endpoint, or API key. Reopening a project requires selecting the matching local recording before rendering. Raw recordings remain outside Git.

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
1. Browser acceptance on Chromebook/Android with real uploaded tracks
2. Standards-grade LUFS/true-peak target normalization
3. Optional sampled instrument pack with explicit licensing/local caching
4. Section labels, waveform zoom and transport-linked timeline editing
5. Owner-controlled GPU deployment recipe for ACE-Step base/XL-base
