import {
  escapeHtml,
  formatRelativeTimeFa,
  getProviderLogo,
  renderConnectionBadgeHtml,
  resolveUiConnectionState,
  summarizeProviderCounts,
} from './ProviderCatalog.js';

/**
 * Section 4: "🔌 وضعیت اتصال‌ها" compact dashboard + header `🔌 X/9` badge updater.
 */
export class ConnectionsDashboard {
  constructor({
    headerBadgeBtn,
    summaryEl,
    gridEl,
    onJumpToKeyCard,
    onRetestProvider,
    onDisconnectProvider,
    onChangeProviderModel,
  }) {
    this.headerBadgeBtn = headerBadgeBtn;
    this.summaryEl = summaryEl;
    this.gridEl = gridEl;
    this.onJumpToKeyCard = onJumpToKeyCard;
    this.onRetestProvider = onRetestProvider;
    this.onDisconnectProvider = onDisconnectProvider;
    this.onChangeProviderModel = onChangeProviderModel;

    this.testingSet = new Set();
    this.bindEvents();
  }

  render({ providers = [], activeProvider = 'opencode', activeModel = 'big-pickle' }) {
    this.lastArgs = { providers, activeProvider, activeModel };
    const stats = summarizeProviderCounts(providers);

    if (this.headerBadgeBtn) {
      this.headerBadgeBtn.textContent = `🔌 ${stats.connected.length}/${stats.total}`;
      this.headerBadgeBtn.title = `وضعیت اتصال‌ها: ${stats.connected.length} از ${stats.total} فعال`;
    }

    if (this.summaryEl) {
      this.summaryEl.innerHTML = `
        <div class="conn-overview-strip">
          <span class="pill-stat ok">✅ متصل: ${stats.connected.length}</span>
          <span class="pill-stat warn">⚠️ نیازمند بررسی: ${stats.invalid.length}</span>
          <span class="pill-stat err">❌ متصل نشده: ${stats.disconnected.length}</span>
        </div>
      `;
    }

    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';

    // Sort: active provider first, then connected, invalid, disconnected
    const rank = (p) => {
      if (p.id === activeProvider) return 0;
      const st = resolveUiConnectionState(p);
      if (st === 'connected') return 1;
      if (st === 'invalid') return 2;
      return 3;
    };

    const sorted = [...providers].sort((a, b) => rank(a) - rank(b));

    for (const spec of sorted) {
      const uiState = resolveUiConnectionState(spec);
      const isActive = spec.id === activeProvider;
      const isTesting = this.testingSet.has(spec.id);
      const dot = uiState === 'connected' ? '🟢' : uiState === 'invalid' ? '🟠' : '⚪';
      const logo = getProviderLogo(spec);
      const currentModel = isActive ? activeModel : spec.defaultModel;
      const relTime = formatRelativeTimeFa(spec.lastTestedAt);

      const card = document.createElement('div');
      card.className = `compact-conn-card state-${uiState}${isActive ? ' active' : ''}`;

      if (uiState === 'connected' || uiState === 'invalid') {
        const canDisconnect = Boolean(
          spec.apiKeyConfigured || (spec.requiresBaseUrl && spec.baseUrl),
        );
        const testLine = relTime
          ? uiState === 'invalid'
            ? `آخرین تست: ${escapeHtml(relTime)} — ناموفق${
                spec.lastError ? ` (${escapeHtml(spec.lastError.slice(0, 60))})` : ''
              }`
            : `آخرین تست: ${escapeHtml(relTime)} — موفق${
                spec.lastLatencyMs ? ` (${spec.lastLatencyMs}ms)` : ''
              }`
          : spec.apiKeyConfigured
            ? `کلید ثبت‌شده: ${escapeHtml(spec.maskedKey || '***')} (تست‌نشده)`
            : 'آماده به کار بدون نیاز به کلید';

        card.innerHTML = `
          <div class="compact-head">
            <div class="compact-title">
              <span>${dot} ${escapeHtml(logo)}</span>
              <b>${escapeHtml(spec.shortBadge || spec.title)}</b>
              ${isActive ? '<span class="active-pill">فعال</span>' : ''}
            </div>
            ${renderConnectionBadgeHtml(spec)}
          </div>

          <div class="compact-meta">
            <div>مدل ${isActive ? 'فعال' : 'پیش‌فرض'}: <code dir="ltr">${escapeHtml(currentModel)}</code></div>
            <div class="compact-sub ${uiState === 'invalid' ? 'err' : ''}">${testLine}</div>
          </div>

          <div class="compact-actions">
            <button
              type="button"
              class="btn-secondary-xs"
              data-conn-action="change-model"
              data-provider="${escapeHtml(spec.id)}"
            >🧠 تغییر مدل</button>

            <button
              type="button"
              class="btn-secondary-xs"
              data-conn-action="retest"
              data-provider="${escapeHtml(spec.id)}"
              ${isTesting ? 'disabled' : ''}
            >${isTesting ? '<span class="spinner"></span> تست...' : '⚡ تست مجدد'}</button>

            ${
              canDisconnect
                ? `<button
                    type="button"
                    class="btn-danger-xs"
                    data-conn-action="disconnect"
                    data-provider="${escapeHtml(spec.id)}"
                  >🗑️ قطع اتصال</button>`
                : `<button
                    type="button"
                    class="btn-ghost-xs"
                    data-conn-action="add-key"
                    data-provider="${escapeHtml(spec.id)}"
                  >🔑 کلید اختیاری</button>`
            }
          </div>
        `;
      } else {
        // Empty / disconnected state
        card.innerHTML = `
          <div class="compact-head">
            <div class="compact-title">
              <span>${dot} ${escapeHtml(logo)}</span>
              <b>${escapeHtml(spec.shortBadge || spec.title)}</b>
            </div>
            ${renderConnectionBadgeHtml(spec)}
          </div>
          <div class="compact-empty-msg">
            کلید این سرویس هنوز متصل نشده است. با ثبت کلید رایگان به مدل‌های ${escapeHtml(spec.shortBadge || spec.id)} دسترسی خواهید داشت.
          </div>
          <div class="compact-actions">
            <button
              type="button"
              class="btn-accent-xs"
              data-conn-action="add-key"
              data-provider="${escapeHtml(spec.id)}"
            >➕ افزودن کلید</button>
            ${
              spec.signupUrl
                ? `<a class="btn-link-xs" href="${escapeHtml(spec.signupUrl)}" target="_blank" rel="noopener">دریافت کلید ↗</a>`
                : ''
            }
          </div>
        `;
      }

      this.gridEl.appendChild(card);
    }
  }

  bindEvents() {
    this.gridEl?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-conn-action]');
      if (!btn) return;
      const action = btn.dataset.connAction;
      const providerId = btn.dataset.provider;
      if (!providerId) return;

      if (action === 'add-key' && this.onJumpToKeyCard) {
        this.onJumpToKeyCard(providerId);
        return;
      }

      if (action === 'change-model' && this.onChangeProviderModel) {
        await this.onChangeProviderModel(providerId);
        return;
      }

      if (action === 'retest' && this.onRetestProvider) {
        this.testingSet.add(providerId);
        if (this.lastArgs) this.render(this.lastArgs);
        try {
          await this.onRetestProvider(providerId);
        } finally {
          this.testingSet.delete(providerId);
          if (this.lastArgs) this.render(this.lastArgs);
        }
        return;
      }

      if (action === 'disconnect' && this.onDisconnectProvider) {
        await this.onDisconnectProvider(providerId);
      }
    });
  }
}
