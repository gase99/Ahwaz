import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractHttpStatus,
  isRateLimitError,
  resolveProviderStatus,
} from '../miniapp/src/components/ProviderCatalog.js';
import { parseProviderError } from '../miniapp/src/components/error-presenter.js';

const read = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('Mini App API/Model screen redesign', () => {
  it('maps provider snapshots to badge states (green / amber / red / grey)', () => {
    expect(resolveProviderStatus({ status: 'connected', isReady: true }).kind).toBe('connected');
    expect(
      resolveProviderStatus({
        status: 'invalid',
        lastError: 'سقف لحظه‌ای درخواست‌ها پر شده است (HTTP 429 — Rate Limit).',
      }).kind,
    ).toBe('limited');
    expect(
      resolveProviderStatus({ status: 'invalid', lastError: 'HTTP 401 Unauthorized' }).kind,
    ).toBe('error');
    expect(
      resolveProviderStatus({ status: 'disconnected', requiresKey: true, apiKeyConfigured: false })
        .kind,
    ).toBe('standby');

    expect(isRateLimitError('HTTP 429 — Rate Limit')).toBe(true);
    expect(isRateLimitError('HTTP 500')).toBe(false);
    expect(extractHttpStatus('HTTP 401 Unauthorized')).toBe(401);
    expect(extractHttpStatus('خطای شبکه')).toBeNull();
  });

  it('collapses raw provider error strings into a Persian title + short code', () => {
    const limited = parseProviderError(
      'سقف لحظه‌ای درخواست‌ها پر شده است (HTTP 429 — Rate Limit). کلید معتبر است اما چند ثانیه دیگر تلاش کنید.',
    );
    expect(limited).toMatchObject({ tone: 'warn', codeLabel: 'HTTP 429', shortFa: 'Rate Limit' });
    expect(limited.titleFa).toContain('محدودیت');

    const unauthorized = parseProviderError(
      'کلید API نامعتبر یا فاقد دسترسی است (HTTP 401). لطفاً کلید سرویس بررسی کنید.',
    );
    expect(unauthorized.codeLabel).toBe('HTTP 401');
    expect(unauthorized.tone).toBe('err');

    expect(parseProviderError(null)).toBeNull();
    expect(parseProviderError('', { success: true })).toBeNull();
  });

  it('keeps technical values in dedicated LTR monospace blocks and status in badges', () => {
    const panel = read('miniapp/src/components/ApiKeysPanel.js');

    // masked key / endpoint / latency are rendered as dir=ltr mono islands
    expect(panel).toContain('class="tech-value is-key ltr"');
    expect(panel).toContain('class="tech-value is-url ltr"');
    expect(panel).toContain('class="tech-value is-latency ltr"');
    expect(panel).toContain('dir="ltr"');

    // status is a badge, never a sentence
    expect(panel).toContain('badge badge-${status.tone}');
    expect(panel).not.toContain('lastError.slice(');

    // raw errors are collapsed behind "جزئیات فنی"
    expect(panel).toContain('raw-details');
    expect(panel).toContain('جزئیات فنی');

    // per-card actions: test, copy, download, delete
    for (const action of [
      'data-action="test-key"',
      'data-action="copy-key"',
      'data-action="download-config"',
      'data-action="download-guide"',
      'data-action="delete-key"',
    ]) {
      expect(panel).toContain(action);
    }
  });

  it('ships the deep dark glass theme and mobile-safe touch targets', () => {
    const css = read('miniapp/src/styles.css');

    expect(css).toContain('--bg: #0a0e17');
    expect(css).toContain('backdrop-filter: blur');
    expect(css).toContain('border-radius: var(--r-lg)');
    expect(css).toMatch(/\.ltr,[\s\S]*direction: ltr;/);
    expect(css).toMatch(/font-family: var\(--font-mono\)/);
    expect(css).toMatch(/\.btn \{[\s\S]*min-height: 42px/);
    expect(css).toContain('prefers-reduced-motion');
  });

  it('keeps the HTML shell in RTL while the search and model controls stay isolated', () => {
    const html = read('miniapp/src/index.html');
    expect(html).toContain('lang="fa" dir="rtl"');
    expect(html).toContain('id="providersGrid"');
    expect(html).toContain('id="activeModelCard"');
    expect(html).toContain('id="btnDownloadAllKeys"');
    expect(html).toContain('content="#0A0E17"');
  });
});
