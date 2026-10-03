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
- Five-channel gain structure: original, drums, bass, lead and master
- Room ambience control
- Master bus with high-pass cleanup, tonal shaping and compression presets (Natural / Warm / Open)
- Offline stereo rendering with conservative peak protection
- Peak/RMS metering plus estimated true peak and gated loudness
- Mix WAV preview/download
- Individual Original / Drums / Bass / Lead WAV stem export
- Portable `.omjbs.json` project save/load without embedding raw audio
- Deterministic test suite and GitHub CI

## Sound-quality boundary
The built-in band is now a substantially more musical **procedural renderer**, not a claim of studio-session-player realism. It uses Web Audio synthesis/noise/filtering/envelopes and deterministic performance variation so the core remains private, local and zero-subscription. A higher-fidelity sampled or neural renderer can replace these instrument providers later without replacing the project, arrangement, mixer or mastering workflow.

## Project privacy model
Project files contain settings, edits, analysis and arrangement metadata. They do **not** contain the source audio. Reopening a project requires selecting the matching local recording before rendering. Raw recordings remain outside Git.

## Important meter note
The current true-peak and LUFS displays are engineering estimates for production guidance, not yet standards-certified BS.1770/EBU R128 metering. They are labeled as estimates in the UI.

## Safety / ownership
- Original audio is never overwritten.
- Raw recordings are not committed to this repository.
- Generated assets stay local unless an approved private backend is explicitly enabled.
- Speech/music ambiguity is surfaced for review instead of silently treated as musical evidence.

## Next production gates
1. Optional higher-fidelity sampled instrument pack with clear licensing and local caching
2. Optional expressive neural/AI renderer behind explicit owner authentication
3. Section labels, waveform zoom and transport-linked timeline editing
4. Standards-grade LUFS/true-peak target normalization
5. Chromebook/Android browser acceptance and real-track regression checks
