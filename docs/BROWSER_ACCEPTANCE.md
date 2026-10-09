# Studio workflow acceptance

The repair branch builds on main at fdff80c6523235d8f6f9775a627fdbbb2136bde2, including merged PRs #9 and #10. Automated results do not close the physical Android/Chromebook release gate. Production deployment requires Robert's explicit approval.

## Automated checks

Use the committed checkout and package-lock.json, Node 22 or newer, then run:

    npm ci
    npx playwright install --with-deps chromium
    npm run verify

The syntax checker is portable across Windows and Linux. Playwright starts a loopback-only server and tests desktop Chromium plus an Android-sized touch viewport. Reports are written to playwright-report/ and test-results/browser-results.json. GitHub Actions records the exact checked-out head SHA and uploads reports named for that SHA. No expected failures or retries are configured.

The browser and Node suites cover:

- Native file chooser activation by pointer, touch and keyboard, followed by file delivery and real decoding. The all-files fallback accepts recordings with missing/generic MIME types. Attribute checks alone are insufficient.
- Cancellation, empty/corrupt audio, same-file reselection and out-of-order reads. Invalid imports preserve the prior take.
- Original playback, pause/end transport feedback, analysis, edited chords, phase/tempo/seed controls, waveform/manual exclusions and input validation.
- Eight active tracks: the original, three backing parts and four additional imported/recorded parts, with gains, start offsets, preview, original-audio downloads and removal.
- Project save/load, byte-based SHA-256 source matching, restoration of extra takes and gating incomplete projects. Legacy projects retain settings/exclusions but need explicit audio reselection and reanalysis because no content identity was saved.
- Real offline stereo mixing, audible extra-track contribution, WAV headers/duration/peak bounds, four-to-eight individually downloadable aligned stems and invalidation of prepared links.
- Mix and stem renders that finish after session edits cannot publish stale results. Same-name source replacement clears neural audio; cancellation is checked again after generated-audio decoding.
- Overlapping exclusions mute procedural release/delay tails and neural audio. Humanization uses the same phase as the beat grid. Ambient delay follows the lead volume envelope.
- Synthetic guitar-range flat/center/sharp pitch checks and browser tuner feedback/reset.
- Permission-denial recovery and real MediaRecorder encoding of a synthetic stream, including microphone-track release. No physical microphone is used.
- Optional neural requests use intercepted routes and a fake key. Local workflows must make no external requests; credentials/audio never enter project JSON.

The chooser tests intercept the browser filechooser event and supply generated audio. They prove browser control activation and decoding, not that Android DocumentsUI, Samsung My Files, Drive providers or ChromeOS Files work on a particular device. Cancellation is a deterministic browser event simulation. Synthetic streams prove application/encoder behavior, not microphone hardware, latency or acoustic quality.

## Physical-device gate — NOT RUN

Run on Robert's Samsung Galaxy A17 and Acer Chromebook 315 (4 GB RAM), with OS/browser version and exact commit SHA recorded. Use an approved private HTTPS preview or device-local localhost; this checklist does not authorize deployment. Keep real recordings private.

| ID | Test on each physical device | Required result |
| --- | --- | --- |
| D1 | Tap/click Choose Audio File; select a local WAV, MP3 and actual phone recording. Repeat from Downloads and available Drive/file providers. Try Browse all files if filtering hides a file. Cancel, retry, and select the same file twice. | Native chooser opens, file can be selected, filename/waveform/playback agree, errors explain unsupported codecs, cancel preserves the take. |
| D2 | Deny microphone permission for tuner and recorder, then allow it through site settings. Start/stop repeatedly and background/resume. | Controls recover; no stuck capture; microphone indicator ends on Stop. |
| D3 | Tune all six guitar strings against a reference tuner, slightly flat/sharp and in tune. | Direction and note are correct, readings stable and responsive enough for playing; no stale readings after silence/Stop. |
| D4 | Record an original, then a second part into track 5. Save both original-audio files. Import parts into tracks 6–8. Preview and adjust offsets. | All takes remain playable/saveable; no accidental replacement of other lanes. Assess practical alignment and recording latency with headphones. Live monitor mixing and automatic latency compensation are not implemented. |
| D5 | Analyze a real guitar performance. Review BPM/chords, set first beat after a count-in, generate backing, edit exclusions by touch/keyboard, adjust gains in both mixer views. | Band starts and stays on the intended grid; no backing leaks into excluded sections; controls remain usable and levels agree. Subjective backing quality requires listening. |
| D6 | Render mix; prepare stems; download each link individually. Locate WAVs in Files and play them outside the browser. Change a gain/seed/source during a render and retry. | Correct names and audible isolated tracks, no clipping/dropouts, coherent duration/start alignment, old downloads disappear after edits, no partial/stale links. |
| D7 | Save project, close/reopen, restore each saved original audio file, render again. Try an identically named different file and a legacy v0.5 project. | Verified recordings restore settings; wrong audio cannot silently inherit analysis. Missing takes prevent rendering. Legacy settings/exclusions survive, but analysis must be rerun. |
| D8 | Repeat with a representative full-length session on the 4 GB Chromebook and phone. | Record file size/duration, analysis/render time, memory pressure, freezes/crashes, thermal behavior and any practical capacity limit. The 150 MB import guard is not a guaranteed usable capacity. |

## Evidence record

    Commit SHA:
    Date/time/timezone:
    Local commands and exit codes:
    CI run URL and tested SHA:
    Browser version and viewport projects:
    Physical device / RAM / OS / browser:
    Preview origin and build identification:
    Recording format / size / duration (no private contents):
    D1–D8: PASS / FAIL / NOT RUN, with observation for each:
    Listening assessment and reference tuner:
    Remaining defects:
    Merge recommendation:
    Robert's deployment approval: PENDING
    Deployment: NOT PERFORMED

The local band remains procedural synthesis; neither unit tests nor synthetic fixture downloads establish session-player realism. Neural quality/service integration and standards-certified loudness/true-peak metering remain separate limitations. Both physical-device records must be reviewed before removing the release hold.
