import {
  escapeHtml,
  formatConnectionLabelText,
  formatModelOptionLabel,
  getProviderLogo,
  resolveUiConnectionState,
} from './ProviderCatalog.js';

/**
 * Grouped model selector (`<optgroup>`), live search filter, and selected-model status preview bar.
 */
export class ModelSelector {
  constructor({
    searchInput,
    selectEl,
    previewEl,
    onSelectProviderModel,
    onRequestConfigureProvider,
  }) {
    this.searchInput = searchInput;
    this.selectEl = selectEl;
    this.previewEl = previewEl;
    this.onSelectProviderModel = onSelectProviderModel;
    this.onRequestConfigureProvider = onRequestConfigureProvider;

    this.filterQuery = '';
    this.state = {
      providers: [],
      activeProvider: 'opencode',
      activeModel: 'big-pickle',
    };

    this.bindEvents();
  }

  encodeValue(providerId, modelId) {
    return `${providerId}::${modelId}`;
  }

  decodeValue(raw) {
    const idx = String(raw ?? '').indexOf('::');
    if (idx === -1) return null;
    return {
      providerId: raw.slice(0, idx),
      modelId: raw.slice(idx + 2),
    };
  }

  render({ providers = [], activeProvider = 'opencode', activeModel = 'big-pickle' }) {
    this.state = { providers, activeProvider, activeModel };
    this.renderGroupedOptions();
    this.renderPreview();
  }

  renderGroupedOptions() {
    if (!this.selectEl) return;
    const { providers, activeProvider, activeModel } = this.state;
    const q = this.filterQuery.trim().toLowerCase();

    this.selectEl.innerHTML = '';
    let totalMatched = 0;

    for (const spec of providers) {
      const logo = getProviderLogo(spec);
      const statusTxt = formatConnectionLabelText(spec);
      const groupTitle = `${logo} ${spec.shortBadge?.replace(/^[^\w\u0600-\u06FF]+\s*/, '') || spec.title} (${statusTxt})`;

      const models = [...(spec.models || [])];
      if (
        spec.id === activeProvider &&
        activeModel &&
        !models.some((m) => m.id === activeModel)
      ) {
        models.unshift({ id: activeModel, label: activeModel, free: true });
      }

      const filteredModels = q
        ? models.filter(
            (m) =>
              m.id.toLowerCase().includes(q) ||
              String(m.label || '').toLowerCase().includes(q) ||
              spec.id.toLowerCase().includes(q) ||
              String(spec.title || '').toLowerCase().includes(q),
          )
        : models;

      if (filteredModels.length === 0) continue;

      const optgroup = document.createElement('optgroup');
      optgroup.label = groupTitle;

      for (const m of filteredModels) {
        const opt = document.createElement('option');
        opt.value = this.encodeValue(spec.id, m.id);
        opt.textContent = formatModelOptionLabel(m, spec);
        if (spec.id === activeProvider && m.id === activeModel) {
          opt.selected = true;
        }
        optgroup.appendChild(opt);
        totalMatched += 1;
      }

      this.selectEl.appendChild(optgroup);
    }

    if (totalMatched === 0) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.disabled = true;
      emptyOpt.selected = true;
      emptyOpt.textContent = '⚠️ مدلی مطابق جستجوی شما یافت نشد';
      this.selectEl.appendChild(emptyOpt);
    }
  }

  renderPreview() {
    if (!this.previewEl) return;
    const { providers, activeProvider, activeModel } = this.state;
    const spec = providers.find((p) => p.id === activeProvider);
    if (!spec) {
      this.previewEl.innerHTML = '';
      return;
    }

    const uiState = resolveUiConnectionState(spec);
    const statusText = formatConnectionLabelText(spec);
    const statusClass =
      uiState === 'connected' ? 'ok' : uiState === 'invalid' ? 'warn' : 'err';

    const fixBtnHtml =
      uiState !== 'connected'
        ? `<button type="button" class="preview-fix-btn" data-configure-provider="${escapeHtml(spec.id)}">➕ تنظیم کلید</button>`
        : '';

    this.previewEl.innerHTML = `
      <div class="model-preview-chip">
        <span>مدل انتخابی: <code dir="ltr">${escapeHtml(activeModel)}</code></span>
        <span class="sep">|</span>
        <span>سرویس: <b>${escapeHtml(spec.shortBadge || spec.title)}</b></span>
        <span class="sep">|</span>
        <span>وضعیت کلید: <b class="preview-state ${statusClass}">${escapeHtml(statusText)}</b></span>
        ${fixBtnHtml}
      </div>
    `;
  }

  focusSelector() {
    if (this.selectEl) {
      this.selectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.selectEl.focus();
    }
  }

  bindEvents() {
    this.searchInput?.addEventListener('input', () => {
      this.filterQuery = this.searchInput.value || '';
      this.renderGroupedOptions();
    });

    this.selectEl?.addEventListener('change', async () => {
      const parsed = this.decodeValue(this.selectEl.value);
      if (!parsed || !this.onSelectProviderModel) return;
      await this.onSelectProviderModel(parsed);
    });

    this.previewEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-configure-provider]');
      if (!btn || !this.onRequestConfigureProvider) return;
      this.onRequestConfigureProvider(btn.dataset.configureProvider);
    });
  }
}
