import {
  escapeHtml,
  formatRelativeTimeFa,
  getProviderLogo,
  resolveProviderStatus,
  summarizeProviderStatuses,
} from './ProviderCatalog.js';
import { parseProviderError, shortenText } from './error-presenter.js';
import { icon } from './icons.js';

/**
 * Section 4: "🔌 وضعیت اتصال‌ها" dashboard.
 * Compact glass cards + header `X/N` counter, driven by the same status model
 * as the API/Model management screen so both views never disagree.
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
    const stats = summarizeProviderStatuses(providers);

    if (this.headerBadgeBtn) {
      this.headerBadgeBtn.textContent = `${stats.connected.length}/${stats.total || 9}`;
      this.headerBadgeBtn.title = `وضعیت اتصال‌ها: ${stats.connected.length} از ${
        stats.total || 9
      } سرویس متصل`;
    }

    if (this.summaryEl) {
      this.summaryEl.innerHTML = `
        <div class="conn-overview-strip">
          <span class="pill-stat ok"><span class="dot"></span> متصل: ${stats.connected.length}</span>
          <span class="pill-stat warn"><span class="dot"></span> محدود/Standby: ${stats.limited.length}</span>
          <span class="pill-stat err"><span class="dot"></span> خطا: ${stats.error.length}</span>
          <span class="pill-stat"><span class="dot"></span> غیرفعال: ${stats.standby.length}</span>
        </div>
      `;
    }

    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';

    const rank = (spec) => {
      if (spec.id === activeProvider) return 0;
      const kind = resolveProviderStatus(spec).kind;
      return kind === 'connected' ? 1 : kind === 'limited' ? 2 : kind === 'error' ? 3 : 4;
    };
    const sorted = [...providers].sort((a, b) => rank(a) - rank(b));

    for (const spec of sorted) {
      const status = resolveProviderStatus(spec);
      const isActive = spec.id === activeProvider;
      const isTesting = this.testingSet.has(spec.id);
      const logo = getProviderLogo(spec);
      const currentModel = isActive ? activeModel : spec.defaultModel;
      const relTime = formatRelativeTimeFa(spec.lastTestedAt);
      const latency = spec.lastLatencyMs ? `${Math.round(spec.lastLatencyMs)}ms` : null;
      const parsed = parseProviderError(spec.lastError);

      const card = document.createElement('div');
      card.className = `compact-conn-card state-${
        status.tone === 'err' ? 'invalid' : status.kind
      }${isActive ? ' is-active' : ''}`;
      card.dataset.provider = spec.id;

      const canDisconnect = Boolean(
        spec.apiKeyConfigured || (spec.requiresBaseUrl && spec.baseUrl),
      );

      const metrics = [
        `<span class="metric-chip" title="مدل پیش‌فرض">${escapeHtml(currentModel || '—')}</span>`,
        latency ? `<span class="metric-chip ok">${escapeHtml(latency)}</span>` : '',
        parsed ? `<span class="metric-chip ${parsed.tone === 'warn' ? 'warn' : 'err'}">${escapeHtml(parsed.shortFa)}</span>` : '',
      ]
        .filter(Boolean)
        .join('');

      card.innerHTML = `
        <div class="compact-head">
          <div class="compact-title">
            <span class="card-logo" aria-hidden="true">${escapeHtml(logo)}</span>
            <span class="fa">${escapeHtml(spec.shortBadge || spec.title)}</span>
            ${isActive ? '<span class="badge badge-accent">فعال</span>' : ''}
          </div>
          <span class="badge badge-${status.tone}"><span class="dot dot-${status.tone}"></span>${escapeHtml(
            status.shortLabel,
          )}</span>
        </div>

        <div class="compact-meta">
          <div class="compact-metrics">${metrics}</div>
          <div class="compact-sub fa">
            ${
              relTime
                ? `آخرین تست ${escapeHtml(relTime)}${latency ? '' : ''}`
                : spec.apiKeyConfigured
                  ? `کلید ثبت‌شده: <code class="ltr">${escapeHtml(spec.maskedKey || '***')}</code>`
                  : 'آماده به کار · بدون کلید'
            }
          </div>
          ${
            parsed
              ? `<details class="raw-details">
                   <summary>${escapeHtml(parsed.titleFa)}</summary>
                   <div class="mono-block ltr">${escapeHtml(shortenText(spec.lastError, 320))}</div>
                 </details>`
              : ''
          }
        </div>

        <div class="compact-actions">
          <button type="button" class="btn btn-xs btn-secondary" data-conn-action="retest" data-provider="${escapeHtml(
            spec.id,
          )}" ${isTesting ? 'disabled' : ''}>
            ${isTesting ? '<span class="spinner"></span> تست…' : `${icon('bolt', 13)} تست مجدد`}
          </button>
          <button type="button" class="btn btn-xs btn-secondary" data-conn-action="change-model" data-provider="${escapeHtml(
            spec.id,
          )}">${icon('pencil', 13)} تغییر مدل</button>
          ${
            canDisconnect
              ? `<button type="button" class="btn btn-xs btn-danger" data-conn-action="disconnect" data-provider="${escapeHtml(
                  spec.id,
                )}">${icon('trash', 13)} قطع اتصال</button>`
              : `<button type="button" class="btn btn-xs btn-primary" data-conn-action="add-key" data-provider="${escapeHtml(
                  spec.id,
                )}">${icon('key', 13)} افزودن کلید</button>`
          }
        </div>
      `;

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
        this.render(this.lastArgs);
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
