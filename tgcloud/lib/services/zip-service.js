import { bytesToUtf8, utf8ToBytes } from './binary-utils.js';

// Precompute standard IEEE 802.3 CRC32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Builds a valid PKZIP archive (STORE method, UTF-8 filenames) in pure V8 JS.
 * @param {Array<{ path: string, content: string | Uint8Array }>} entries
 * @returns {Uint8Array}
 */
export function createZipBytes(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const item of entries) {
    const cleanPath = String(item.path ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanPath) continue;

    const nameBytes = utf8ToBytes(cleanPath);
    const dataBytes =
      item.content instanceof Uint8Array ? item.content : utf8ToBytes(String(item.content ?? ''));
    const checksum = crc32(dataBytes);
    const size = dataBytes.byteLength;

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const ldv = new DataView(localHeader.buffer);
    ldv.setUint32(0, 0x04034b50, true); // Local file header signature
    ldv.setUint16(4, 20, true); // Version needed to extract (2.0)
    ldv.setUint16(6, 0x0800, true); // General purpose bit flag (bit 11 = UTF-8)
    ldv.setUint16(8, 0, true); // Compression method: 0 (STORE)
    ldv.setUint16(10, dosTime, true);
    ldv.setUint16(12, dosDate, true);
    ldv.setUint32(14, checksum, true);
    ldv.setUint32(18, size, true); // Compressed size
    ldv.setUint32(22, size, true); // Uncompressed size
    ldv.setUint16(26, nameBytes.byteLength, true);
    ldv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const cdv = new DataView(centralHeader.buffer);
    cdv.setUint32(0, 0x02014b50, true); // Central directory signature
    cdv.setUint16(4, 20, true); // Version made by
    cdv.setUint16(6, 20, true); // Version needed
    cdv.setUint16(8, 0x0800, true); // UTF-8 flag
    cdv.setUint16(10, 0, true); // Compression: STORE
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, checksum, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.byteLength, true);
    cdv.setUint16(30, 0, true); // Extra length
    cdv.setUint16(32, 0, true); // Comment length
    cdv.setUint16(34, 0, true); // Disk number
    cdv.setUint16(36, 0, true); // Internal attrs
    cdv.setUint32(38, 0, true); // External attrs
    cdv.setUint32(42, localOffset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    localOffset += localHeader.byteLength + size;
  }

  const centralDirBytes = concatUint8Arrays(centralParts);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); // EOCD signature
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, centralParts.length, true);
  edv.setUint16(10, centralParts.length, true);
  edv.setUint32(12, centralDirBytes.byteLength, true);
  edv.setUint32(16, localOffset, true);
  edv.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, centralDirBytes, eocd]);
}

async function inflateRawBytes(compressedBytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('فشرده‌سازی DEFLATE در این محیط پشتیبانی نمی‌شود؛ از ZIP استاندارد استفاده کنید.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks = [];

  // Read and write concurrently to avoid TransformStream highWaterMark deadlock on large files
  const readTask = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();

  const writeTask = (async () => {
    await writer.write(compressedBytes);
    await writer.close();
  })();

  await Promise.all([writeTask, readTask]);
  return concatUint8Arrays(chunks);
}

/**
 * Safely extracts text/code files from a ZIP Uint8Array (supports STORE & DEFLATE).
 * @param {Uint8Array} zipBytes
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function extractZipBytes(zipBytes) {
  const u8 = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Locate End of Central Directory (search backwards up to 65KB)
  let eocdOffset = -1;
  const minPos = Math.max(0, u8.byteLength - 65557);
  for (let i = u8.byteLength - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('فایل ارسالی یک آرشیو ZIP معتبر نیست.');
  }

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  let cdOffset = dv.getUint32(eocdOffset + 16, true);
  const extracted = [];

  for (let i = 0; i < totalEntries && cdOffset + 46 <= u8.byteLength; i++) {
    if (dv.getUint32(cdOffset, true) !== 0x02014b50) break;

    const method = dv.getUint16(cdOffset + 10, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const uncompSize = dv.getUint32(cdOffset + 24, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localHeaderOffset = dv.getUint32(cdOffset + 42, true);

    if (cdOffset + 46 + nameLen > u8.byteLength) {
      throw new Error('ساختار فهرست مرکزی فایل ZIP ناقص یا آسیب‌دیده است.');
    }

    const rawName = bytesToUtf8(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    const normalizedName = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (
      !normalizedName ||
      normalizedName.endsWith('/') ||
      normalizedName.startsWith('__MACOSX/') ||
      normalizedName.includes('node_modules/') ||
      normalizedName.includes('.git/')
    ) {
      continue;
    }

    // Block Zip-Slip traversal
    const segments = normalizedName.split('/');
    if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) {
      throw new Error(`مسیر ناامن در فایل ZIP مسدود شد: ${rawName}`);
    }

    if (uncompSize > 1_500_000) continue; // skip >1.5MB large files

    if (localHeaderOffset + 30 > u8.byteLength) {
      throw new Error(`هدر فایل داخلی ZIP نامعتبر است: ${normalizedName}`);
    }

    const lNameLen = dv.getUint16(localHeaderOffset + 26, true);
    const lExtraLen = dv.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > u8.byteLength) {
      throw new Error(`داده‌های فایل داخلی ZIP ناقص است: ${normalizedName}`);
    }
    const rawSlice = u8.subarray(dataStart, dataStart + compSize);

    let fileBytes;
    if (method === 0) {
      fileBytes = rawSlice;
    } else if (method === 8) {
      fileBytes = await inflateRawBytes(rawSlice);
    } else {
      continue;
    }

    // Skip binary files containing null bytes
    let isBinary = false;
    for (let b = 0; b < Math.min(fileBytes.length, 4096); b++) {
      if (fileBytes[b] === 0) {
        isBinary = true;
        break;
      }
    }
    if (isBinary) continue;

    extracted.push({
      path: normalizedName,
      content: bytesToUtf8(fileBytes),
    });
  }

  return extracted;
}
