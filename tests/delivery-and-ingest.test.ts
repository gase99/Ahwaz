import { describe, expect, it } from 'vitest';
import {
  chunkMarkdownSafely,
  markdownToTelegramHtml,
} from '../src/services/telegram/delivery.service.js';
import { buildTelegramFileDownloadUrl } from '../src/services/telegram/file-ingest.service.js';

describe('Telegram Delivery & Local Bot API File URL Helpers', () => {
  it('converts Markdown with code blocks and HTML chars into valid Telegram HTML', () => {
    const md = [
      '### گزارش بررسی کد',
      'متغیر `x < 10 && y > 2` بررسی شد و **نتیجه صحیح** است.',
      '```typescript',
      'const check = (a: number, b: number): boolean => a < b && b > 0;',
      '```',
      'مستندات: [سایت رسمی](https://telegram.org)',
    ].join('\n');

    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<b>گزارش بررسی کد</b>');
    expect(html).toContain('<code>x &lt; 10 &amp;&amp; y &gt; 2</code>');
    expect(html).toContain('<b>نتیجه صحیح</b>');
    expect(html).toContain(
      '<pre><code class="language-typescript">const check = (a: number, b: number): boolean =&gt; a &lt; b &amp;&amp; b &gt; 0;</code></pre>',
    );
    expect(html).toContain('<a href="https://telegram.org">سایت رسمی</a>');
  });

  it('chunks long Markdown while closing and reopening fenced code blocks cleanly', () => {
    const codeLines = Array.from({ length: 120 }, (_, i) => `console.log("line-${i}");`).join('\n');
    const longMd = `توضیح اولیه:\n\`\`\`js\n${codeLines}\n\`\`\`\nپایان.`;

    const chunks = chunkMarkdownSafely(longMd, 800);
    expect(chunks.length).toBeGreaterThan(2);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(820);
      const fences = chunk.match(/```/g) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it('builds proper download URLs for both Local Bot API Server (--local) and Cloud Bot API', () => {
    const token = '123456:ABCDEF';

    // Local Telegram Bot API Server (--local returns absolute disk path)
    const localUrl = buildTelegramFileDownloadUrl({
      filePath: `/var/lib/telegram-bot-api/${token}/documents/file_42.zip`,
      apiRoot: 'http://telegram-bot-api:8081/',
      botToken: token,
    });
    expect(localUrl).toBe(
      `http://telegram-bot-api:8081/file/bot${token}/documents/file_42.zip`,
    );

    // Cloud Telegram Bot API (returns relative path)
    const cloudUrl = buildTelegramFileDownloadUrl({
      filePath: 'documents/file_42.zip',
      apiRoot: 'https://api.telegram.org',
      botToken: token,
    });
    expect(cloudUrl).toBe(`https://api.telegram.org/file/bot${token}/documents/file_42.zip`);
  });
});
