# VocalLift inside One-Man Jam Band Studio

Added November 22, 2026 for Bob Hayes.

## What this adds

VocalLift is a local audio enhancement stage for the original/source track, Track 6 (Vocal), or Track 7 (Harmony). It has Natural, Spoken word, Singing, and Warm & intimate presets, plus adjustable cleanup, warmth, clarity, level, room, and wet/dry mix. An enhanced take can be previewed, downloaded as a WAV, used in the studio mix and stem export, or bypassed to use the original again.

The original recording and decoded source buffer remain separate from the processed buffer. The existing original players and original-audio download controls continue to use the original files. Processing a mixed guitar-and-voice recording changes the whole recording; it does not isolate the voice.

## Use it in the studio

1. Load or record the guitar/original take, then add a separate Vocal or Harmony take. For a voice-only recording, choose Track 1 as the Voice track; it can record directly in an empty session. The Record button follows the selected Voice track.
2. Choose a preset, adjust any controls, and select **Enhance voice**.
3. Compare **Original** and **Enhanced** using the preview player.
4. Select **Use enhanced in mix**, then render the Studio Mix or stems. Changing the effect or restoring the original invalidates the previous render so it must be rendered again.
5. Download the enhanced WAV to keep that version for another session.

**Try synthetic demo** is available in an empty session. It creates a nine-second guitar part and synthetic vowel melody, imports both through the regular audio pipeline, and supplies a known C-major arrangement at 100 BPM. No person is recorded. The demo is labeled as generated audio, and its known musical metadata is not presented as analysis of a real performance. It cannot replace an already loaded source take.

## Persistence and privacy

Vocal enhancement runs entirely inside the browser using Web Audio and JavaScript. It does not call a hosted AI service or send audio to a server. The studio's pre-existing optional neural renderer remains a separate, explicitly invoked feature and can send audio to the endpoint selected by the user.

VocalLift effects and their rendered buffers are session-only in this release. The existing project format is unchanged. Download any enhanced audio that must survive closing or reloading the page; it can be imported into the Vocal or Harmony track later. A saved project file does not contain those audio bytes or restore the effect automatically.

## Processing pipeline

1. Analyze sample peak, RMS, clipping, and short-time levels.
2. Apply conservative expansion in quiet passages when identifiable pauses support it.
3. Use a high-pass filter, warmth and presence equalization, and gentle high-shelf softening.
4. Add optional short room ambience.
5. Use linked-channel compression to reduce abrupt level differences.
6. Apply bounded level adjustment, wet/dry blending, and linked-channel sample-peak protection.

Processed output is capped at approximately -1.2 dBFS sample peak. This is not a true-peak or LUFS mastering claim. A zero effect mix intentionally preserves finite original samples exactly, including any source clipping; exported 16-bit WAV samples are clamped to their valid numeric range. Silence remains silence.

## Limits

- Mono or stereo audio, up to five minutes per enhanced take.
- Browser decoding may resample a file to the current audio context's sample rate. The engine preserves the decoded buffer's dimensions and duration.
- Long compressed recordings can occupy much more memory after decoding. A five-minute, 48 kHz stereo Float32 buffer alone uses about 115 MB, and processing requires multiple buffers. Prefer short takes on a phone.
- Noise reduction mainly softens pauses and rumble. It does not reconstruct damaged speech or remove all noise beneath active singing.
- No automatic pitch correction, timing correction, voice cloning, or separation of voice from accompaniment is included.
- Existing clipped distortion cannot be repaired by lowering the output level.
- Room tails stop at the source recording's end. Leave a short trailing pause when recording a sung phrase.
- Microphone capture and headphone/interface latency need acceptance on the user's physical device; a browser test using synthetic samples does not establish microphone quality.

## Run and host

This is a buildless, dependency-free static web application. No package installation is needed.

From the repository root:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` on the same machine. Microphone recording requires a browser-approved secure context; use HTTPS for access from another device.

For cPanel hosting, upload `index.html`, `styles.css`, and `src/` into a chosen folder such as `public_html/jam-studio/`. Preserve the `src/` subdirectory and enable HTTPS on the domain. This instruction does not claim that the application has been deployed to bobsome1.com.

## Source and verification

- `src/vocal-engine.js`: enhancement, presets, numerical analysis, demo generation, PCM WAV encoding.
- `src/app.js`: studio integration, target selection, comparison, processed-buffer routing, and original preservation.
- `index.html` and `styles.css`: integrated controls and responsive presentation.
- `tests/vocal-engine.test.mjs`: deterministic engine tests.
- `tests/browser/vocal-integration.html`: actual-browser renderer checks, served only by the browser test's intercepted diagnostic route.
- `tests/browser/vocal.spec.mjs`: desktop and mobile Chromium checks for processing, mix routing, original preservation, preview/download, synthetic demo and recording destinations. The mobile viewport does not emulate a physical phone's microphone or audio hardware.

Run the numerical tests and syntax checks:

```bash
npm test
npm run check
```

The numerical checks do not replace listening tests. Use the Original/Enhanced previews and the complete rendered mix to decide how much processing suits a particular voice.

## Engine API

```js
import { PRESETS, enhanceAudio, encodeWav } from './src/vocal-engine.js';

const result = await enhanceAudio(originalAudioBuffer, {
  ...PRESETS.find(preset => preset.id === 'singing').settings,
  mix: 80,
}, (fraction, stage) => {
  // Update a progress indicator. fraction is between 0 and 1.
});

// Keep originalAudioBuffer intact; route result.buffer into the chosen mix slot.
const wav = encodeWav(result.buffer); // Blob with audio/wav MIME type
```
