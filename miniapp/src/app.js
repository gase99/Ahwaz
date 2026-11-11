import { ActiveModelCard } from './components/ActiveModelCard.js';
import { ApiKeysPanel } from './components/ApiKeysPanel.js';
import { ConnectionsDashboard } from './components/ConnectionsDashboard.js';
import { ModelSelector } from './components/ModelSelector.js';
import { copyText, downloadJson, safeFileSlug } from './components/download.js';
import { escapeHtml, resolveProviderStatus } from './components/ProviderCatalog.js';
import { parseProviderError } from './components/error-presenter.js';

const tg = window.Telegram?.WebApp;

/*───────────────────────── DOM refs ──*/
const el = {
  btnHeaderBack: document.getElementById('btnHeaderBack'),
  btnHeaderConnections: document.getElementById('btnHeaderConnections'),
  btnRefresh: document.getElementById('btnRefresh'),
  modelSearchInput: document.getElementById('modelSearchInput'),
  groupedModelSelect: document.getElementById('groupedModelSelect'),
  modelPreviewBar: document.getElementById('modelPreviewBar'),
  connectionsSummary: document.getElementById('connectionsSummary'),
  connectionsGrid: document.getElementById('connectionsGrid'),
  btnManageAllKeys: document.getElementById('btnManageAllKeys'),
  keysSummaryBanner: document.getElementById('keysSummaryBanner'),
  activeModelCard: document.getElementById('activeModelCard'),
  providersGrid: document.getElementById('providersGrid'),
  btnDownloadAllKeys: document.getElementById('btnDownloadAllKeys'),
  btnSyncAllProviders: document.getElementById('btnSyncAllProviders'),
  providerLinksTable: document.getElementById('providerLinksTable'),
  projectSelect: document.getElementById('projectSelect'),
  btnNewProject: document.getElementById('btnNewProject'),
  btnExportZip: document.getElementById('btnExportZip'),
  tabFilesCount: document.getElementById('tabFilesCount'),
  fileCount: document.getElementById('fileCount'),
  fileList: document.getElementById('fileList'),
  agentLog: document.getElementById('agentLog'),
  promptForm: document.getElementById('promptForm'),
  promptInput: document.getElementById('promptInput'),
  btnRunAgent: document.getElementById('btnRunAgent'),
  btnCreateFile: document.getElementById('btnCreateFile'),
  btnRefreshFiles: document.getElementById('btnRefreshFiles'),
  btnEditorBack: document.getElementById('btnEditorBack'),
  editorPath: document.getElementById('editorPath'),
  editorContent: document.getElementById('editorContent'),
  btnSaveFile: document.getElementById('btnSaveFile'),
  btnDeleteFile: document.getElementById('btnDeleteFile'),
  helpGrid: document.getElementById('helpGrid'),
  toast: document.getElementById('toast'),
};

const appState = {
  activeTab: 'agent',
  providers: [],
  providerHelp: [],
  linksTable: [],
  activeProvider: 'opencode',
  activeModel: 'big-pickle',
  activeProject: 'default',
  projects: [],
  files: [],
  user: {},
};

/*───────────────────────── Telegram WebApp theme & native buttons ──*/
if (tg) {
  tg.ready();
  tg.expand();

  // The redesign intentionally keeps a fixed deep-dark palette (#0A0E17) so
  // the glass cards and LTR mono blocks always stay readable; only the header
  // tint follows Telegram when the client exposes a dark header colour.
  const theme = tg.themeParams || {};
  if (theme.header_bg_color) {
    document.documentElement.style.setProperty('--bg-soft', theme.header_bg_color);
  }
  document.body.classList.add('tg-dark');

  if (tg.MainButton) {
    tg.MainButton.setBackgroundColor('#4f9cff');
    tg.MainButton.setTextColor('#04101f');
    tg.MainButton.setText('اجرا 🚀');
  }

  tg.BackButton.onClick(() => {
    switchTab('agent');
    tg.BackButton.hide();
  });

  tg.MainButton.onClick(() => {
    if (appState.activeTab === 'agent' && !el.btnRunAgent.disabled) {
      el.promptForm.requestSubmit();
    } else if (appState.activeTab === 'editor') {
      el.btnSaveFile.click();
    }
  });
}

