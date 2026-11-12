import { escapeHtml, resolveProviderStatus } from './ProviderCatalog.js';
import { parseProviderError } from './error-presenter.js';
import { icon } from './icons.js';

/**
 * Chat header card for the agent (chat) tab — mirrors the requested mock:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ 🟢 Google Gemini            [ تست اتصال ]  │
 *   │ ────────────────────────────────────────── │
 *   │ 🔑 کلید: sk-ant-api03...***************    │
 *   │ ⚠️ وضعیت: خطای سرور (HTTP 404 - مدل یافت نشد)│
 *   │ ────────────────────────────────────────── │
 *   │ 📥 فایل‌های کانفیگ: [ ⬇️ دانلود پکیج (…) ]  │
 *   └────────────────────────────────────────────┘
 *
 * Persian labels stay RTL; the masked key / model id are LTR mono islands.
 * Pure helpers (size / package builder) are exported so tests can verify them
 * without a DOM.
 */

/** Formats a byte count the way the mock shows it: `1.2MB`, `12.4KB`, `512B`. */
export function formatPackageSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0B';
  if (n < 1024) return `${Math.round(n)}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** Byte size of the JSON package (Blob when available, else UTF-8 length). */
export function packageSizeBytes(payload) {
  const json = JSON.stringify(payload, null, 2);
  try {
    if (typeof Blob !== 'undefined') return new Blob([json]).size;
  } catch {
    /* fall through */
  }
  try {
    return new TextEncoder().encode(json).length;
  } catch {
    return json.length;
  }
}

// Strip URL credentials, query strings and fragments from exported endpoints.
function safeEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * One-click config package: active provider + full provider status snapshot.
 * API keys are never included — only masked values, endpoints and models.
 */
export function buildConfigPackage({ providers = [], activeProvider = 'opencode', activeModel = '' } = {}) {
  const active = providers.find((p) => p.id === activeProvider) || null;
  const toEntry = (spec) => ({
    id: spec.id,
    title: spec.title,
    shortBadge: spec.shortBadge || spec.title,
    protocol: spec.protocol,
    endpoint: safeEndpoint(spec.baseUrl || spec.defaultBaseUrl),
    defaultModel: spec.defaultModel || null,
    model: spec.id === activeProvider ? activeModel || spec.defaultModel || null : spec.defaultModel || null,
    requiresKey: Boolean(spec.requiresKey),
    requiresBaseUrl: Boolean(spec.requiresBaseUrl),
    apiKeyConfigured: Boolean(spec.apiKeyConfigured),
    maskedKey: spec.maskedKey || null,
    status: resolveProviderStatus(spec).kind,
    lastLatencyMs: spec.lastLatencyMs ?? null,
    lastTestedAt: spec.lastTestedAt ?? null,
    lastError: spec.lastError ? { code: parseProviderError(spec.lastError)?.codeLabel, message: parseProviderError(spec.lastError)?.titleFa } : null,
    signupUrl: spec.signupUrl || null,
    docsUrl: spec.docsUrl || null,
  });

  return {
    app: 'Ahwaz Code Studio',
    generatedAt: new Date().toISOString(),
    activeProvider,
    activeModel: activeModel || active?.defaultModel || null,
    active: active ? toEntry(active) : null,
    providers: providers.map(toEntry),
    note: 'کلیدهای واقعی هرگز در این فایل قرار نمی‌گیرند؛ فقط مقادیر ماسک‌شده و وضعیت اتصال.',
  };
}

/** Status dot + line for the card, derived from the shared status model. */
export function resolveChatStatusLine(spec) {
  const status = resolveProviderStatus(spec);
  const latency = spec?.lastLatencyMs ? `${Math.round(spec.lastLatencyMs)}ms` : null;

  if (status.kind === 'connected') {
    return {
      dot: '🟢',
      tone: 'ok',
      line: spec?.lastTestedAt ? `متصل و آماده${latency ? ` (${latency})` : ''}` : 'تنظیم شده — هنوز تست نشده',
      prefix: '✅',
    };
  }
  if (status.kind === 'limited' || status.kind === 'error') {
    const parsed = parseProviderError(spec?.lastError);
    if (parsed) {
      return {
        dot: status.kind === 'limited' ? '🟡' : '🔴',
        tone: status.kind === 'limited' ? 'warn' : 'err',
        line: `${parsed.titleFa} (${parsed.codeLabel})`,
        prefix: status.kind === 'limited' ? '⏳' : '⚠️',
      };
    }
    return {
      dot: '🔴',
      tone: 'err',
      line: 'خطا در اتصال',
      prefix: '⚠️',
    };
  }
  return {
    dot: '⚪',
    tone: 'muted',
    line: spec?.requiresBaseUrl && !spec?.baseUrl ? 'آدرس سرور تنظیم نشده' : spec?.requiresKey ? 'بدون کلید — نیازمند تنظیم' : 'در آماده‌به‌کار',
    prefix: '⚪',
  };
}

export class ChatProviderCard {
  constructor({ container, onTestConnection, onDownloadPackage, onConfigure, onCopyKey }) {
    this.container = container;
    this.onTestConnection = onTestConnection;
    this.onDownloadPackage = onDownloadPackage;
    this.onConfigure = onConfigure;
    this.onCopyKey = onCopyKey;
    this.testing = false;
    this.lastArgs = null;
    this.bindEvents();
  }

  render({ providers = [], activeProvider = 'opencode', activeModel = 'big-pickle' } = {}) {
    if (!this.container) return;
    this.lastArgs = { providers, activeProvider, activeModel };
    const spec = providers.find((p) => p.id === activeProvider);

    if (!spec) {
      this.container.innerHTML = '';
      return;
    }

    const status = resolveProviderStatus(spec);
    const statusLine = resolveChatStatusLine(spec);
    this.package = buildConfigPackage({ providers, activeProvider, activeModel });
    const sizeLabel = formatPackageSize(packageSizeBytes(this.package));
    const isTesting = this.testing;

    const keyHtml = spec.maskedKey
      ? `<code class="chat-key-value ltr" title="کلید ذخیره‌شده (ماسک‌شده)">${escapeHtml(spec.maskedKey)}</code>
         <button type="button" class="mini-icon-btn" data-chat-action="copy-key" title="کپی کلید ماسک‌شده" aria-label="کپی کلید ماسک‌شده">${icon('copy', 13)}</button>`
      : spec.requiresKey
        ? '<span class="chat-key-empty">ثبت نشده</span>'
        : '<span class="chat-key-empty">بدون کلید (رایگان)</span>';

    this.container.innerHTML = `
      <div class="chat-provider-card state-${status.kind}" data-chat-provider="${escapeHtml(spec.id)}">
        <div class="chat-card-head">
          <div class="chat-card-title">
            <span class="chat-status-dot" aria-hidden="true">${statusLine.dot}</span>
            <span class="chat-card-names">
              <span class="chat-card-name">${escapeHtml(String(spec.shortBadge || spec.title).replace(/^[^\w\u0600-\u06FF]+\s*/, ''))}</span>
              <span class="chat-card-model mono ltr">${escapeHtml(activeModel || spec.defaultModel || '')}</span>
            </span>
          </div>
          <div class="chat-card-head-actions">
            <button type="button" class="btn btn-xs btn-secondary" data-chat-action="test" title="تست اتصال با مدل پیش‌فرض سرویس" ${isTesting ? 'disabled' : ''}>
              ${isTesting ? '<span class="spinner"></span> در حال تست…' : `${icon('bolt', 13)} تست اتصال`}
            </button>
            <button type="button" class="mini-icon-btn" data-chat-action="configure" title="تنظیم کلید این سرویس" aria-label="تنظیم کلید این سرویس">${icon('pencil', 13)}</button>
          </div>
        </div>

        <div class="chat-card-divider" aria-hidden="true"></div>

        <div class="chat-card-row">
          <span class="chat-card-row-label">🔑 کلید:</span>
          <span class="chat-card-row-value">${keyHtml}</span>
        </div>
        <div class="chat-card-row">
          <span class="chat-card-row-label">${statusLine.prefix} وضعیت:</span>
          <span class="chat-card-row-value chat-status-text tone-${statusLine.tone}">${escapeHtml(statusLine.line)}</span>
        </div>

        <div class="chat-card-test-note">تست اتصال با مدل پیش‌فرض سرویس انجام می‌شود.</div>
        <div class="chat-card-divider" aria-hidden="true"></div>

        <div class="chat-card-download-row">
          <span class="chat-card-row-label">📥 فایل‌های کانفیگ:</span>
          <button type="button" class="btn btn-sm btn-download chat-download-btn" data-chat-action="download">
            ⬇️ دانلود تنظیمات JSON (${escapeHtml(sizeLabel)}) با یک کلیک
          </button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.container?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-chat-action]');
      if (!btn || !this.lastArgs) return;
      const action = btn.dataset.chatAction;
      const { activeProvider } = this.lastArgs;

      if (action === 'test' && this.onTestConnection) {
        if (this.testing) return;
        this.testing = true;
        this.render(this.lastArgs);
        try {
          await this.onTestConnection(activeProvider);
        } finally {
          this.testing = false;
          if (this.lastArgs) this.render(this.lastArgs);
        }
        return;
      }

      if (action === 'download' && this.onDownloadPackage) {
        await this.onDownloadPackage(activeProvider, this.package);
        return;
      }

      if (action === 'configure' && this.onConfigure) {
        this.onConfigure(activeProvider);
        return;
      }

      if (action === 'copy-key' && this.onCopyKey) {
        this.onCopyKey(activeProvider);
      }
    });
  }
}
