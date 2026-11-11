/**
 * Clipboard + file download helpers for the Mini App (Telegram WebView safe).
 */

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/** Copies text to the clipboard, returning true on success. */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to legacy path (WebView without clipboard permission) */
  }

  return fallbackCopy(value);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Downloads a JSON payload as a real file (one click, no server round-trip). */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, filename);
}

/** Downloads arbitrary text/markdown content as a file. */
export function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  triggerDownload(new Blob([String(text ?? '')], { type: mime }), filename);
}

/** Filesystem-safe slug for generated file names. */
export function safeFileSlug(value, fallback = 'config') {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
