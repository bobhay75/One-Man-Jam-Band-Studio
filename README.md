# One-Man-Jam-Band-Studio

Local-first music production studio for turning raw guitar performances into complete arrangements while preserving the untouched original recording.

## Working now
- Live chromatic tuner
- Import or record audio in the browser
- Local tempo, key and **chord-region** inference
- Audio activity-region analysis with explicit speech/music review boundary
- Deterministic chord-aware **Jam Sketch** generator for drums, bass and lead
- Five-channel gain structure: original, drums, bass, lead and master
- Master bus with high-pass cleanup, tonal shaping and compression presets (Natural / Warm / Open)
- Offline stereo rendering with conservative peak protection
- Peak/RMS metering
- WAV preview and download
- Deterministic test suite and GitHub CI

## Architecture
The core studio works without a paid cloud service. Higher-fidelity instrument/AI renderers plug into the same arrangement and mix model later. The current Jam Sketch follows inferred chord regions when confidence is available and falls back to a key-aware progression when it is not.

## Safety / ownership
- Original audio is never overwritten.
- Raw recordings are not committed to this repository.
- Generated assets stay local unless an approved private backend is explicitly enabled.
- Speech/music ambiguity is surfaced for review instead of silently treated as musical evidence.

## Next production gates
1. Editable section/chord timeline and no-accompaniment regions
2. Higher-fidelity sampled drums/bass and expressive lead provider
3. Reverb, stem export and project save/load
4. LUFS/true-peak mastering targets
5. Optional private GPU renderer behind owner authentication
