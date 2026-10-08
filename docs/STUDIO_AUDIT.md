# Watch-Dawg workflow repair audit

## Inspected baseline

- PR #9: merged as 80280e16922cc37d3078b0763226dadc5ce839a2; head 305b52525f443db1c628f51bd2aa62821f5ed6d2. Introduced the tuner display, tighter local band and eight-lane presentation. Its description reported no completed full Chromium run; Copilot could not review due to quota.
- Current main when inspected: fdff80c6523235d8f6f9775a627fdbbb2136bde2. Includes PR #10's label-based picker fix, but its acceptance assertion checked only markup.
- Baseline Node tests: 11 files passed locally. No production deployment was performed.

## Concrete findings and repairs

| Finding | Repair | Evidence boundary |
| --- | --- | --- |
| Main call-to-action relied on a label plus a synthetic keyboard click, while tests never opened a chooser. Audio-only filtering can hide generic-MIME recordings. | Visible native file input at the start of the workflow, explicit audio extensions, unrestricted fallback, cancel/retry and decode feedback. | Browser chooser event activation and real decoding are automated; real device file-provider acceptance is outstanding. |
| Import/record failures could reject without feedback, leak URLs/capture, or leave transport text stale. | Transactional imports, last-selection guard, inline live status, codec selection, recording lock, capture release, original downloads, URL cleanup and playback/end handlers. | Synthetic stream uses the browser encoder; physical permission/codec behavior remains a device gate. |
| Lanes 5–8 advertised recording but had no audio controls or render contribution. Mixer copies could disagree. | Four real additional takes with import/record destination, preview, gain, signed start offset, removal and raw-file saving. Mix/export includes them; paired gains synchronize. | Eight-track save/restore, downloads and actual audio contribution tested. Monitoring/automatic latency compensation remain outside this repair. |
| Render promises could republish old audio after source, project, mixer or seed edits. Partial stem downloads could escape before completion. | Revision-checked snapshots; publish only a complete current result; prepare individual stem links rather than triggering multiple automatic downloads. | Delayed real offline renders exercise mix and stem races. |
| Same-named files were treated as matching project audio; same-name imports could retain neural stems. | SHA-256 identity, explicit pending restoration state, missing-take render gate; clear/abort neural data on source changes and recheck after decode. | Different-byte same-name, late neural decode, project restoration and legacy fallback tests. |
| Exclusions checked event starts but not sustained tails; overlapping neural gain automation could unmute too early. | Merge intervals and gate procedural/neural outputs, including backing room effects. | Audio samples within blocked intervals are checked, including ambient lead. |
| Ambient delay bypassed the lead envelope; swing ignored first-beat phase; inferred silence had a bogus BPM. | Envelope-fed delay, phase-relative swing, explicit tempo/first-beat correction, no tempo estimate from silence; no chord merging across silence. | Signal/state tests and deterministic rendering; musical quality still requires real listening. |
| Tuner errors used alerts; stale note values survived Stop/silence. | Recoverable inline messages, resumed audio context, larger guitar-range analysis window, exclusive start handling and reset readings. | Guitar-range synthetic signals and real Web Audio browser tuner states. |
| Invalid chord rows and malformed project settings could reach audio scheduling; syntax script required Unix tools. | Validate ranges, numeric settings and arrangement events; preserve current project on failure; portable Node syntax checker. | Node plus browser invalid-input checks; existing v0.5 source, waveform, provider and WAV behavior retained. |

## Release disposition

HOLD release until physical-device file selection, microphone, long-session and listening checks pass on both target devices. Use docs/BROWSER_ACCEPTANCE.md for the exact checklist and evidence format. A green CI run only establishes the automated boundary. Do not merge/deploy as a substitute for the owner's device review; production deployment requires Robert's explicit approval.