function haptic(style = 'light') {
  tg?.HapticFeedback?.impactOccurred?.(style);
}

/*───────────────────────── Serverless RPC ──*/
async function callServerlessEndpoint(name, payload = {}) {
  if (tg?.Serverless?.call) {
    return await new Promise((resolve, reject) => {
      tg.Serverless.call(name, payload, (err, result) => {
        if (err) reject(new Error(err.message || err.description || 'Serverless Error'));
        else resolve(result);
      });
    });
  }

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': tg?.initData ?? '',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.description || data?.error || data?.message || `HTTP ${res.status}`);
  }
  return data?.result ?? data;
}

/*───────────────────────── Persian Error Classification & Toast ──*/
function classifyError(err) {
  const msg = String(err?.message ?? '');
  const low = msg.toLowerCase();
  const status = err?.status ?? null;

  if (/failed to fetch|networkerror|net::err|timeout/i.test(msg)) {
    return {
      code: 'NETWORK',
      title: 'اتصال برقرار نیست',
      meaning: 'اتصال اینترنت یا سرور Telegram Serverless در دسترس نیست.',
      fix: 'اینترنت خود را بررسی کنید و روی دکمه 🔄 در بالای صفحه بزنید.',
    };
  }

  if (
    /از داخل تلگرام|احراز هویت|unauthorized/i.test(low) ||
    status === 401 ||
    status === 403
  ) {
    if (/تایید نشده|forbidden/i.test(low) || status === 403) {
      return {
        code: 'FORBIDDEN',
        title: 'حساب تایید نشده',
        meaning: 'حساب کاربری شما هنوز توسط ادمین ربات مجاز نشده است.',
        fix: 'در چت ربات دستور `/whoami` را بزنید و از ادمین بخواهید `/allow <ID>` را اجرا کند.',
      };
    }
    return {
      code: 'UNAUTHORIZED',
      title: 'فقط از داخل تلگرام',
      meaning: 'مینی‌اپ باید از طریق دکمه Code Studio در چت تلگرام باز شود.',
      fix: 'لینک را در مرورگر خارجی باز نکنید؛ از داخل چت ربات وارد شوید.',
    };
  }

  if (/یافت نشد|پیدا نشد|not_found/i.test(low) || status === 404) {
    return {
      code: 'NOT_FOUND',
      title: 'یافت نشد',
      meaning: 'فایل یا آیتم مورد نظر در پروژه پیدا نشد.',
      fix: 'لیست فایل‌ها را بروزرسانی کنید.',
    };
  }

  if (/محدودیت|rate limit|429/i.test(low) || status === 429) {
    return {
      code: 'RATE_LIMIT',
      title: 'محدودیت تعداد درخواست',
      meaning: 'سقف موقت درخواست به سرویس هوش مصنوعی پر شده است.',
      fix: 'چند لحظه صبر کنید یا از منوی بالا یکی دیگر از سرویس‌های رایگان (مثل LLM7 یا OpenCode) را انتخاب نمایید.',
    };
  }

  return {
    code: 'GENERAL',
    title: 'خطا در عملیات',
    meaning: msg || 'خطای غیرمنتظره‌ای رخ داد.',
    fix: 'کلید API یا آدرس سرور را در تب «🔑 کلیدها» بررسی و تست کنید.',
  };
}

let toastTimer = null;
function showToast(message, durationMs = 2800) {
  if (!el.toast) return;
  el.toast.textContent = String(message ?? '');
  el.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, durationMs);
}

function confirmDialog(message) {
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
    });
  }
  return Promise.resolve(window.confirm(message));
}

