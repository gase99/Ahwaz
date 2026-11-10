const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function utf8ToBytes(str) {
  return encoder.encode(String(str ?? ''));
}

export function bytesToUtf8(bytes) {
  if (bytes instanceof Uint8Array) return decoder.decode(bytes);
  if (bytes instanceof ArrayBuffer) return decoder.decode(new Uint8Array(bytes));
  return String(bytes ?? '');
}

export function utf8ByteLength(str) {
  return utf8ToBytes(str).byteLength;
}

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < u8.length; i += 3) {
    const b0 = u8[i];
    const b1 = i + 1 < u8.length ? u8[i + 1] : 0;
    const b2 = i + 2 < u8.length ? u8[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    out += BASE64_CHARS[(triplet >> 18) & 0x3f];
    out += BASE64_CHARS[(triplet >> 12) & 0x3f];
    out += i + 1 < u8.length ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    out += i + 2 < u8.length ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(b64) {
  const clean = String(b64 ?? '').replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  if (len === 0) return new Uint8Array(0);

  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((len * 3) / 4) - pad;
  const out = new Uint8Array(outLen);

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = Math.max(0, BASE64_CHARS.indexOf(clean[i]));
    const c1 = Math.max(0, BASE64_CHARS.indexOf(clean[i + 1]));
    const c2 = clean[i + 2] === '=' ? 0 : Math.max(0, BASE64_CHARS.indexOf(clean[i + 2]));
    const c3 = clean[i + 3] === '=' ? 0 : Math.max(0, BASE64_CHARS.indexOf(clean[i + 3]));

    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLen) out[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triplet & 0xff;
  }

  return out;
}
