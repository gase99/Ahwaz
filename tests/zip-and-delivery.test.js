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
  createZipBytes,
  extractZipBytes,
} from '../tgcloud/lib/services/zip-service.js';

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
