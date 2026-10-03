# One-Man-Jam-Band-Studio

Local-first music production studio for turning raw guitar performances into complete arrangements while preserving the untouched original recording.

## Working now
- Live chromatic tuner
- Import or record audio in the browser
- Local tempo, key and **chord-region** inference
- Editable chord timeline
- Explicit **no-accompaniment regions** for speech, interruptions, count-ins or other exclusions
- Deterministic chord-aware Jam Sketch generator for drums, bass and lead
- Five-channel gain structure: original, drums, bass, lead and master
- Room ambience control
- Master bus with high-pass cleanup, tonal shaping and compression presets (Natural / Warm / Open)
- Offline stereo rendering with conservative peak protection
- Peak/RMS metering plus estimated true peak and gated loudness
- Mix WAV preview/download
- Individual Original / Drums / Bass / Lead WAV stem export
- Portable `.omjbs.json` project save/load without embedding raw audio
- Deterministic test suite and GitHub CI

## Project privacy model
Project files contain settings, edits, analysis and arrangement metadata. They do **not** contain the source audio. Reopening a project requires selecting the matching local recording before rendering. Raw recordings remain outside Git.

## Architecture
The core studio works without a paid cloud service. Higher-fidelity instrument/AI renderers can plug into the same arrangement and mix model later. The current Jam Sketch follows inferred or edited chord regions and suppresses generated accompaniment inside blocked regions.

## Important meter note
The current true-peak and LUFS displays are engineering estimates for production guidance, not yet standards-certified BS.1770/EBU R128 metering. They are labeled as estimates in the UI.

## Safety / ownership
- Original audio is never overwritten.
- Raw recordings are not committed to this repository.
- Generated assets stay local unless an approved private backend is explicitly enabled.
- Speech/music ambiguity is surfaced for review instead of silently treated as musical evidence.

## Next production gates
1. Higher-fidelity sampled drums/bass and expressive lead provider
2. Section labels and waveform/timeline editing
3. Standards-grade LUFS/true-peak mastering meter and target normalization
4. Optional private GPU renderer behind owner authentication
5. Browser acceptance on Chromebook/Android and real-track regression checks
