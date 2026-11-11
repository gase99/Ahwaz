import {
  escapeHtml,
  formatRelativeTimeFa,
  getProviderLogo,
  renderConnectionBadgeHtml,
  resolveUiConnectionState,
  summarizeProviderCounts,
} from './ProviderCatalog.js';

/**
 * Renders and manages the "🔑 کلیدهای API" panel:
 * - Section 1.2: Overall summary banner
 * - Section 1.1: Per-provider key cards (masked key, password + eye toggle, test spinner, save, delete, direct signup link)
 * - Section 2.1: Smooth collapsible Accordion guide per provider
 * - Section 1.3: Reference links table at the bottom
 */
export class ApiKeysPanel {
  constructor({
    summaryContainer,
    cardsContainer,
    tableContainer,
    onSaveKey,
    onDeleteKey,
    onTestKey,
    onSyncModels,
  }) {
    this.summaryContainer = summaryContainer;
    this.cardsContainer = cardsContainer;
    this.tableContainer = tableContainer;
    this.onSaveKey = onSaveKey;
    this.onDeleteKey = onDeleteKey;
    this.onTestKey = onTestKey;
    this.onSyncModels = onSyncModels;

    this.expandedGuides = new Set();
    this.testingProviders = new Set();
    this.lastInlineResults = new Map(); // providerId -> { ok, message }

    this.bindEvents();
  }

  setInlineResult(providerId, result) {
    this.lastInlineResults.set(providerId, result);
  }

  render({ providers = [], providerHelp = [], linksTable = [], activeProvider = 'opencode' }) {
    this.lastRenderArgs = { providers, providerHelp, linksTable, activeProvider };
    const helpMap = new Map(providerHelp.map((h) => [h.id, h]));

    this.renderSummaryBanner(providers);
    this.renderProviderCards(providers, helpMap, activeProvider);
    this.renderReferenceTable(linksTable);
  }

  renderSummaryBanner(providers) {
    if (!this.summaryContainer) return;
    const stats = summarizeProviderCounts(providers);

    const activeNames = stats.connected.length
      ? stats.connected.map((p) => escapeHtml(p.shortBadge || p.title)).join('، ')
      : 'هیچ سرویسی فعال نیست';

    const invalidLine = stats.invalid.length
      ? `<div class="summary-line summary-warn">⚠️ <b>نیاز به بررسی:</b> ${stats.invalid
          .map((p) => {
            const err = p.lastError ? ` (${escapeHtml(p.lastError.slice(0, 48))})` : '';
            return `${escapeHtml(p.shortBadge || p.title)}${err}`;
          })
          .join('، ')}</div>`
      : '';

    const disconnectedLine = stats.disconnected.length
      ? `<div class="summary-line summary-muted">❌ <b>متصل نشده:</b> ${stats.disconnected
          .map((p) => escapeHtml(p.shortBadge || p.title))
          .join('، ')}</div>`
      : '<div class="summary-line summary-ok">🎉 تمام ۹ سرویس هوش مصنوعی متصل و آماده به کار هستند!</div>';

    this.summaryContainer.innerHTML = `
      <div class="keys-summary-banner">
        <div class="summary-title">🔌 کلیدها و سرویس‌های متصل: <b>${stats.connected.length} از ${stats.total}</b></div>
        <div class="summary-line summary-ok">✅ <b>فعال:</b> ${activeNames}</div>
        ${invalidLine}
        ${disconnectedLine}
      </div>
    `;
  }

  renderProviderCards(providers, helpMap, activeProvider) {
    if (!this.cardsContainer) return;
    this.cardsContainer.innerHTML = '';

    for (const spec of providers) {
      const help = helpMap.get(spec.id) || {};
      const isSelected = spec.id === activeProvider;
      const isTesting = this.testingProviders.has(spec.id);
      const isGuideOpen = this.expandedGuides.has(spec.id);
      const uiState = resolveUiConnectionState(spec);
      const inlineResult = this.lastInlineResults.get(spec.id);

      const card = document.createElement('div');
      card.className = `provider-card state-${uiState}${isSelected ? ' active' : ''}`;
      card.id = `key-card-${spec.id}`;
      card.dataset.providerCard = spec.id;
      card.innerHTML = this.buildCardInnerHtml(spec, help, {
        isSelected,
        isTesting,
        isGuideOpen,
        uiState,
        inlineResult,
      });
      this.cardsContainer.appendChild(card);
    }
  }

