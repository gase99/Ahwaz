import { escapeHtml, getProviderLogo, resolveProviderStatus } from './ProviderCatalog.js';
import { icon } from './icons.js';

/**
 * Hero card for the currently active provider/model pair.
 * Reads as a normal RTL card, but model id, endpoint and latency are LTR mono islands.
 */
export class ActiveModelCard {
  constructor({ container, onConfigure, onCopyModel, onOpenSelector }) {
    this.container = container;
    this.onConfigure = onConfigure;
    this.onCopyModel = onCopyModel;
    this.onOpenSelector = onOpenSelector;
    this.bindEvents();
  }

  render({ providers = [], activeProvider = 'opencode', activeModel = 'big-pickle' }) {
    if (!this.container) return;
    this.state = { providers, activeProvider, activeModel };
    const spec = providers.find((p) => p.id === activeProvider);

    if (!spec) {
      this.container.innerHTML = '';
      return;
    }

    const status = resolveProviderStatus(spec);
    const endpoint = spec.baseUrl || spec.defaultBaseUrl || '—';
    const latency = spec.lastLatencyMs ? `${Math.round(spec.lastLatencyMs)}ms` : '—';

    this.container.innerHTML = `
      <div class="provider-card is-active" data-hero="active-model">
        <div class="card-head">
          <div class="card-identity">
            <span class="card-logo" aria-hidden="true">${escapeHtml(getProviderLogo(spec))}</span>
            <div class="card-titles">
              <div class="card-title">مدل فعال کدنویسی</div>
              <div class="card-subtitle">
                <span class="mono ltr">${escapeHtml(activeModel)}</span>
                <span class="sep">·</span>
                <span>${escapeHtml(spec.shortBadge || spec.title)}</span>
              </div>
            </div>
          </div>
          <span class="badge badge-${status.tone}"><span class="dot dot-${status.tone}"></span>${escapeHtml(
            status.label,
          )}</span>
        </div>

        <div class="tech-list">
          <div class="tech-row">
            <span class="tech-label">MODEL</span>
            <span class="tech-value ltr is-key">${escapeHtml(activeModel)}</span>
            <button type="button" class="mini-icon-btn" data-hero-action="copy-model" title="کپی نام مدل" aria-label="کپی نام مدل">${icon(
              'copy',
              14,
            )}</button>
          </div>
          <div class="tech-row">
            <span class="tech-label">ENDPOINT</span>
            <span class="tech-value ltr is-url">${escapeHtml(endpoint)}</span>
          </div>
          <div class="tech-row">
            <span class="tech-label">LATENCY</span>
            <span class="tech-value ltr is-latency">${escapeHtml(latency)}</span>
            <span class="tech-side fa">${spec.lastTestedAt ? 'آخرین پاسخ سرویس' : 'تست‌نشده'}</span>
          </div>
        </div>

        <div class="card-actions">
          <button type="button" class="btn btn-sm btn-primary" data-hero-action="configure">
            ${icon('pencil', 15)} تنظیم این سرویس
          </button>
          <button type="button" class="btn btn-sm btn-secondary" data-hero-action="open-selector">
            ${icon('spark', 15)} تغییر مدل
          </button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.container?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hero-action]');
      if (!btn) return;
      const action = btn.dataset.heroAction;
      if (action === 'configure') this.onConfigure?.(this.state?.activeProvider);
      if (action === 'copy-model') this.onCopyModel?.(this.state?.activeModel);
      if (action === 'open-selector') this.onOpenSelector?.();
    });
  }
}
