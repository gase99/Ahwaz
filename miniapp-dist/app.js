const tg = window.Telegram?.WebApp;

/*───────────────────────── Telegram WebApp init ──*/
if (tg) {
  tg.ready();
  tg.expand();

  // Sync CSS theme variables with the Telegram theme
  const theme = tg.themeParams || {};
  const setVar = (name, key, fallback) =>
    document.documentElement.style.setProperty(name, theme[key] ?? fallback);
  setVar('--tg-bg', 'bg_color', '#0f172a');
  setVar('--tg-text', 'text_color', '#f8fafc');
  setVar('--tg-muted', 'hint_color', '#94a3b8');
  setVar('--tg-accent', 'button_color', '#38bdf8');
  setVar('--tg-accent-text', 'button_text_color', '#0f172a');
  setVar('--tg-surface', 'secondary_bg_color', '#1e293b');
  setVar('--tg-header-bg', 'header_bg_color', '#1e293b');

  if (tg.MainButton) {
    tg.MainButton.setBackgroundColor(theme.button_color ?? '#38bdf8');
    tg.MainButton.setTextColor(theme.button_text_color ?? '#0f172a');
    tg.MainButton.setText('اجرا 🚀');
  }

  tg.BackButton.onClick(() => {
    switchTab('agent');
    tg.BackButton.hide();
  });

  tg.MainButton.onClick(() => {
    if (appState.activeTab === 'agent') {
      el.btnRunAgent.click();
    } else if (appState.activeTab === 'editor') {
      el.btnSaveFile.click();
    }
  });
}

function haptic(style = 'light') {
  tg?.HapticFeedback?.impactOccurred?.(style);
}

/*───────────────────────── Serverless calls ──*/
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