  buildCardInnerHtml(spec, help, { isSelected, isTesting, isGuideOpen, uiState, inlineResult }) {
    const logo = getProviderLogo(spec);
    const badgeHtml = renderConnectionBadgeHtml(spec);

    // Masked key or keyless empty-state notice
    let keyStateInfoHtml = '';
    if (spec.maskedKey) {
      keyStateInfoHtml = `
        <div class="masked-key-pill" dir="ltr" title="کلید فعلی ذخیره شده در دیتابیس SQLite">
          🔑 ${escapeHtml(spec.maskedKey)}
        </div>
      `;
    } else if (!spec.requiresKey && !spec.requiresBaseUrl) {
      keyStateInfoHtml = `
        <div class="empty-key-hint">
          🆓 این سرویس بدون کلید هم کار می‌کند${
            spec.acceptsOptionalKey ? '؛ برای سقف اختصاصی می‌توانید کلید رایگان ثبت کنید.' : '.'
          }
        </div>
      `;
    } else if (uiState === 'disconnected') {
      keyStateInfoHtml = `
        <div class="empty-key-hint warn">
          💡 هنوز کلیدی برای این سرویس ثبت نشده است. از دکمه دریافت کلید یا راهنمای زیر کمک بگیرید.
        </div>
      `;
    }

    // Last tested timestamp / error info
    const relTime = formatRelativeTimeFa(spec.lastTestedAt);
    let testMetaHtml = '';
    if (inlineResult) {
      testMetaHtml = `
        <div class="test-feedback ${inlineResult.ok ? 'ok' : 'err'}">
          ${inlineResult.ok ? '✅' : '❌'} ${escapeHtml(inlineResult.message)}
        </div>
      `;
    } else if (relTime) {
      const latencyTxt = spec.lastLatencyMs ? ` (${spec.lastLatencyMs}ms)` : '';
      if (uiState === 'invalid') {
        testMetaHtml = `<div class="test-feedback err">⚠️ آخرین تست: ${escapeHtml(relTime)} — ناموفق${
          spec.lastError ? `: ${escapeHtml(spec.lastError)}` : ''
        }</div>`;
      } else if (uiState === 'connected') {
        testMetaHtml = `<div class="test-feedback ok">✅ آخرین تست: ${escapeHtml(relTime)} — موفق${escapeHtml(latencyTxt)}</div>`;
      }
    }

    // Input fields
    const canAcceptKey = spec.requiresKey || spec.acceptsOptionalKey;
    const keyPlaceholder = spec.maskedKey
      ? `${spec.maskedKey} (برای تغییر کلید جدید وارد کنید)`
      : spec.requiresKey
        ? 'کلید API را اینجا Paste کنید...'
        : 'کلید API اختیاری (برای سقف اختصاصی)...';

    const apiKeyFieldHtml = canAcceptKey
      ? `
        <div class="provider-row key-input-wrapper">
          <input
            type="password"
            data-field="apiKey"
            dir="ltr"
            autocomplete="off"
            placeholder="${escapeHtml(keyPlaceholder)}"
          />
          <button
            type="button"
            class="key-toggle"
            data-action="toggle-mask"
            title="نمایش / مخفی کردن کلید"
          >👁️</button>
        </div>
      `
      : '';

    const baseUrlFieldHtml = spec.requiresBaseUrl
      ? `
        <div class="provider-row">
          <input
            type="url"
            data-field="baseUrl"
            dir="ltr"
            value="${escapeHtml(spec.baseUrl || '')}"
            placeholder="آدرس سرور HTTPS (مثلاً https://router.example.com/v1)"
          />
        </div>
      `
      : '';

    const canDelete = Boolean(spec.apiKeyConfigured || (spec.requiresBaseUrl && spec.baseUrl));
    const canSyncLive = spec.id === 'opencode' || spec.id === 'openrouter';

    const signupLinkHtml = spec.signupUrl
      ? `<a class="direct-key-link" href="${escapeHtml(spec.signupUrl)}" target="_blank" rel="noopener">🔑 دریافت کلید رایگان ↗</a>`
      : `<span class="direct-key-muted">🆓 بدون نیاز به ثبت‌نام کلید</span>`;

    // Accordion content (Section 2.1)
    const stepsHtml = (help.steps || [])
      .map((s, idx) => `<li>${idx + 1}. ${escapeHtml(s)}</li>`)
      .join('');
    const freeModelsList =
      Array.isArray(help.freeModels) && help.freeModels.length
        ? help.freeModels
        : (spec.models || []).map((m) => m.id);
    const freeModelsHtml = freeModelsList
      .map((m) => `<li>· <code>${escapeHtml(m)}</code></li>`)
      .join('');
    const linksHtml = (help.links || [])
      .map(
        (l) =>
          `<li>· ${escapeHtml(l.label)}: <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(l.url)}</a></li>`,
      )
      .join('');

    return `
      <div class="provider-head">
        <div class="provider-info">
          <div class="provider-name">
            <span class="provider-logo">${escapeHtml(logo)}</span>
            <span>${escapeHtml(spec.title)}</span>
            ${isSelected ? '<span class="active-pill">سرویس فعال</span>' : ''}
          </div>
          <div class="provider-meta">${escapeHtml(spec.id)} · ${escapeHtml(spec.protocol)}</div>
        </div>
        ${badgeHtml}
      </div>

      ${keyStateInfoHtml}
      ${testMetaHtml}

      <div class="provider-fields">
        ${baseUrlFieldHtml}
        ${apiKeyFieldHtml}

        <div class="key-actions-row">
          <button
            type="button"
            class="btn-test"
            data-action="test-key"
            data-provider="${escapeHtml(spec.id)}"
            ${isTesting ? 'disabled' : ''}
          >
            ${
              isTesting
                ? '<span class="spinner"></span> در حال تست...'
                : '⚡ تست اتصال'
            }
          </button>

          <button
            type="button"
            class="btn-sm"
            data-action="save-key"
            data-provider="${escapeHtml(spec.id)}"
          >
            💾 ${isSelected ? 'ذخیره' : 'ذخیره و فعال‌سازی'}
          </button>

          ${
            canDelete
              ? `<button
                  type="button"
                  class="btn-danger-sm"
                  data-action="delete-key"
                  data-provider="${escapeHtml(spec.id)}"
                  title="حذف کلید ذخیره‌شده"
                >🗑️ حذف کلید</button>`
              : ''
          }

          ${
            canSyncLive
              ? `<button
                  type="button"
                  class="btn-ghost-sm"
                  data-action="sync-models"
                  data-provider="${escapeHtml(spec.id)}"
                  title="بروزرسانی لیست زنده مدل‌ها از سرور"
                >🔄 بروزرسانی مدل‌ها</button>`
              : ''
          }
        </div>
      </div>

      <div class="card-footer-bar">
        ${signupLinkHtml}
        <button
          type="button"
          class="accordion-toggle ${isGuideOpen ? 'open' : ''}"
          data-action="toggle-guide"
          data-provider="${escapeHtml(spec.id)}"
          aria-expanded="${isGuideOpen ? 'true' : 'false'}"
        >
          <span>📘 راهنمای اتصال و مدل‌ها</span>
          <span class="chevron">▾</span>
        </button>
      </div>

      <div class="guide-accordion ${isGuideOpen ? 'expanded' : ''}">
        <div class="guide-accordion-inner">
          <div class="guide-block-title">🔑 نحوه دریافت و اتصال کلید (${escapeHtml(spec.shortBadge)}):</div>
          <ol class="guide-ol">${stepsHtml}</ol>

          <div class="guide-block-title">📋 مدل‌های رایگان موجود:</div>
          <ul class="guide-ul" dir="ltr">${freeModelsHtml}</ul>

          ${
            linksHtml
              ? `<div class="guide-block-title">🔗 لینک‌های کاربردی:</div><ul class="guide-ul">${linksHtml}</ul>`
              : ''
          }

          ${
            help.note
              ? `<div class="guide-tip">💡 <b>نکته:</b> ${escapeHtml(help.note)}</div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  renderReferenceTable(linksTable = []) {
    if (!this.tableContainer) return;
    if (!linksTable.length) {
      this.tableContainer.innerHTML = '';
      return;
    }

    const rowsHtml = linksTable
      .map((row) => {
        const keyCell = row.signupUrl
          ? `<a href="${escapeHtml(row.signupUrl)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(row.signupLabel || 'دریافت کلید')}</a>`
          : `<span class="muted-cell">${escapeHtml(row.signupLabel || '-')}</span>`;

        const docsCell = row.docsUrl
          ? `<a href="${escapeHtml(row.docsUrl)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(row.docsLabel || 'مستندات')}</a>`
          : `<span class="muted-cell">${escapeHtml(row.docsLabel || '-')}</span>`;

        return `
          <tr>
            <td><b>${escapeHtml(row.name)}</b></td>
            <td>${keyCell}</td>
            <td>${docsCell}</td>
            <td class="center-cell">${escapeHtml(row.requiresCard)}</td>
            <td dir="ltr" class="models-cell">${escapeHtml(row.freeModels)}</td>
          </tr>
        `;
      })
      .join('');

    this.tableContainer.innerHTML = `
      <div class="ref-table-wrap">
        <div class="section-title">📊 جدول مرجع لینک‌ها و مدل‌های رایگان</div>
        <div class="table-scroll">
          <table class="ref-links-table">
            <thead>
              <tr>
                <th>سرویس</th>
                <th>دریافت کلید</th>
                <th>مستندات</th>
                <th>کارت بانکی</th>
                <th>مدل‌های رایگان</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  focusProviderCard(providerId, expandGuide = false) {
    if (expandGuide) {
      this.expandedGuides.add(providerId);
      if (this.lastRenderArgs) this.render(this.lastRenderArgs);
    }
    const card = document.getElementById(`key-card-${providerId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const keyInput = card.querySelector('[data-field="apiKey"]');
      if (keyInput) setTimeout(() => keyInput.focus(), 220);
    }
  }

  bindEvents() {
    if (!this.cardsContainer) return;

    this.cardsContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const card = btn.closest('[data-provider-card]');
      const providerId = btn.dataset.provider || card?.dataset.providerCard;

      if (action === 'toggle-mask' && card) {
        const input = card.querySelector('[data-field="apiKey"]');
        if (input) {
          const isPwd = input.type === 'password';
          input.type = isPwd ? 'text' : 'password';
          btn.textContent = isPwd ? '🙈' : '👁️';
        }
        return;
      }

      if (action === 'toggle-guide' && providerId) {
        if (this.expandedGuides.has(providerId)) {
          this.expandedGuides.delete(providerId);
        } else {
          this.expandedGuides.add(providerId);
        }
        const accordion = card?.querySelector('.guide-accordion');
        if (accordion) {
          const open = this.expandedGuides.has(providerId);
          accordion.classList.toggle('expanded', open);
          btn.classList.toggle('open', open);
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        return;
      }

      if (action === 'test-key' && providerId && this.onTestKey) {
        const apiKey = card?.querySelector('[data-field="apiKey"]')?.value.trim() || undefined;
        const baseUrl = card?.querySelector('[data-field="baseUrl"]')?.value.trim() || undefined;
        this.testingProviders.add(providerId);
        if (this.lastRenderArgs) this.render(this.lastRenderArgs);
        try {
          await this.onTestKey({ providerId, apiKey, baseUrl });
        } finally {
          this.testingProviders.delete(providerId);
          if (this.lastRenderArgs) this.render(this.lastRenderArgs);
        }
        return;
      }

      if (action === 'save-key' && providerId && this.onSaveKey) {
        const apiKey = card?.querySelector('[data-field="apiKey"]')?.value.trim() || undefined;
        const baseUrl = card?.querySelector('[data-field="baseUrl"]')?.value.trim() || undefined;
        await this.onSaveKey({ providerId, apiKey, baseUrl });
        return;
      }

      if (action === 'delete-key' && providerId && this.onDeleteKey) {
        await this.onDeleteKey({ providerId });
        return;
      }

      if (action === 'sync-models' && providerId && this.onSyncModels) {
        await this.onSyncModels({ providerId });
      }
    });
  }
}
