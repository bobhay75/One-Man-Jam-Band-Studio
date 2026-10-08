// Portable metadata only. Decoded audio and object URLs stay in page memory.
export const EXTRA_TRACKS = ['track5', 'track6', 'track7', 'track8'];
export const TRACK_NAMES = { track5: 'Guitar Double', track6: 'Vocal', track7: 'Harmony', track8: 'FX / Room' };
export const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac,.aif,.aiff';

export async function audioIdentity(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function matchesSource(saved, candidate) {
  // Legacy projects have no digest: require explicit reselection and reanalysis.
  return !!saved?.sha256 && saved.sha256 === candidate?.sha256;
}

export function validateChords(timeline, duration = Infinity) {
  if (!Array.isArray(timeline)) throw new Error('Chord timeline must be a JSON array.');
  let end = 0;
  for (const r of timeline) {
    if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec) ||
        r.startSec < end || r.endSec <= r.startSec || r.endSec > duration + .01 ||
        !/^[A-G](?:#|b)?m?$/.test(r.chord)) {
      throw new Error('Use ordered, non-overlapping chord regions within the take, with major/minor names such as C, F# or Bb.');
    }
    end = r.endSec;
  }
  return timeline;
}

export function mediaError(error) {
  if (error?.name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in browser site settings, then retry, or choose an audio file.';
  if (error?.name === 'NotFoundError') return 'No microphone was found. Connect one or choose an audio file.';
  if (error?.name === 'NotReadableError') return 'The microphone is unavailable or in use. Close other recording apps and retry.';
  return error?.message || 'Audio could not be opened. Try a WAV or MP3 file.';
}