/*───────────────────────── Errors: meaning + what-to-do (Persian) ──*/
function classifyError(err) {
  const msg = String(err?.message ?? '');
  const low = msg.toLowerCase();
  const status = err.status ?? null;

  const net = /failed to fetch|networkerror|net::err|timeout/i.test(msg);
  if (net) {
    return {
      code: 'NETWORK',
      title: 'اتصال برقرار نیست',
      meaning: 'اتصال به اینترنت یا سرور تلگرام سرلس در دسترس نیست.',
      fix: 'اتصال اینترنت را بررسی کنید، برنامه تلگرام را ببندید و دوباره باز کنید، سپس اقدام را تکرار کنید.',
    };
  }

  const auth =
    /از داخل تلگرام|احراز هویت|unauthorized/i.test(low) ||
    status === 401 ||
    status === 403;
  if (auth) {
    if (/تایید نشده|forbidden/i.test(low) || status === 403) {
      return {
        code: 'FORBIDDEN',
        title: 'حساب تایید نشده',
        meaning: 'حساب کاربری شما توسط ادمین ربات تایید نشده است.',
        fix: 'با دستور `/whoami` شناسه عددی خود را دریافت کنید و از ادمین بخواهید دستور `/allow <شناسه>` را اجرا کند.',
      };
    }
    return {
      code: 'UNAUTHORIZED',
      title: 'فقط از داخل تلگرام',
      meaning: 'مینی آپ باید از طریق چت ربات تلگرام باز شود (دکمه Code Studio).',
      fix: 'باز کردن لینک مستقیماً در مرورگر عادی کار نمی‌کند. در چت ربات خود، دکمه «باز کردن Code Studio (Mini App)』 را بزنید.',
    };
  }

  if (/یافت نشد|پیدا نشد|not_found/i.test(low) || status === 404) {
    return {
      code: 'NOT_FOUND',
      title: 'یافت نشد',
      meaning: 'فایل، پروژه یا آیتم مورد نظر وجود ندارد.',
      fix: 'لیست را بروزرسانی کنید؛ ممکن است فایل حذف شده یا نام پروژه تغییر کرده باشد.',
    };
  }

  if (/خالی|empty_prompt/i.test(low)) {
    return {
      code: 'EMPTY_PROMPT',
      title: 'پیام خالی',
      meaning: 'متن درخواست کدنویسی خالی است.',
      fix: 'متن درخواست را در فیلد ورودی بنویسید و دکمه اجرا را بزنید.',
    };
  }

  if (/محدودیت|rate limit/i.test(low) || status === 429) {
    return {
      code: 'RATE_LIMIT',
      title: 'محدودیت تعداد درخواست',
      meaning: 'سقف تعداد درخواست‌های به سرویس هوش مصنوعی عبور شد.',
      fix: 'چند دقیقه صبر کنید یا سرویس/مدل رایگان دیگر (مثل LLM7 یا OpenCode) را انتخاب کنید.',
    };
  }

  if (/opencode/i.test(low)) {
    return {
      code: 'OPENCODE_SYNC',
      title: 'دریافت مدل‌های OpenCode شکست خورد',
      meaning: 'لیست زنده مدل‌های رایگان از opencode.ai دریافت نشد.',
      fix: 'اتصال اینترنت را بررسی کنید. مدل‌های پیش‌فرض همچنان قابل استفاده‌اند؛ برای سقف بالاتر کلید رایگان را از https://opencode.ai/auth ثبت کنید.',
    };
  }

  if (/agent_error|خطا در اجرای ایجنت/i.test(low)) {
    return {
      code: 'AGENT_ERROR',
      title: 'خطای سرویس هوش مصنوعی',
      meaning:
        'ارتباط با مدل هوش مصنوعی با خطا مواجه شد (کلید نامعتبر، آدرس سرور اشتباه یا پاسخ نامعتبر مدل).',
      fix:
        'در بخش تنظیمات کلید API و آدرس سرور را بررسی کنید؛ برای تست سریع بدون کلید، سرویس LLM7 یا OpenCode را انتخاب کنید.',
    };
  }

  if (status && status >= 500) {
    return {
      code: 'SERVER',
      title: 'خطای سرور',
      meaning: 'خطایی در سرور تلگرام سرلس رخ داد.',
      fix: 'بعداً دوباره امتحان کنید؛ در صورت تکرار، متن خطا را به پشتیبانی @webxplusx بفرستید.',
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'خطای ناشناخته',
    meaning: msg || 'خطایی رخ داد.',
    fix: 'متن خطا را کپی کرده و به توسعه‌دهنده (@webxplusx) بفرستید.',
  };
}

function showError(err, blocking = true) {
  const c = classifyError(err);
  console.error(`[Ahwaz][${c.code}]`, err);
  const text = `❌ ${c.title}\n\n${c.meaning}\n\n🔧 ${c.fix}`;
  if (blocking && tg?.showAlert) {
    tg.HapticFeedback?.notificationOccurred?.('error');
    return tg.showAlert(text);
  }
  showToast(`❌ ${c.title}: ${c.meaning}`);
}

function showSuccess(msg) {
  showToast(`✅ ${msg}`);
  haptic();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

/*───────────────────────── DOM refs ──*/
const el = {
  providerSelect: document.getElementById('providerSelect'),
  modelSelect: document.getElementById('modelSelect'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnHeaderBack: document.getElementById('btnHeaderBack'),
  btnEditorBack: document.getElementById('btnEditorBack'),
  providersGrid: document.getElementById('providersGrid'),
  btnSyncOpenCode: document.getElementById('btnSyncOpenCode'),
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
  editorPath: document.getElementById('editorPath'),
  editorContent: document.getElementById('editorContent'),
  btnSaveFile: document.getElementById('btnSaveFile'),
  btnDeleteFile: document.getElementById('btnDeleteFile'),
  toast: document.getElementById('toast'),
  helpGrid: document.getElementById('helpGrid'),
};

let appState = {
  activeTab: 'agent',
  providers: [],
  providerHelp: [],
  activeProvider: 'opencode',
  activeModel: 'big-pickle',
  activeProject: 'default',
  projects: [],
  files: [],
  user: {},
};

/*───────────────────────── Tabs & native buttons ──*/
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const active = panel.id === `panel-${tabName}`;
    panel.classList.toggle('active', active);
    panel.classList.toggle('panel-mainbtn', active && (tabName === 'agent' || tabName === 'editor'));
  });
  appState.activeTab = tabName;
  updateMainButton(tabName);
  updateBackButton(tabName);
  if (tabName === 'settings') renderProviders();
  if (tabName === 'help') renderHelp();
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
  if (!tg?.BackButton) return;
  if (tab === 'agent') tg.BackButton.hide();
  else tg.BackButton.show();
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

el.btnHeaderBack.addEventListener('click', () => {
  switchTab('agent');
});
el.btnEditorBack.addEventListener('click', () => {
  switchTab('agent');
});

/*───────────────────────── Providers & models ──*/
function getProviderObj(id) {
  return appState.providers.find((p) => p.id === id) || appState.providers[0];
}

function renderProviderAndModels() {
  el.providerSelect.innerHTML = '';
  for (const p of appState.providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.shortBadge;
    if (p.id === appState.activeProvider) opt.selected = true;
    el.providerSelect.appendChild(opt);
  }

  const spec = getProviderObj(appState.activeProvider);
  el.modelSelect.innerHTML = '';
  if (spec) {
    const models = [...(spec.models || [])];
    if (!models.some((m) => m.id === appState.activeModel)) {
      models.unshift({ id: appState.activeModel, label: appState.activeModel });
    }
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === appState.activeModel) opt.selected = true;
      el.modelSelect.appendChild(opt);
    }
  }
}