function showError(err, blocking = false) {
  const c = classifyError(err);
  console.error(`[Ahwaz][${c.code}]`, err);
  const text = `❌ ${c.title}\n\n${c.meaning}\n\n🔧 راهنما: ${c.fix}`;
  if (blocking && tg?.showAlert) {
    tg.HapticFeedback?.notificationOccurred?.('error');
    return tg.showAlert(text);
  }
  showToast(`❌ ${c.title}: ${c.meaning}`, 3600);
}

function showSuccess(msg) {
  showToast(`✅ ${msg}`);
  haptic();
}

/*───────────────────────── Copy / Download helpers ──*/
const COPY_LABELS = {
  key: 'کلید ماسک‌شده',
  endpoint: 'آدرس اندپوینت',
  model: 'نام مدل',
};

async function copyToClipboard(value, label = 'مقدار') {
  const ok = await copyText(value);
  if (ok) {
    showToast(`📋 ${label} کپی شد`, 1800);
    haptic();
  } else {
    showToast('⚠️ کپی ناموفق بود؛ متن را دستی انتخاب کنید', 2600);
  }
}

function providerStatusReport() {
  return {
    generatedAt: new Date().toISOString(),
    app: 'Ahwaz Code Studio',
    activeModel: appState.activeModel,
    activeProvider: appState.activeProvider,
    providers: appState.providers.map((spec) => ({
      id: spec.id,
      title: spec.title,
      protocol: spec.protocol,
      status: resolveProviderStatus(spec).kind,
      endpoint: spec.baseUrl || spec.defaultBaseUrl || null,
      defaultModel: spec.defaultModel,
      apiKeyConfigured: Boolean(spec.apiKeyConfigured),
      maskedKey: spec.maskedKey || null,
      lastLatencyMs: spec.lastLatencyMs ?? null,
      lastTestedAt: spec.lastTestedAt ?? null,
      lastError: spec.lastError || null,
    })),
  };
}

function downloadConnectionReport() {
  downloadJson('ahwaz-providers-status.json', providerStatusReport());
  showSuccess('فایل وضعیت سرویس‌ها دانلود شد');
}

/*───────────────────────── Modular UI Components ──*/
const modelSelector = new ModelSelector({
  searchInput: el.modelSearchInput,
  selectEl: el.groupedModelSelect,
  previewEl: el.modelPreviewBar,
  onSelectProviderModel: async ({ providerId, modelId }) => {
    try {
      const res = await callServerlessEndpoint('studio', {
        action: 'setProvider',
        providerId,
        model: modelId,
      });
      applyStudioUpdate(res);
      showSuccess(`مدل فعال: ${res.model} (${res.provider})`);
    } catch (err) {
      showError(err);
      renderAllComponents();
    }
  },
  onRequestConfigureProvider: (providerId) => {
    switchTab('settings');
    apiKeysPanel.focusProviderCard(providerId, true);
  },
});

