# Tuner stability and audio-link follow-up

Baseline: main 4a54ff2e99c825ef8973a4ed7a76b2ccb76bdfb7 (merged PR #11).

## Reported defects and changes
- The old detector assigned pitches to all 12 seeded white-noise frames in the Watch-Dawg audit, and accepted DC. Replace unbounded correlation with a bounded, normalized difference detector; reject low energy and unconfident periodicity. Chromatic range: 55–1400 Hz.
- Analyze at most ten times per second, qualify note changes, median-filter pitch, smooth the needle, use sharp/flat hysteresis, and hold readings for up to 350 ms through dropouts. Stop releases microphone tracks, including a late permission result. Hiding the page stops the tuner.
- Move screen-reader announcements away from the continuously changing card to a status region updated only for changed note/state text.
- Add a pasteable audio-link form. Direct HTTPS downloads omit credentials/referrers, reject page responses, cap downloads at 150 MB while streaming, time out after 30 seconds, support cancellation, and reuse normal decoding and import guards.
- Recognize Google Drive file sharing links and preserve their resource key in an explicit external download handoff. **This is not authenticated in-app Drive import.** Open Drive, download the audio, return, and use the native picker; do not change private-file sharing. No OAuth client or Google API credentials are configured in this static app.
- Failed/canceled downloads retain the current take. A newer local import supersedes a pending URL download.

## Deterministic coverage
Node: seeded noise/DC, harmonic-rich plucks at 44.1/48 kHz, fading levels, tracker qualification/dropouts/hysteresis; Drive URL formats, unsafe schemes/credentials, content errors, size enforcement without headers, and aborted downloads.
Browser: Drive handoff, direct-link playback through mix WAV export, page/network/size/decode failures, cancel then local import, capped analysis under simulated 120 Hz frames, no pitch on noise, and stop before microphone permission resolves.
Existing native picker, eight-track, render/stem, stale download, and neural workflow checks remain in the suite.

## Acceptance still required
Tests synthesize signals and file-selection events. They cannot prove real Samsung A17 microphone quality, native Android/Chromebook picker behavior, Google Drive app handoff, or screen-reader announcement quality.
On an approved build: paste the actual Drive file link, download and select it, play/analyze/arrange/render/export; tune a real guitar in a quiet room and ordinary background noise; confirm note changes settle promptly and Stop releases the mic.
Production publication is a separate step. This branch does not modify hosting or publish.
