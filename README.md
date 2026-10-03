# One-Man-Jam-Band-Studio

Local-first music production studio for turning raw guitar performances into complete arrangements while preserving the untouched original recording.

## Working now
- Live chromatic tuner
- Import or record audio in the browser
- Local tempo estimation and coarse key inference
- Audio activity-region analysis with explicit speech/music review boundary
- Deterministic **Jam Sketch** generator for drums, bass and lead
- Five-channel gain structure: original, drums, bass, lead and master
- Offline stereo rendering with conservative peak trim
- WAV preview and download
- Deterministic test suite and GitHub CI

## Architecture
The core studio works without a paid cloud service. Higher-fidelity instrument/AI renderers will plug into the same arrangement and mix model later. The current Jam Sketch engine is intentionally transparent: it follows estimated key and tempo, not yet the source recording's exact chord progression.

## Safety / ownership
- Original audio is never overwritten.
- Raw recordings are not committed to this repository.
- Generated assets stay local unless an approved private backend is explicitly enabled.
- Speech/music ambiguity is surfaced for review instead of silently treated as musical evidence.

## Next production gates
1. Chord/progression segmentation and section detection
2. Speech/music classifier with editable arrangement boundaries
3. Higher-fidelity sampled drums/bass and expressive lead provider
4. EQ, compression, reverb, limiter and loudness metering
5. Project save/load and stem export
6. Optional private GPU renderer behind owner authentication