const apiKeysPanel = new ApiKeysPanel({
  summaryContainer: el.keysSummaryBanner,
  cardsContainer: el.providersGrid,
  tableContainer: el.providerLinksTable,
  onTestKey: async ({ providerId, apiKey, baseUrl }) => {
    try {
      const res = await callServerlessEndpoint('test_key', {
        providerId,
        apiKey,
        baseUrl,
      });
      if (Array.isArray(res.providers)) {
        appState.providers = res.providers;
      }
      if (res.success) {
        apiKeysPanel.setInlineResult(providerId, {
          ok: true,
          message: `اتصال برقرار است (${res.latency_ms}ms)`,
        });
        showSuccess(`تست ${providerId} موفق بود (${res.latency_ms}ms)`);
      } else {
        apiKeysPanel.setInlineResult(providerId, {
          ok: false,
          message: res.error || 'اتصال برقرار نشد',
        });
        const brief = parseProviderError(res.error);
        showToast(
          brief ? `⚠️ ${brief.titleFa} — ${brief.codeLabel}` : '⚠️ تست ناموفق: کلید یا آدرس را بررسی کنید',
          3200,
        );
      }
      renderAllComponents();
    } catch (err) {
      apiKeysPanel.setInlineResult(providerId, {
        ok: false,
        message: err.message || 'خطا در تست اتصال',
      });
      showError(err);
    }
  },
  onSaveKey: async ({ providerId, apiKey, baseUrl }) => {
    try {
      const res = await callServerlessEndpoint('studio', {
        action: 'setProvider',
        providerId,
        apiKey,
        baseUrl,
        notifyChat: Boolean(apiKey || baseUrl),
      });
      apiKeysPanel.setInlineResult(providerId, null);
      applyStudioUpdate(res);
      showSuccess(
        apiKey || baseUrl
          ? `کلید/تنظیمات ${providerId} ذخیره و با چت همگام شد`
          : `سرویس ${providerId} فعال شد`,
      );
    } catch (err) {
      showError(err, true);
    }
  },
  onDeleteKey: async ({ providerId }) => {
    const ok = await confirmDialog(`آیا کلید ذخیره‌شده سرویس «${providerId}» حذف شود؟`);
    if (!ok) return;
    try {
      const res = await callServerlessEndpoint('studio', {
        action: 'deleteKey',
        providerId,
        notifyChat: true,
      });
      apiKeysPanel.setInlineResult(providerId, null);
      applyStudioUpdate(res);
      showSuccess(`کلید ${providerId} حذف شد`);
    } catch (err) {
      showError(err);
    }
  },
  onActivateProvider: async (providerId) => {
    try {
      const res = await callServerlessEndpoint('studio', {
        action: 'setProvider',
        providerId,
      });
      applyStudioUpdate(res);
      showSuccess(`سرویس ${providerId} فعال شد`);
    } catch (err) {
      showError(err);
    }
  },
  onCopy: (value, providerId, field) => {
    copyToClipboard(value, COPY_LABELS[field] || 'مقدار');
  },
  onNotify: (message) => showToast(message, 2400),
  onDownloadAll: () => downloadConnectionReport(),
  onSyncModels: async ({ providerId }) => {
    try {
      showToast(`🔄 دریافت لیست زنده مدل‌های ${providerId}...`);
      const action =
        providerId === 'openrouter' ? 'syncOpenRouterModels' : 'syncOpenCodeModels';
      const res = await callServerlessEndpoint('studio', { action });
      const target = appState.providers.find((p) => p.id === providerId);
      if (target && Array.isArray(res.models)) {
        target.models = res.models;
      }
      renderAllComponents();
      showSuccess(`${res.models?.length || 0} مدل رایگان بروزرسانی شد`);
    } catch (err) {
      showError(err);
    }
  },
});

const activeModelCard = new ActiveModelCard({
  container: el.activeModelCard,
  onConfigure: (providerId) => {
    apiKeysPanel.setEditing(providerId, true);
    switchTab('settings');
    apiKeysPanel.focusProviderCard(providerId, false);
  },
  onCopyModel: (modelId) => copyToClipboard(modelId, 'نام مدل'),
  onOpenSelector: () => {
    switchTab('agent');
    modelSelector.focusSelector();
  },
});

