import { describe, expect, it, vi } from 'vitest';
import {
  ChatProviderCard,
  buildConfigPackage,
  formatPackageSize,
  packageSizeBytes,
  resolveChatStatusLine,
} from '../miniapp/src/components/ChatProviderCard.js';

const gemini = {
  id: 'gemini', title: 'Google Gemini', shortBadge: '✨ Google Gemini',
  status: 'invalid', requiresKey: true, maskedKey: 'AIza••••••••••1234',
  defaultModel: 'gemini-flash', lastError: 'HTTP 404 model not found',
  baseUrl: 'https://user:password@example.com/v1?key=secret#fragment',
};
const args = { providers: [gemini], activeProvider: 'gemini', activeModel: 'gemini-pro' };

function fakeContainer() {
  return {
    innerHTML: '',
    addEventListener(_event, handler) { this.click = (action) => handler({ target: { closest: () => ({ dataset: { chatAction: action } }) } }); },
  };
}

describe('chat provider card', () => {
  it('shows real provider state, masked key and HTTP error without injecting HTML', () => {
    const container = fakeContainer();
    const card = new ChatProviderCard({ container });
    card.render(args);
    expect(container.innerHTML).toContain('Google Gemini');
    expect(container.innerHTML).toContain('AIza••••••••••1234');
    expect(container.innerHTML).toContain('HTTP 404');
    expect(container.innerHTML).toContain('اندپوینت یا مدل یافت نشد');
    expect(container.innerHTML).toContain('🔴');
    expect(container.innerHTML).toContain('تست اتصال');
    expect(container.innerHTML).toContain(formatPackageSize(packageSizeBytes(card.package)));
    card.render({ ...args, providers: [{ ...gemini, title: '<img>', shortBadge: '<img>', maskedKey: '<script>' }] });
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('represents successful, untested, limited and incomplete states', () => {
    expect(resolveChatStatusLine({ status: 'connected', lastTestedAt: 100, lastLatencyMs: 42 }).line).toContain('42ms');
    expect(resolveChatStatusLine({ status: 'connected' }).line).toContain('تست نشده');
    expect(resolveChatStatusLine({ status: 'invalid', lastError: 'HTTP 429' }).dot).toBe('🟡');
    expect(resolveChatStatusLine({ status: 'disconnected', requiresBaseUrl: true }).line).toContain('آدرس');
  });

  it('exports a correctly sized JSON snapshot without raw credentials or raw errors', () => {
    const pkg = buildConfigPackage({ ...args, providers: [{ ...gemini, apiKey: 'private-key', lastError: 'HTTP 404 private-key' }] });
    const json = JSON.stringify(pkg, null, 2);
    expect(json).not.toContain('private-key');
    expect(json).not.toContain('password');
    expect(json).not.toContain('secret');
    expect(pkg.active.endpoint).toBe('https://example.com/v1');
    expect(pkg.active.model).toBe('gemini-pro');
    expect(packageSizeBytes(pkg)).toBe(new TextEncoder().encode(json).length);
    expect(formatPackageSize(1258291)).toBe('1.2MB');
  });

  it('tests and downloads the active provider, preserving the exact displayed package', async () => {
    const container = fakeContainer();
    let finish;
    const onTestConnection = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onDownloadPackage = vi.fn();
    const card = new ChatProviderCard({ container, onTestConnection, onDownloadPackage });
    card.render(args);
    const pending = container.click('test');
    expect(onTestConnection).toHaveBeenCalledWith('gemini');
    expect(container.innerHTML).toContain('در حال تست');
    finish();
    await pending;
    expect(container.innerHTML).not.toContain('در حال تست');
    const displayedPackage = card.package;
    await container.click('download');
    expect(onDownloadPackage).toHaveBeenCalledWith('gemini', displayedPackage);
  });
});
