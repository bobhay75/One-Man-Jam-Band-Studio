export const MAX_AUDIO_BYTES = 150 * 1024 * 1024;
export function parseAudioLink(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Paste a complete HTTPS audio or Google Drive file link."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS link without a username or password.");
  if (url.hostname === "drive.google.com" || url.hostname === "docs.google.com") {
    const id = url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1]
      || (["/open", "/uc"].includes(url.pathname) ? url.searchParams.get("id") : null);
    if (!id || !/^[\w-]{10,200}$/.test(id)) throw new Error("Use a Google Drive file link, not a folder or document link.");
    const open = new URL("https://drive.google.com/file/d/" + id + "/view");
    const key = url.searchParams.get("resourcekey");
    if (key && /^[\w-]+$/.test(key)) open.searchParams.set("resourcekey", key);
    return { kind: "drive", url: open.href };
  }
  return { kind: "audio", url: url.href };
}

export async function fetchAudioLink(url, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  const rejectResponse = async message => {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  };
  if (!response.ok) return rejectResponse("The audio host returned an error. Download the file and use Choose Audio File.");
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (/html|json|xml/.test(type)) return rejectResponse("This link opens a page, not an audio file. Download the audio there, then use Choose Audio File.");
  if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) return rejectResponse("This file is larger than 150 MB.");
  if (!response.body) throw new Error("No downloadable audio was returned.");
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error("This file is larger than 150 MB.");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  signal?.throwIfAborted();
  if (!size) throw new Error("This audio file is empty.");
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop()); } catch {}
  name = (name || "linked-audio").replace(/[\x00-\x1f/\\]/g, "_").slice(0, 180);
  return new File(parts, name, { type: type || "application/octet-stream" });
}