const connectionsDashboard = new ConnectionsDashboard({
  headerBadgeBtn: el.btnHeaderConnections,
  summaryEl: el.connectionsSummary,
  gridEl: el.connectionsGrid,
  onJumpToKeyCard: (providerId) => {
    switchTab('settings');
    apiKeysPanel.focusProviderCard(providerId, true);
  },
  onChangeProviderModel: async (providerId) => {
    if (providerId !== appState.activeProvider) {
      try {
        const res = await callServerlessEndpoint('studio', {
          action: 'setProvider',
          providerId,
        });
        applyStudioUpdate(res);
      } catch (err) {
        showError(err);
        return;
      }
    }
    modelSelector.focusSelector();
  },
  onRetestProvider: async (providerId) => {
    try {
      const res = await callServerlessEndpoint('test_key', { providerId });
      if (Array.isArray(res.providers)) {
        appState.providers = res.providers;
      }
      renderAllComponents();
      if (res.success) {
        showSuccess(`تست ${providerId} موفق (${res.latency_ms}ms)`);
      } else {
        const brief = parseProviderError(res.error);
        showToast(
          brief ? `⚠️ ${brief.titleFa} — ${brief.codeLabel}` : `⚠️ تست ${providerId} ناموفق`,
          3200,
        );
      }
    } catch (err) {
      showError(err);
    }
  },
  onDisconnectProvider: async (providerId) => {
    const ok = await confirmDialog(`آیا اتصال و کلید سرویس «${providerId}» قطع و حذف شود؟`);
    if (!ok) return;
    try {
      const res = await callServerlessEndpoint('studio', {
        action: 'deleteKey',
        providerId,
        notifyChat: true,
      });
      applyStudioUpdate(res);
      showSuccess(`اتصال ${providerId} قطع شد`);
    } catch (err) {
      showError(err);
    }
  },
});

/*───────────────────────── Tabs & Navigation ──*/
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const active = panel.id === `panel-${tabName}`;
    panel.classList.toggle('active', active);
    panel.classList.toggle(
      'panel-mainbtn',
      active && (tabName === 'agent' || tabName === 'editor'),
    );
  });
  appState.activeTab = tabName;
  updateMainButton(tabName);
  updateBackButton(tabName);
  renderAllComponents();
  haptic();
}

function updateMainButton(tab) {
  if (!tg?.MainButton) return;
  if (tab === 'agent') {
    tg.MainButton.setText('اجرا 🚀').show();
  } else if (tab === 'editor') {
    tg.MainButton.setText('ذخیره 💾').show();
  } else {
    tg.MainButton.hide();
  }
}

function updateBackButton(tab) {
  if (el.btnHeaderBack) {
    el.btnHeaderBack.classList.toggle('hidden', tab === 'agent');
  }
  if (!tg?.BackButton) return;
  if (tab === 'agent') tg.BackButton.hide();
  else tg.BackButton.show();
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

el.btnHeaderBack?.addEventListener('click', () => switchTab('agent'));
el.btnEditorBack?.addEventListener('click', () => switchTab('agent'));
el.btnHeaderConnections?.addEventListener('click', () => switchTab('connections'));
el.btnManageAllKeys?.addEventListener('click', () => switchTab('settings'));
el.btnDownloadAllKeys?.addEventListener('click', () => downloadConnectionReport());
el.btnSyncAllProviders?.addEventListener('click', () => {
  showToast('🔄 همگام‌سازی وضعیت سرویس‌ها با ربات…', 1800);
  loadInitialState({ silent: true });
});

/*───────────────────────── State Sync & Rendering ──*/
function applyStudioUpdate(res) {
  if (!res) return;
  if (Array.isArray(res.providers)) appState.providers = res.providers;
  if (res.provider) appState.activeProvider = res.provider;
  if (res.model) appState.activeModel = res.model;
  renderAllComponents();
}

function renderHelpCards() {
  if (!el.helpGrid) return;
  el.helpGrid.innerHTML = '';
  for (const h of appState.providerHelp) {
    const div = document.createElement('div');
    div.className = 'help-card';
    div.id = `help-${h.id}`;
    const tag = h.keyless
      ? '<span class="tag tag-ok">🆓 بدون کلید</span>'
      : '<span class="tag tag-need">🔑 نیازمند کلید رایگان</span>';
    const cmds = (h.commands || []).length
      ? `<div class="help-cmd">${(h.commands || [])
          .map((c) => escapeHtml(String(c).replace(/^`+|`+$/g, '')))
          .join(' · ')}</div>`
      : '';
    div.innerHTML = `
      <div class="help-head">
        <div class="help-name">${escapeHtml(h.title)}</div>
        ${tag}
      </div>
      <div class="help-desc">${escapeHtml(h.summary)}</div>
      ${cmds}
      <button type="button" class="btn-ghost-sm" data-open-key-guide="${escapeHtml(h.id)}">
        🔑 باز کردن کارت کلید و راهنمای گام‌به‌گام
      </button>
    `;
    el.helpGrid.appendChild(div);
  }
}

el.helpGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-open-key-guide]');
  if (!btn) return;
  switchTab('settings');
  apiKeysPanel.focusProviderCard(btn.dataset.openKeyGuide, true);
});

