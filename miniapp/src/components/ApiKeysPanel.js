import {
  escapeHtml,
  formatRelativeTimeFa,
  getProviderLogo,
  isRateLimitError,
  resolveProviderStatus,
  summarizeProviderStatuses,
} from './ProviderCatalog.js';
import { parseProviderError, shortenText } from './error-presenter.js';
import { downloadJson, downloadText, safeFileSlug } from './download.js';
import { icon } from './icons.js';

/**
 * Section 1: "API & Models" management screen.
 *
 * Layout contract
 * - One glassmorphic `.provider-card` per provider (module-level, fully isolated).
 * - Persian labels stay RTL; every technical value (masked key, HTTP status, endpoint
 *   URL, latency) is rendered inside an explicitly `dir="ltr"` monospace block.
 * - Status is always a badge (green / amber / red / grey) — never a sentence blob.
 * - Actions are thumb-sized (≥40px) and live inside the card.
 * - Raw error strings never leak into the default view: they sit inside a
 *   collapsed <details> block labelled «جزئیات فنی».
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
    onActivateProvider,
    onCopy,
    onNotify,
    onDownloadAll,
  }) {
    this.summaryContainer = summaryContainer;
    this.cardsContainer = cardsContainer;
    this.tableContainer = tableContainer;
    this.onSaveKey = onSaveKey;
    this.onDeleteKey = onDeleteKey;
    this.onTestKey = onTestKey;
    this.onSyncModels = onSyncModels;
    this.onActivateProvider = onActivateProvider;
    this.onCopy = onCopy;
    this.onNotify = onNotify;
    this.onDownloadAll = onDownloadAll;

    this.expandedGuides = new Set();
    this.testingProviders = new Set();
    this.editingProviders = new Set();
    this.lastInlineResults = new Map(); // providerId -> { ok, message }

    this.bindEvents();
  }

  setInlineResult(providerId, result) {
    if (result) this.lastInlineResults.set(providerId, result);
    else this.lastInlineResults.delete(providerId);
  }

  setEditing(providerId, editing = true) {
    if (editing) this.editingProviders.add(providerId);
    else this.editingProviders.delete(providerId);
  }

  render({ providers = [], providerHelp = [], linksTable = [], activeProvider = 'opencode' }) {
    this.lastRenderArgs = { providers, providerHelp, linksTable, activeProvider };
    const helpMap = new Map(providerHelp.map((h) => [h.id, h]));

    this.renderSummary(providers, activeProvider);
    this.renderProviderCards(providers, helpMap, activeProvider);
    this.renderReferenceTable(linksTable);
  }

  /* ───────────────────────────── summary ───────────────────────────── */

  renderSummary(providers, activeProvider) {
    if (!this.summaryContainer) return;
    const stats = summarizeProviderStatuses(providers);
    const activeSpec = providers.find((p) => p.id === activeProvider);
    const activeStatus = activeSpec ? resolveProviderStatus(activeSpec) : null;

    this.summaryContainer.innerHTML = `
      <div class="stat-strip" role="group" aria-label="خلاصه وضعیت سرویس‌ها">
        <div class="stat-tile ok">
          <span class="stat-value">${stats.connected.length}<span class="stat-value stat-value-sub">/${stats.total}</span></span>
          <span class="stat-label">متصل و آماده</span>
        </div>
        <div class="stat-tile warn">
          <span class="stat-value">${stats.limited.length}</span>
          <span class="stat-label">محدودیت موقت</span>
        </div>
        <div class="stat-tile err">
          <span class="stat-value">${stats.error.length + stats.standby.length}</span>
          <span class="stat-label">نیازمند تنظیم</span>
        </div>
        <div class="stat-tile muted">
          <span class="stat-value stat-value-sub is-accent" dir="ltr">${escapeHtml(
            activeSpec ? activeSpec.id : '—',
          )}</span>
          <span class="stat-label">سرویس فعال${
            activeStatus ? ` · ${escapeHtml(activeStatus.shortLabel)}` : ''
          }</span>
        </div>
      </div>
    `;
  }

  /* ───────────────────────────── cards ───────────────────────────── */

  renderProviderCards(providers, helpMap, activeProvider) {
    if (!this.cardsContainer) return;
    this.cardsContainer.innerHTML = '';

    const activeFirst = [...providers].sort((a, b) => {
      const rank = (spec) => {
        if (spec.id === activeProvider) return 0;
        const kind = resolveProviderStatus(spec).kind;
        return kind === 'connected' ? 1 : kind === 'limited' ? 2 : kind === 'error' ? 3 : 4;
      };
      return rank(a) - rank(b);
    });

    for (const spec of activeFirst) {
      const help = helpMap.get(spec.id) || {};
      const isSelected = spec.id === activeProvider;
      const isTesting = this.testingProviders.has(spec.id);
      const isGuideOpen = this.expandedGuides.has(spec.id);
      const isEditing = this.editingProviders.has(spec.id);
      const status = resolveProviderStatus(spec);
      const inlineResult = this.lastInlineResults.get(spec.id);

      const card = document.createElement('div');
      card.className = `provider-card state-${status.tone === 'err' ? 'invalid' : status.kind}${
        isSelected ? ' is-active' : ''
      }`;
      card.id = `key-card-${spec.id}`;
      card.dataset.providerCard = spec.id;
      card.dataset.providerStatus = status.kind;

      card.innerHTML = this.buildCardInnerHtml(spec, help, {
        isSelected,
        isTesting,
        isGuideOpen,
        isEditing,
        status,
        inlineResult,
      });
      this.cardsContainer.appendChild(card);
    }
  }

  buildCardInnerHtml(
    spec,
    help,
    { isSelected, isTesting, isGuideOpen, isEditing, status, inlineResult },
  ) {
    const logo = getProviderLogo(spec);
    const subtitleParts = [
      `<span class="mono ltr">${escapeHtml(spec.id)}</span>`,
      `<span class="mono badge badge-muted badge-mono">${escapeHtml(
        String(spec.protocol || 'openai').toUpperCase(),
      )}</span>`,
    ];
    if (spec.requiresBaseUrl) subtitleParts.push('<span>نیازمند Base URL</span>');
    else if (!spec.requiresKey) subtitleParts.push('<span>بدون نیاز به کلید</span>');

    const badges = [
      `<span class="badge badge-${status.tone}"><span class="dot dot-${status.tone}"></span>${escapeHtml(
        status.label,
      )}</span>`,
    ];
    if (isSelected) badges.push('<span class="badge badge-accent">سرویس فعال</span>');

    const card = `
      <div class="card-head">
        <div class="card-identity">
          <span class="card-logo" aria-hidden="true">${escapeHtml(logo)}</span>
          <div class="card-titles">
            <div class="card-title">${escapeHtml(spec.shortBadge || spec.title)}</div>
            <div class="card-subtitle">${subtitleParts.join('<span class="sep">·</span>')}</div>
          </div>
        </div>
        <div class="card-badges">${badges.join('')}</div>
      </div>

      ${this.buildTechRowsHtml(spec, status)}
      ${this.buildFeedbackHtml(spec, status, inlineResult)}
      ${
        isEditing
          ? this.buildEditFormHtml(spec)
          : this.buildActionsHtml(spec, { isSelected, isTesting, status })
      }
      ${this.buildFooterHtml(spec, help, isGuideOpen)}
      ${this.buildGuideHtml(spec, help, isGuideOpen)}
    `;

    return card;
  }

  /* ─────────────────── technical data (strict LTR islands) ─────────── */

  buildTechRowsHtml(spec, status) {
    const relTime = formatRelativeTimeFa(spec.lastTestedAt);
    const rows = [];

    // 1) Masked API key — always LTR monospace
    if (spec.maskedKey) {
      rows.push(`
        <div class="tech-row">
          <span class="tech-label">API KEY</span>
          <code class="tech-value is-key ltr" title="کلید ذخیره‌شده (ماسک‌شده)">${escapeHtml(
            spec.maskedKey,
          )}</code>
          <button type="button" class="mini-icon-btn" data-action="copy-key" data-provider="${escapeHtml(
            spec.id,
          )}" title="کپی کلید ماسک‌شده" aria-label="کپی کلید ماسک‌شده">${icon('copy', 14)}</button>
        </div>
      `);
    } else {
      rows.push(`
        <div class="tech-row">
          <span class="tech-label">API KEY</span>
          <span class="tech-value is-empty ltr">${
            spec.requiresKey ? 'not configured' : 'keyless / optional'
          }</span>
        </div>
      `);
    }

    // 2) Endpoint / base URL — LTR monospace
    const endpoint = spec.baseUrl || spec.defaultBaseUrl || '';
    rows.push(`
      <div class="tech-row">
        <span class="tech-label">ENDPOINT</span>
        <span class="tech-value is-url ltr" title="${escapeHtml(endpoint || 'در انتظار تنظیم')}">${escapeHtml(
          endpoint ? shortenText(endpoint, 46) : '—',
        )}</span>
        ${
          endpoint
            ? `<button type="button" class="mini-icon-btn" data-action="copy-endpoint" data-provider="${escapeHtml(
                spec.id,
              )}" title="کپی آدرس" aria-label="کپی آدرس اندپوینت">${icon('copy', 14)}</button>`
            : ''
        }
      </div>
    `);

    // 3) Latency + last test — numbers isolated LTR
    const latencyLabel = spec.lastLatencyMs ? `${Math.round(spec.lastLatencyMs)}ms` : '—';
    rows.push(`
      <div class="tech-row">
        <span class="tech-label">LATENCY</span>
        <span class="tech-value is-latency ltr">${escapeHtml(latencyLabel)}</span>
        <span class="tech-side fa">${relTime ? `آخرین تست ${escapeHtml(relTime)}` : 'تست‌نشده'}</span>
      </div>
    `);

    // 4) HTTP status line — derived from the last raw error only when meaningful
    if (status.kind === 'error' || status.kind === 'limited') {
      const parsed = parseProviderError(spec.lastError);
      if (parsed) {
        rows.push(`
          <div class="tech-row">
            <span class="tech-label">HTTP</span>
            <span class="tech-value ltr ${
              parsed.tone === 'warn' ? 'is-limited' : 'is-danger'
            }">${escapeHtml(parsed.codeLabel)}</span>
            <span class="tech-side fa">${escapeHtml(parsed.titleFa)}</span>
          </div>
        `);
      }
    }

    return `<div class="tech-list">${rows.join('')}</div>`;
  }

  /* ─────────────────────── structured error / hint ─────────────────── */

  buildFeedbackHtml(spec, status, inlineResult) {
    if (inlineResult) {
      const parsed = inlineResult.ok ? null : parseProviderError(inlineResult.message);
      if (inlineResult.ok) {
        return `
          <div class="alert alert-ok">
            <div class="alert-top">
              ${icon('check', 14)}
              <span class="alert-title">اتصال با موفقیت برقرار شد</span>
              <span class="alert-code ltr">${escapeHtml(
                formatLatencyOnly(inlineResult.message) || 'HTTP 200',
              )}</span>
            </div>
            <div class="alert-hint fa">کلید و اندپوینت این سرویس سالم هستند.</div>
          </div>
        `;
      }
      return this.buildErrorAlertHtml(parsed, inlineResult.message);
    }

    if (status.kind === 'error' || status.kind === 'limited') {
      const parsed = parseProviderError(spec.lastError);
      if (parsed) return this.buildErrorAlertHtml(parsed, spec.lastError);
    }

    if (status.kind === 'standby') {
      const isKeyless = !spec.requiresKey;
      const message = isKeyless
        ? 'این سرویس بدون کلید کار می‌کند و آماده فعال‌سازی است.'
        : 'برای فعال‌سازی، کلید رایگان سرویس را ثبت کنید.';
      return `
        <div class="alert alert-warn">
          <div class="alert-top">
            ${icon('key', 14)}
            <span class="alert-title">${escapeHtml(message)}</span>
          </div>
          <div class="alert-hint fa">مسیر: «ویرایش کلید» → Paste کلید → «تست اتصال» → «ذخیره و فعال‌سازی».</div>
        </div>
      `;
    }

    return '';
  }

  buildErrorAlertHtml(parsed, rawMessage) {
    if (!parsed) return '';
    return `
      <div class="alert ${parsed.tone === 'warn' ? 'alert-warn' : 'alert-err'}">
        <div class="alert-top">
          <span class="alert-title">${escapeHtml(parsed.titleFa)}</span>
        </div>
        <div class="alert-hint fa">${escapeHtml(parsed.hintFa)}</div>
        <details class="raw-details">
          <summary>جزئیات فنی</summary>
          <div class="mono-block ltr">${escapeHtml(shortenText(rawMessage, 420))}</div>
        </details>
      </div>
    `;
  }

  /* ───────────────────────────── actions ───────────────────────────── */

  buildActionsHtml(spec, { isSelected, isTesting, status }) {
    const canRemove = Boolean(
      spec.apiKeyConfigured || (spec.requiresBaseUrl && spec.baseUrl) || spec.lastTestedAt,
    );
    const canSyncLive = spec.id === 'opencode' || spec.id === 'openrouter';
    const primaryLabel = isSelected
      ? `${icon('pencil', 15)} ویرایش کلید`
      : `${icon('key', 15)} افزودن کلید`;

    const downloadBtn = `<button type="button" class="btn btn-sm btn-download" data-action="download-config" data-provider="${escapeHtml(
      spec.id,
    )}" title="دانلود فایل تنظیمات این سرویس">${icon('download', 15)} دانلود تنظیمات</button>`;

    const signupBtn = spec.signupUrl
      ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(
          spec.signupUrl,
        )}" target="_blank" rel="noopener">${icon('external', 15)} دریافت کلید</a>`
      : '';

    return `
      <div class="card-actions">
        <button type="button" class="btn btn-sm ${
          status.kind === 'connected' && !isTesting ? 'btn-secondary' : 'btn-primary'
        }" data-action="test-key" data-provider="${escapeHtml(spec.id)}" ${
          isTesting ? 'disabled' : ''
        }>
          ${
            isTesting
              ? `<span class="spinner"></span> در حال تست…`
              : `${icon('bolt', 15)} تست اتصال`
          }
        </button>

        <button type="button" class="btn btn-sm ${
          isSelected ? 'btn-secondary' : 'btn-primary'
        }" data-action="${isSelected ? 'edit-key' : 'activate-provider'}" data-provider="${escapeHtml(
          spec.id,
        )}">
          ${isSelected ? primaryLabel : `${icon('spark', 15)} فعال‌سازی`}
        </button>

        ${
          spec.apiKeyConfigured
            ? `<button type="button" class="btn btn-sm btn-secondary" data-action="copy-key" data-provider="${escapeHtml(
                spec.id,
              )}">${icon('copy', 15)} کپی کلید</button>`
            : `<button type="button" class="btn btn-sm btn-secondary" data-action="edit-key" data-provider="${escapeHtml(
                spec.id,
              )}">${primaryLabel}</button>`
        }

        ${downloadBtn}
        ${signupBtn}

        ${
          canSyncLive
            ? `<button type="button" class="btn btn-xs btn-ghost" data-action="sync-models" data-provider="${escapeHtml(
                spec.id,
              )}">${icon('refresh', 14)} مدل‌ها</button>`
            : ''
        }

        ${
          canRemove
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="delete-key" data-provider="${escapeHtml(
                spec.id,
              )}">${icon('trash', 14)} حذف</button>`
            : ''
        }
      </div>
    `;
  }

  buildEditFormHtml(spec) {
    const canAcceptKey = spec.requiresKey || spec.acceptsOptionalKey;
    const keyPlaceholder = spec.maskedKey
      ? 'کلید جدید برای جایگزینی…'
      : spec.requiresKey
        ? 'sk-... / AIza...'
        : 'کلید اختیاری (برای سقف اختصاصی)';

    return `
      <div class="card-form">
        ${
          canAcceptKey
            ? `
          <label class="field-label" for="key-input-${escapeHtml(spec.id)}">
            ${icon('key', 13)} کلید API
            ${spec.requiresKey ? '<span class="req">*</span>' : '<span class="link-muted">(اختیاری)</span>'}
          </label>
          <div class="input-wrap">
            <input
              id="key-input-${escapeHtml(spec.id)}"
              type="password"
              data-field="apiKey"
              dir="ltr"
              inputmode="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="${escapeHtml(keyPlaceholder)}"
              value=""
            />
            <button
              type="button"
              class="mini-icon-btn"
              data-action="toggle-mask"
              title="نمایش کلید"
              aria-label="نمایش یا مخفی‌کردن کلید"
            >${icon('eye', 14)}</button>
          </div>
        `
            : ''
        }

        ${
          spec.requiresBaseUrl
            ? `
          <label class="field-label" for="url-input-${escapeHtml(spec.id)}">
            ${icon('code', 13)} آدرس سرور (Base URL)
            <span class="req">*</span>
          </label>
          <div class="input-wrap">
            <input
              id="url-input-${escapeHtml(spec.id)}"
              type="url"
              data-field="baseUrl"
              dir="ltr"
              inputmode="url"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="https://router.example.com/v1"
              value="${escapeHtml(spec.baseUrl || '')}"
            />
          </div>
        `
            : ''
        }

        <div class="card-actions">
          <button type="button" class="btn btn-sm btn-primary" data-action="save-key" data-provider="${escapeHtml(
            spec.id,
          )}">${icon('check', 15)} ذخیره و فعال‌سازی</button>
          <button type="button" class="btn btn-sm btn-ghost" data-action="cancel-edit" data-provider="${escapeHtml(
            spec.id,
          )}">انصراف</button>
        </div>
      </div>
    `;
  }

  /* ───────────────────────────── footer & guide ────────────────────── */

  buildFooterHtml(spec, help, isGuideOpen) {
    const signup = spec.signupUrl
      ? `<a class="link-quiet" href="${escapeHtml(
          spec.signupUrl,
        )}" target="_blank" rel="noopener">${icon('external', 13)} دریافت کلید رایگان</a>`
      : '<span class="link-muted">بدون نیاز به ثبت‌نام</span>';

    const docs = spec.docsUrl
      ? `<a class="link-quiet" href="${escapeHtml(spec.docsUrl)}" target="_blank" rel="noopener">${icon(
          'book',
          13,
        )} مستندات</a>`
      : '';

    return `
      <div class="card-footer">
        <div class="card-footer-links">${signup}${docs}</div>
        <button
          type="button"
          class="accordion-toggle ${isGuideOpen ? 'open' : ''}"
          data-action="toggle-guide"
          data-provider="${escapeHtml(spec.id)}"
          aria-expanded="${isGuideOpen ? 'true' : 'false'}"
          aria-controls="guide-${escapeHtml(spec.id)}"
        >
          <span>راهنمای اتصال</span>
          <span class="chevron">${icon('chevron', 14)}</span>
        </button>
      </div>
    `;
  }

  downloadProviderGuide(providerId) {
    const spec = this.lastRenderArgs?.providers?.find((p) => p.id === providerId);
    const help = (this.lastRenderArgs?.providerHelp || []).find((h) => h.id === providerId) || {};
    if (!spec) return;

    const lines = [
      `# ${spec.shortBadge || spec.title}`,
      '',
      `- provider: ${spec.id}`,
      `- protocol: ${spec.protocol}`,
      `- endpoint: ${spec.baseUrl || spec.defaultBaseUrl || 'not set'}`,
      `- default model: ${spec.defaultModel || '-'}`,
      `- key required: ${spec.requiresKey ? 'yes' : 'no (optional keyless)'}`,
      '',
      '## Steps',
      ...(help.steps || []).map((step, i) => `${i + 1}. ${step}`),
      '',
      '## Free models',
      ...(help.freeModels || []).map((m) => `- ${m}`),
      '',
      '## Links',
      ...(help.links || []).map((l) => `- ${l.label}: ${l.url}`),
      '',
      help.note ? `> ${help.note}` : '',
      '',
      '> API keys never leave the server (encrypted in SQLite) and are not included in this file.',
    ];

    downloadText(`ahwaz-${safeFileSlug(spec.id)}-guide.md`, lines.join('\n'));
    this.onNotify?.(`📥 راهنمای ${spec.shortBadge || spec.id} دانلود شد`);
  }

  buildGuideHtml(spec, help, isGuideOpen) {
    const stepsHtml = (help.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('');

    const freeModels =
      Array.isArray(help.freeModels) && help.freeModels.length
        ? help.freeModels
        : (spec.models || []).map((m) => m.id);
    const freeModelsHtml = freeModels
      .map((model) => `<li>${escapeHtml(model)}</li>`)
      .join('');

    const linksHtml = (help.links || [])
      .map(
        (link) => `
          <div class="guide-link-row">
            <span class="fa" style="font-size:11px;color:var(--text-dim);flex:0 0 auto">${escapeHtml(
              link.label,
            )}</span>
            <a class="guide-link-url" href="${escapeHtml(link.url)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(
              link.url,
            )}</a>
            <a class="mini-icon-btn" href="${escapeHtml(
              link.url,
            )}" target="_blank" rel="noopener" aria-label="باز کردن ${escapeHtml(
              link.label,
            )} در مرورگر">${icon('external', 14)}</a>
          </div>
        `,
      )
      .join('');

    return `
      <div class="guide-accordion ${isGuideOpen ? 'expanded' : ''}" id="guide-${escapeHtml(
        spec.id,
      )}">
        <div class="guide-accordion-inner">
          ${stepsHtml ? `<div class="guide-block-title">🔑 مراحل دریافت و اتصال کلید</div><ol class="guide-ol">${stepsHtml}</ol>` : ''}
          ${
            freeModelsHtml
              ? `<div class="guide-block-title">📋 مدل‌های رایگان</div><ul class="guide-ul">${freeModelsHtml}</ul>`
              : ''
          }
          ${
            linksHtml
              ? `<div class="guide-block-title">🔗 لینک‌ها و دانلود مستقیم</div><div class="guide-links">${linksHtml}</div>`
              : ''
          }
          ${help.note ? `<div class="guide-tip">💡 ${escapeHtml(help.note)}</div>` : ''}
          <div class="card-actions">
            <button type="button" class="btn btn-xs btn-download" data-action="download-guide" data-provider="${escapeHtml(
              spec.id,
            )}">${icon('download', 14)} دانلود راهنمای اتصال (.md)</button>
            <button type="button" class="btn btn-xs btn-secondary" data-action="download-config" data-provider="${escapeHtml(
              spec.id,
            )}">${icon('download', 14)} دانلود تنظیمات (.json)</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ───────────────────────── reference table ──────────────────────── */

  renderReferenceTable(linksTable = []) {
    if (!this.tableContainer) return;
    if (!linksTable.length) {
      this.tableContainer.innerHTML = '';
      return;
    }

    const rowsHtml = linksTable
      .map((row) => {
        const keyCell = row.signupUrl
          ? `<a href="${escapeHtml(row.signupUrl)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(
              row.signupLabel || 'Get key',
            )}</a>`
          : `<span class="muted-cell">—</span>`;
        const docsCell = row.docsUrl
          ? `<a href="${escapeHtml(row.docsUrl)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(
              row.docsLabel || 'Docs',
            )}</a>`
          : `<span class="muted-cell">—</span>`;

        return `
          <tr>
            <td><b>${escapeHtml(row.name)}</b></td>
            <td>${keyCell}</td>
            <td>${docsCell}</td>
            <td class="center-cell">${escapeHtml(row.requiresCard)}</td>
            <td class="models-cell">${escapeHtml(row.freeModels)}</td>
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

  /* ───────────────────────────── behaviour ────────────────────────── */

  focusProviderCard(providerId, expandGuide = false) {
    if (expandGuide) {
      this.expandedGuides.add(providerId);
      if (this.lastRenderArgs) this.render(this.lastRenderArgs);
    }
    const card = document.getElementById(`key-card-${providerId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (expandGuide) return;
      const keyInput = card.querySelector('[data-field="apiKey"]');
      if (keyInput) setTimeout(() => keyInput.focus(), 220);
    }
  }

  downloadProviderConfig(providerId) {
    const spec = this.lastRenderArgs?.providers?.find((p) => p.id === providerId);
    if (!spec) return;
    const payload = {
      provider: spec.id,
      title: spec.title,
      protocol: spec.protocol,
      endpoint: spec.baseUrl || spec.defaultBaseUrl || null,
      model: spec.defaultModel,
      credentials: {
        apiKey: spec.maskedKey ? '***REDACTED***' : null,
        note: 'کلیدها هرگز در فایل خروجی قرار نمی‌گیرند؛ از صفحه سرویس دوباره بسازید.',
      },
      signupUrl: spec.signupUrl,
      docsUrl: spec.docsUrl,
      exportedAt: new Date().toISOString(),
    };
    downloadJson(`ahwaz-${safeFileSlug(spec.id)}-config.json`, payload);
    this.onNotify?.(`📥 فایل تنظیمات ${spec.shortBadge || spec.id} دانلود شد`);
  }

  copyValue(providerId, field) {
    const spec = this.lastRenderArgs?.providers?.find((p) => p.id === providerId);
    if (!spec) return;
    const value = field === 'endpoint' ? spec.baseUrl || spec.defaultBaseUrl : spec.maskedKey;
    if (!value) {
      this.onNotify?.('⚠️ مقداری برای کپی وجود ندارد');
      return;
    }
    this.onCopy?.(value, providerId, field);
  }

  bindEvents() {
    if (!this.cardsContainer) return;

    this.cardsContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const card = btn.closest('[data-provider-card]');
      const providerId = btn.dataset.provider || card?.dataset.providerCard;
      if (!providerId) return;

      if (action === 'toggle-mask' && card) {
        const input = card.querySelector('[data-field="apiKey"]');
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.innerHTML = icon(reveal ? 'eyeOff' : 'eye', 14);
        btn.setAttribute('title', reveal ? 'مخفی‌کردن کلید' : 'نمایش کلید');
        return;
      }

      if (action === 'toggle-guide') {
        const open = !this.expandedGuides.has(providerId);
        if (open) this.expandedGuides.add(providerId);
        else this.expandedGuides.delete(providerId);

        const accordion = card?.querySelector('.guide-accordion');
        if (accordion) accordion.classList.toggle('expanded', open);
        btn.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }

      if (action === 'edit-key') {
        this.editingProviders.add(providerId);
        if (this.lastRenderArgs) this.render(this.lastRenderArgs);
        setTimeout(() => {
          document
            .getElementById(`key-card-${providerId}`)
            ?.querySelector('[data-field="apiKey"], [data-field="baseUrl"]')
            ?.focus();
        }, 60);
        return;
      }

      if (action === 'cancel-edit') {
        this.editingProviders.delete(providerId);
        if (this.lastRenderArgs) this.render(this.lastRenderArgs);
        return;
      }

      if (action === 'copy-key') {
        this.copyValue(providerId, 'key');
        return;
      }

      if (action === 'copy-endpoint') {
        this.copyValue(providerId, 'endpoint');
        return;
      }

      if (action === 'download-config') {
        this.downloadProviderConfig(providerId);
        return;
      }

      if (action === 'download-guide') {
        this.downloadProviderGuide(providerId);
        return;
      }

      if (action === 'activate-provider' && this.onActivateProvider) {
        await this.onActivateProvider(providerId);
        return;
      }

      if (action === 'test-key' && this.onTestKey) {
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

      if (action === 'save-key' && this.onSaveKey) {
        const apiKey = card?.querySelector('[data-field="apiKey"]')?.value.trim() || undefined;
        const baseUrl = card?.querySelector('[data-field="baseUrl"]')?.value.trim() || undefined;
        this.editingProviders.delete(providerId);
        await this.onSaveKey({ providerId, apiKey, baseUrl });
        return;
      }

      if (action === 'delete-key' && this.onDeleteKey) {
        await this.onDeleteKey({ providerId });
        return;
      }

      if (action === 'sync-models' && this.onSyncModels) {
        await this.onSyncModels({ providerId });
      }
    });
  }
}

function formatLatencyOnly(message) {
  const match = String(message ?? '').match(/(\d+)\s*ms/i);
  return match ? `${match[1]}ms` : '';
}
