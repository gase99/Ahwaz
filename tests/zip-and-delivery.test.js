import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
} from '../tgcloud/lib/services/binary-utils.js';
import {
  chunkMarkdownSafely,
  markdownToTelegramHtml,
} from '../tgcloud/lib/services/delivery-service.js';
import {
  crc32,
  createZipBytes,
  extractZipBytes,
} from '../tgcloud/lib/services/zip-service.js';

async function deflateRawBytes(rawBytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks = [];
  const readTask = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  const writeTask = (async () => {
    await writer.write(rawBytes);
    await writer.close();
  })();
  await Promise.all([writeTask, readTask]);
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function buildSingleDeflateZip(filePath, rawBytes, compBytes) {
  const nameBytes = utf8ToBytes(filePath);
  const checksum = crc32(rawBytes);

  const local = new Uint8Array(30 + nameBytes.byteLength);
  const ldv = new DataView(local.buffer);
  ldv.setUint32(0, 0x04034b50, true);
  ldv.setUint16(4, 20, true);
  ldv.setUint16(6, 0x0800, true);
  ldv.setUint16(8, 8, true); // DEFLATE
  ldv.setUint32(14, checksum, true);
  ldv.setUint32(18, compBytes.byteLength, true);
  ldv.setUint32(22, rawBytes.byteLength, true);
  ldv.setUint16(26, nameBytes.byteLength, true);
  local.set(nameBytes, 30);

  const centralOffset = local.byteLength + compBytes.byteLength;
  const central = new Uint8Array(46 + nameBytes.byteLength);
  const cdv = new DataView(central.buffer);
  cdv.setUint32(0, 0x02014b50, true);
  cdv.setUint16(4, 20, true);
  cdv.setUint16(6, 20, true);
  cdv.setUint16(8, 0x0800, true);
  cdv.setUint16(10, 8, true); // DEFLATE
  cdv.setUint32(16, checksum, true);
  cdv.setUint32(20, compBytes.byteLength, true);
  cdv.setUint32(24, rawBytes.byteLength, true);
  cdv.setUint16(28, nameBytes.byteLength, true);
  cdv.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, 1, true);
  edv.setUint16(10, 1, true);
  edv.setUint32(12, central.byteLength, true);
  edv.setUint32(16, centralOffset, true);

  const out = new Uint8Array(
    local.byteLength + compBytes.byteLength + central.byteLength + eocd.byteLength,
  );
  let pos = 0;
  for (const part of [local, compBytes, central, eocd]) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  return out;
}

describe('Pure-V8 Binary, ZIP, and Telegram HTML Delivery Services', () => {
  it('round-trips UTF-8 and Base64 accurately without Node Buffer', () => {
    const sample = 'سلام اهواز — Hello Telegram Serverless 🚀';
    const bytes = utf8ToBytes(sample);
    const b64 = bytesToBase64(bytes);
    const decoded = bytesToUtf8(base64ToBytes(b64));
    expect(decoded).toBe(sample);
  });

  it('creates valid PKZIP archives in pure JS and extracts nested files safely', async () => {
    const zipBytes = createZipBytes([
      { path: 'src/index.js', content: 'export const ok = true;\n' },
      { path: 'README.md', content: '# پروژه تستی اهواز\n' },
    ]);

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.byteLength).toBeGreaterThan(80);

    const extracted = await extractZipBytes(zipBytes);
    expect(extracted).toEqual([
      { path: 'src/index.js', content: 'export const ok = true;\n' },
      { path: 'README.md', content: '# پروژه تستی اهواز\n' },
    ]);
  });

  it('blocks malicious Zip-Slip entries during extraction', async () => {
    const evilBytes = createZipBytes([{ path: '../evil.js', content: 'bad()' }]);
    await expect(extractZipBytes(evilBytes)).rejects.toThrow();
  });

  it('extracts large (>120 KB) DEFLATE-compressed ZIP entries without stream backpressure deadlock', async () => {
    const largeSource = Array.from(
      { length: 3000 },
      (_, i) => `export const line_${i} = "Ahwaz Serverless Line #${i}";`,
    ).join('\n');
    const rawBytes = utf8ToBytes(largeSource);
    expect(rawBytes.byteLength).toBeGreaterThan(120_000);

    const compBytes = await deflateRawBytes(rawBytes);
    const zipBytes = buildSingleDeflateZip('src/large.js', rawBytes, compBytes);

    const extracted = await extractZipBytes(zipBytes);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].path).toBe('src/large.js');
    expect(extracted[0].content).toBe(largeSource);
  });

  it('rejects corrupted ZIP archives with out-of-bounds offsets cleanly', async () => {
    const valid = createZipBytes([{ path: 'a.js', content: 'const a = 1;' }]);
    const corrupted = valid.slice();
    // Corrupt localHeaderOffset in Central Directory to point past EOF
    const eocdOffset = corrupted.byteLength - 22;
    const dv = new DataView(corrupted.buffer);
    const cdOffset = dv.getUint32(eocdOffset + 16, true);
    dv.setUint32(cdOffset + 42, 999_999, true);

    await expect(extractZipBytes(corrupted)).rejects.toThrow(/نامعتبر/);
  });

  it('formats Markdown into Telegram HTML and splits long code blocks cleanly', () => {
    const md = '### خروجی کد\nمقدار `a < b && c > 0` **تایید شد**:\n```js\nif (x < 1) console.log("ok");\n```';
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<b>خروجی کد</b>');
    expect(html).toContain('<code>a &lt; b &amp;&amp; c &gt; 0</code>');
    expect(html).toContain(
      '<pre><code class="language-js">if (x &lt; 1) console.log("ok");</code></pre>',
    );

    const manyLines = Array.from({ length: 100 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const chunks = chunkMarkdownSafely(`\`\`\`js\n${manyLines}\n\`\`\``, 600);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });
});