function renderAllComponents() {
  modelSelector.render({
    providers: appState.providers,
    activeProvider: appState.activeProvider,
    activeModel: appState.activeModel,
  });

  connectionsDashboard.render({
    providers: appState.providers,
    activeProvider: appState.activeProvider,
    activeModel: appState.activeModel,
  });

  activeModelCard.render({
    providers: appState.providers,
    activeProvider: appState.activeProvider,
    activeModel: appState.activeModel,
  });

  apiKeysPanel.render({
    providers: appState.providers,
    providerHelp: appState.providerHelp,
    linksTable: appState.linksTable,
    activeProvider: appState.activeProvider,
  });

  renderHelpCards();
}

function renderState(state) {
  if (state.providers) appState.providers = state.providers;
  if (state.providerHelp) appState.providerHelp = state.providerHelp;
  if (state.linksTable) appState.linksTable = state.linksTable;
  if (state.user) appState.user = state.user;
  if (state.user?.provider) appState.activeProvider = state.user.provider;
  if (state.user?.model) appState.activeModel = state.user.model;
  appState.activeProject = state.activeProject || appState.activeProject;
  appState.projects = state.projects || appState.projects;
  appState.files = state.files || appState.files;

  renderAllComponents();

  if (el.tabFilesCount) {
    el.tabFilesCount.textContent = String(appState.files.length);
  }
  if (el.fileCount) {
    el.fileCount.textContent = String(appState.files.length);
  }

  if (el.projectSelect) {
    el.projectSelect.innerHTML = '';
    for (const proj of appState.projects) {
      const opt = document.createElement('option');
      opt.value = proj.name;
      opt.textContent = `📁 ${proj.name}`;
      if (proj.name === appState.activeProject) opt.selected = true;
      el.projectSelect.appendChild(opt);
    }
  }

  if (el.fileList) {
    el.fileList.innerHTML = '';
    if (appState.files.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'msg system';
      empty.textContent = 'هنوز فایلی در این پروژه وجود ندارد.';
      el.fileList.appendChild(empty);
    } else {
      for (const f of appState.files) {
        const li = document.createElement('li');
        li.className = 'file-item';
        li.innerHTML = `<span>📄 ${escapeHtml(f.path)}</span><span class="file-size">${f.sizeBytes} B</span>`;
        li.addEventListener('click', () => openFileInEditor(f.path));
        el.fileList.appendChild(li);
      }
    }
  }
}

async function loadInitialState({ silent = false } = {}) {
  try {
    const data = await callServerlessEndpoint('studio', { action: 'state' });
    renderState(data);
  } catch (err) {
    if (!silent) showError(err, true);
  }
}

// Two-way sync: automatically refresh Mini App state when user returns from Telegram chat
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadInitialState({ silent: true });
  }
});

/*───────────────────────── Projects & Workspace Files ──*/
async function openFileInEditor(path) {
  try {
    const data = await callServerlessEndpoint('studio', { action: 'readFile', path });
    el.editorPath.value = data.file.path;
    el.editorContent.value = data.file.content;
    switchTab('editor');
  } catch (err) {
    showToast(`خطا: ${err.message}`);
  }
}

el.projectSelect?.addEventListener('change', async () => {
  try {
    const data = await callServerlessEndpoint('studio', {
      action: 'switchProject',
      projectName: el.projectSelect.value,
    });
    renderState(data);
    showSuccess(`پروژه فعال: ${data.activeProject}`);
  } catch (err) {
    showError(err);
  }
});