function renderProviders() {
  const grid = el.providersGrid;
  grid.innerHTML = '';
  const activeProvider = appState.activeProvider;
  for (const spec of appState.providers) {
    const active = spec.id === activeProvider;
    const ready = Boolean(spec.isReady);
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.innerHTML = providerCardHtml(spec, active, ready);
    grid.appendChild(card);
  }
}

function providerCardHtml(spec, active, ready) {
  const chip = ready
    ? '<span class="status status-ok">✅ فعال</span>'
    : '<span class="status status-need">⚠️ نیاز به تنظیم</span>';
  const missing = spec.missingReason
    ? `<div class="provider-missing">${escapeHtml(spec.missingReason)}</div>`
    : '';

  // Build fields HTML separately so we can insert a key-toggle for password inputs
  let apiKeyHtml = '';
  if (spec.requiresKey) {
    const placeholder = spec.apiKeyConfigured
      ? 'کلید API (فعلی مخفی است)'
      : 'کلید API را وارد کنید';
    apiKeyHtml = `
      <div class="provider-row key-input-wrapper" style="position:relative;">
        <input type="password" data-field="apiKey" dir="ltr" placeholder="${escapeHtml(placeholder)}" />
        <button class="key-toggle" data-toggle-key="${escapeHtml(spec.id)}" title="نمایش/مخفی کردن کلید">👁️</button>
      </div>
    `;
  }

  let baseUrlHtml = '';
  if (spec.requiresBaseUrl) {
    baseUrlHtml = `<input type="url" data-field="baseUrl" dir="ltr" placeholder="آدرس سرور${spec.defaultBaseUrl ? ` (مثلاً ${spec.defaultBaseUrl})` : ''}" />`;
  }

  const modelOptions = spec.models
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}" ${
          m.id === appState.activeModel ? 'selected' : ''
        }>${escapeHtml(m.label)}</option>`
    )
    .join('');

  const modelHtml = `<select data-field="model">${modelOptions}</select>`;

  const btnLabel = active ? 'فعال‌سازی و ذخیره' : 'ذخیره برای این سرویس';
  const btnDisabled = !spec.requiresKey && !spec.requiresBaseUrl && ready;

  return `
    <div class="provider-card${active ? ' active' : ''}">
      <div class="provider-head">
        <div class="provider-info">
          <div class="provider-name">${escapeHtml(spec.shortBadge)}</div>
          <div class="provider-meta">${escapeHtml(spec.title)} · ${spec.protocol}</div>
        </div>
        ${chip}
      </div>
      ${missing}
      <div class="provider-fields">
        ${apiKeyHtml}${baseUrlHtml}
        <div class="provider-row">${modelHtml}</div>
        <div class="provider-row"><button class="btn-sm" data-provider="${escapeHtml(
    spec.id
  )}"${btnDisabled ? ' disabled' : ''}>${btnLabel}</button></div>
      </div>
      <a class="provider-help-link" data-help-provider="${escapeHtml(
        spec.id
      )}">📘 راهنمای اتصال به ${escapeHtml(spec.title)}</a>
    </div>
  `;
}

el.providersGrid.addEventListener('click', async (e) => {
  // Key show/hide toggle
  const keyToggle = e.target.closest('button[data-toggle-key]');
  if (keyToggle) {
    const providerId = keyToggle.dataset.toggleKey;
    const card = keyToggle.closest('.provider-card');
    const input = card.querySelector('[data-field="apiKey"]');
    if (input) {
      if (input.type === 'password') {
        input.type = 'text';
        keyToggle.textContent = '🙈';
        keyToggle.title = 'مخفی کردن کلید';
      } else {
        input.type = 'password';
        keyToggle.textContent = '👁️';
        keyToggle.title = 'نمایش کلید';
      }
    }
    return;
  }

  const saveBtn = e.target.closest('button[data-provider]');
  if (saveBtn) {
    const providerId = saveBtn.dataset.provider;
    const card = saveBtn.closest('.provider-card');
    const apiKeyInput = card.querySelector('[data-field="apiKey"]');
    const baseUrlInput = card.querySelector('[data-field="baseUrl"]');
    const modelSelect = card.querySelector('[data-field="model"]');
    const payload = {
      action: 'setProvider',
      providerId,
      apiKey: apiKeyInput ? (apiKeyInput.value.trim() || undefined) : undefined,
      baseUrl: baseUrlInput
        ? baseUrlInput.value.trim() || undefined
        : undefined,
      model: modelSelect ? modelSelect.value.trim() || undefined : undefined,
    };
    try {
      const res = await callServerlessEndpoint('studio', payload);
      appState.activeProvider = res.provider;
      appState.activeModel = res.model;
      renderProviderAndModels();
      renderProviders();
      showSuccess(`تنظیمات ${res.provider} ذخیره شد`);
    } catch (err) {
      showError(err);
    }
    return;
  }

  const helpLink = e.target.closest('[data-help-provider]');
  if (helpLink) {
    switchTab('help');
    const target = document.getElementById(`help-${helpLink.dataset.helpProvider}`);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
    return;
  }
});

/*───────────────────────── Help panel ──*/
function renderHelp() {
  const grid = el.helpGrid;
  grid.innerHTML = '';
  for (const h of appState.providerHelp) {
    grid.appendChild(helpCardHtml(h));
  }
  const hash = window.location.hash;
  if (hash) {
    const target = document.getElementById(hash.slice(1));
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 50);
  }
}

function helpCardHtml(h) {
  const div = document.createElement('div');
  div.className = 'help-card';
  div.id = `help-${h.id}`;
  const tag = h.keyless
    ? '<span class="tag tag-ok">🆓 بدون کلید (رایگان)</span>'
    : '<span class="tag tag-need">🔑 نیاز به کلید API</span>';
  const steps = (h.steps || [])
    .map((s, i) => `<div>${i + 1}) ${escapeHtml(s)}</div>`)
    .join('');
  const linksHtml = (h.links || []).length
    ? (h.links || []).map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">🔗 ${escapeHtml(l.label)}</a>`).join(' ')
    : '<span style="color: var(--tg-muted)">بدون لینک ثبت‌نام ثابت</span>';
  const cmds = (h.commands || []).length
    ? `<div class="help-cmd">${(h.commands || []).join(' · ')}</div>`
    : '';
  div.innerHTML = `
    <div class="help-head">
      <div class="help-name">${escapeHtml(h.title)}</div>
      ${tag}
    </div>
    <div class="help-desc">${escapeHtml(h.summary)}</div>
    <div class="help-steps">${steps}</div>
    ${cmds}
    <div class="help-links">${linksHtml}</div>
    ${h.note ? `<div class="help-note">💡 ${escapeHtml(h.note)}</div>` : ''}
  `;
  return div;
}