el.btnNewProject?.addEventListener('click', async () => {
  const name = window.prompt('نام پروژه جدید (انگلیسی):', 'my-app');
  if (!name) return;
  try {
    const data = await callServerlessEndpoint('studio', {
      action: 'switchProject',
      projectName: name,
    });
    renderState(data);
    showSuccess(`پروژه ${data.activeProject} ساخته شد`);
  } catch (err) {
    showError(err);
  }
});

el.btnCreateFile?.addEventListener('click', () => {
  el.editorPath.value = 'src/new-file.js';
  el.editorContent.value = '';
  switchTab('editor');
});

el.btnRefresh?.addEventListener('click', () => loadInitialState());
el.btnRefreshFiles?.addEventListener('click', () => loadInitialState());

el.btnSaveFile?.addEventListener('click', async () => {
  const path = el.editorPath.value.trim();
  if (!path) return showToast('مسیر فایل را وارد کنید');
  try {
    const data = await callServerlessEndpoint('studio', {
      action: 'saveFile',
      path,
      content: el.editorContent.value,
    });
    renderState({ activeProject: appState.activeProject, files: data.files });
    showSuccess(`فایل ${data.path} ذخیره شد`);
  } catch (err) {
    showError(err);
  }
});

el.btnDeleteFile?.addEventListener('click', async () => {
  const path = el.editorPath.value.trim();
  if (!path) return;
  const confirmed = await confirmDialog(`آیا مطمئن هستید که فایل «${path}» حذف شود؟`);
  if (!confirmed) return;
  try {
    const data = await callServerlessEndpoint('studio', { action: 'deleteFile', path });
    el.editorPath.value = '';
    el.editorContent.value = '';
    renderState({ activeProject: appState.activeProject, files: data.files });
    switchTab('files');
    showSuccess('فایل حذف شد');
  } catch (err) {
    showError(err);
  }
});

el.btnExportZip?.addEventListener('click', async () => {
  try {
    showToast('📦 در حال ارسال ZIP به چت تلگرام...');
    await callServerlessEndpoint('studio', { action: 'exportZipToChat' });
    showSuccess('فایل ZIP به چت شما ارسال شد!');
  } catch (err) {
    showError(err);
  }
});

/*───────────────────────── Agent Prompt Execution ──*/
function appendMessage(role, text, toolLogs = []) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;

  if (toolLogs.length > 0) {
    const toolsDiv = document.createElement('div');
    toolsDiv.className = 'tool-pills';
    toolsDiv.textContent = `🛠️ ابزارهای اجرا شده:\n${toolLogs.join('\n')}`;
    div.appendChild(toolsDiv);
  }

  el.agentLog.appendChild(div);
  el.agentLog.scrollTop = el.agentLog.scrollHeight;
}

el.promptForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = el.promptInput.value.trim();
  if (!prompt) return;

  el.promptInput.value = '';
  appendMessage('user', prompt);
  el.btnRunAgent.disabled = true;
  el.btnRunAgent.textContent = '⏳...';
  tg?.MainButton?.showProgress?.();
  tg?.MainButton?.disable?.();

  try {
    const res = await callServerlessEndpoint('agent', { prompt });
    const footer = `\n\n🌐 ${res.providerBadge} • ${res.model}${
      res.routedVia ? ` (${res.routedVia})` : ''
    }`;
    appendMessage('assistant', `${res.text}${footer}`, res.toolLogs || []);
    if (res.files) {
      appState.files = res.files;
      renderState({ activeProject: appState.activeProject, files: res.files });
    }
  } catch (err) {
    showError(err, true);
  } finally {
    el.btnRunAgent.disabled = false;
    el.btnRunAgent.textContent = 'اجرا 🚀';
    tg?.MainButton?.hideProgress?.();
    tg?.MainButton?.enable?.();
    updateMainButton(appState.activeTab);
  }
});

/*───────────────────────── Boot ──*/
updateMainButton(appState.activeTab);
updateBackButton(appState.activeTab);
loadInitialState();