/*───────────────────────── State ──*/
function renderState(state) {
  if (state.providers) appState.providers = state.providers;
  if (state.providerHelp) appState.providerHelp = state.providerHelp;
  if (state.user) appState.user = state.user;
  if (state.user?.provider) appState.activeProvider = state.user.provider;
  if (state.user?.model) appState.activeModel = state.user.model;
  appState.activeProject = state.activeProject || appState.activeProject;
  appState.projects = state.projects || appState.projects;
  appState.files = state.files || [];

  renderProviderAndModels();
  el.tabFilesCount.textContent = String(appState.files.length);

  el.projectSelect.innerHTML = '';
  for (const proj of appState.projects) {
    const opt = document.createElement('option');
    opt.value = proj.name;
    opt.textContent = `📁 ${proj.name}`;
    if (proj.name === appState.activeProject) opt.selected = true;
    el.projectSelect.appendChild(opt);
  }

  el.fileCount.textContent = String(appState.files.length);
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

async function loadInitialState() {
  try {
    const data = await callServerlessEndpoint('studio', { action: 'state' });
    renderState(data);
  } catch (err) {
    showError(err);
  }
}

/*───────────────────────── Files ──*/
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

/*───────────────────────── Provider / model switching ──*/
el.providerSelect.addEventListener('change', async () => {
  const nextProv = el.providerSelect.value;
  try {
    const res = await callServerlessEndpoint('studio', {
      action: 'setProvider',
      providerId: nextProv,
    });
    appState.activeProvider = res.provider;
    appState.activeModel = res.model;
    renderProviderAndModels();
    renderProviders();
    showSuccess(`سرویس فعال: ${res.provider} (${res.model})`);
  } catch (err) {
    showError(err);
  }
});

el.modelSelect.addEventListener('change', async () => {
  try {
    const model = el.modelSelect.value;
    await callServerlessEndpoint('studio', { action: 'setModel', model });
    appState.activeModel = model;
    showSuccess(`مدل فعال: ${model}`);
  } catch (err) {
    showError(err);
  }
});

el.btnSyncOpenCode.addEventListener('click', async () => {
  try {
    showToast('🔄 استعلام زنده از opencode.ai...');
    const res = await callServerlessEndpoint('studio', { action: 'syncOpenCodeModels' });
    const oc = appState.providers.find((p) => p.id === 'opencode');
    if (oc && Array.isArray(res.models)) {
      oc.models = res.models;
    }
    appState.activeProvider = 'opencode';
    renderProviderAndModels();
    renderProviders();
    showSuccess(`${res.models.length} مدل رایگان OpenCode دریافت شد!`);
  } catch (err) {
    showError(err);
  }
});

/*───────────────────────── Projects & files ──*/
el.projectSelect.addEventListener('change', async () => {
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

el.btnNewProject.addEventListener('click', async () => {
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

el.btnCreateFile.addEventListener('click', () => {
  el.editorPath.value = 'src/new-file.js';
  el.editorContent.value = '';
  switchTab('editor');
});

el.btnRefresh.addEventListener('click', loadInitialState);
el.btnRefreshFiles.addEventListener('click', loadInitialState);

el.btnSaveFile.addEventListener('click', async () => {
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

el.btnDeleteFile.addEventListener('click', async () => {
  const path = el.editorPath.value.trim();
  if (!path) return;
  const confirmed = tg?.showConfirm
    ? await tg.showConfirm(`آیا مطمئن هستید که فایل «${path}» حذف شود؟`)
    : window.confirm(`پاک کردن فایل ${path}؟`);
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

el.btnExportZip.addEventListener('click', async () => {
  try {
    showToast('📦 در حال ارسال ZIP به چت تلگرام...');
    await callServerlessEndpoint('studio', { action: 'exportZipToChat' });
    showSuccess('فایل ZIP به چت شما ارسال شد!');
  } catch (err) {
    showError(err);
  }
});

/*───────────────────────── Agent prompt ──*/
el.promptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = el.promptInput.value.trim();
  if (!prompt) return;

  el.promptInput.value = '';
  appendMessage('user', prompt);
  el.btnRunAgent.disabled = true;
  el.btnRunAgent.textContent = '⏳...';
  updateMainButton(appState.activeTab);

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
    showError(err);
  } finally {
    el.btnRunAgent.disabled = false;
    el.btnRunAgent.textContent = 'اجرا 🚀';
    updateMainButton(appState.activeTab);
  }
});

/*───────────────────────── Boot ──*/
updateMainButton(appState.activeTab);
updateBackButton(appState.activeTab);
loadInitialState();
