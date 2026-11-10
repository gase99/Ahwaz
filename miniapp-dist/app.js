const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

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

const el = {
  providerSelect: document.getElementById('providerSelect'),
  modelSelect: document.getElementById('modelSelect'),
  btnProviderCfg: document.getElementById('btnProviderCfg'),
  cfgModal: document.getElementById('cfgModal'),
  cfgTitle: document.getElementById('cfgTitle'),
  cfgHint: document.getElementById('cfgHint'),
  cfgBaseUrl: document.getElementById('cfgBaseUrl'),
  cfgApiKey: document.getElementById('cfgApiKey'),
  cfgCustomModel: document.getElementById('cfgCustomModel'),
  btnSyncOpenCode: document.getElementById('btnSyncOpenCode'),
  btnSaveCfg: document.getElementById('btnSaveCfg'),
  btnCloseCfg: document.getElementById('btnCloseCfg'),
  projectSelect: document.getElementById('projectSelect'),
  btnNewProject: document.getElementById('btnNewProject'),
  btnExportZip: document.getElementById('btnExportZip'),
  fileCount: document.getElementById('fileCount'),
  fileList: document.getElementById('fileList'),
  agentLog: document.getElementById('agentLog'),
  promptForm: document.getElementById('promptForm'),
  promptInput: document.getElementById('promptInput'),
  btnRunAgent: document.getElementById('btnRunAgent'),
  btnCreateFile: document.getElementById('btnCreateFile'),
  btnRefresh: document.getElementById('btnRefresh'),
  editorPath: document.getElementById('editorPath'),
  editorContent: document.getElementById('editorContent'),
  btnSaveFile: document.getElementById('btnSaveFile'),
  btnDeleteFile: document.getElementById('btnDeleteFile'),
  toast: document.getElementById('toast'),
};

let appState = {
  providers: [],
  activeProvider: 'opencode',
  activeModel: 'big-pickle',
  activeProject: 'default',
  projects: [],
  files: [],
};

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

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
    el.cfgTitle.textContent = `⚙️ ${spec.title}`;
    el.cfgHint.textContent = spec.signupHint || '';
  }
}

function renderState(state) {
  if (state.providers) appState.providers = state.providers;
  if (state.user?.provider) appState.activeProvider = state.user.provider;
  if (state.user?.model) appState.activeModel = state.user.model;
  appState.activeProject = state.activeProject || appState.activeProject;
  appState.projects = state.projects || appState.projects;
  appState.files = state.files || [];

  renderProviderAndModels();

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
      li.innerHTML = `<span>📄 ${f.path}</span><span class="file-size">${f.sizeBytes} B</span>`;
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
    appendMessage('system', `⚠️ ${err.message}`);
  }
}

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
    toolsDiv.textContent = `🛠️ ابزارهای اجراشده:\n${toolLogs.join('\n')}`;
    div.appendChild(toolsDiv);
  }

  el.agentLog.appendChild(div);
  el.agentLog.scrollTop = el.agentLog.scrollHeight;
}

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
    showToast(`🌐 سرویس فعال: ${res.provider} (${res.model})`);
  } catch (err) {
    showToast(err.message);
  }
});

el.modelSelect.addEventListener('change', async () => {
  try {
    const model = el.modelSelect.value;
    await callServerlessEndpoint('studio', { action: 'setModel', model });
    appState.activeModel = model;
    showToast(`🧠 مدل فعال: ${model}`);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnProviderCfg.addEventListener('click', () => {
  el.cfgModal.classList.toggle('hidden');
});

el.btnCloseCfg.addEventListener('click', () => {
  el.cfgModal.classList.add('hidden');
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
    showToast(`✅ ${res.models.length} مدل رایگان OpenCode دریافت شد!`);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnSaveCfg.addEventListener('click', async () => {
  const providerId = el.providerSelect.value;
  const baseUrl = el.cfgBaseUrl.value.trim();
  const apiKey = el.cfgApiKey.value.trim();
  const customModel = el.cfgCustomModel.value.trim();

  try {
    const res = await callServerlessEndpoint('studio', {
      action: 'setProvider',
      providerId,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined,
      model: customModel || undefined,
    });
    appState.activeProvider = res.provider;
    appState.activeModel = res.model;
    el.cfgApiKey.value = '';
    el.cfgModal.classList.add('hidden');
    renderProviderAndModels();
    showToast(`✅ تنظیمات سرویس ${res.provider} ذخیره شد`);
  } catch (err) {
    showToast(err.message);
  }
});

el.promptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = el.promptInput.value.trim();
  if (!prompt) return;

  el.promptInput.value = '';
  appendMessage('user', prompt);
  el.btnRunAgent.disabled = true;
  el.btnRunAgent.textContent = '⏳...';

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
    appendMessage('system', `❌ خطا: ${err.message}`);
  } finally {
    el.btnRunAgent.disabled = false;
    el.btnRunAgent.textContent = 'اجرا 🚀';
  }
});

el.projectSelect.addEventListener('change', async () => {
  try {
    const data = await callServerlessEndpoint('studio', {
      action: 'switchProject',
      projectName: el.projectSelect.value,
    });
    renderState(data);
    showToast(`پروژه فعال: ${data.activeProject}`);
  } catch (err) {
    showToast(err.message);
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
    showToast(`پروژه ${data.activeProject} ساخته شد`);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnCreateFile.addEventListener('click', () => {
  el.editorPath.value = 'src/new-file.js';
  el.editorContent.value = '';
  switchTab('editor');
});

el.btnRefresh.addEventListener('click', loadInitialState);

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
    showToast(`✅ فایل ${data.path} ذخیره شد`);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnDeleteFile.addEventListener('click', async () => {
  const path = el.editorPath.value.trim();
  if (!path) return;
  try {
    const data = await callServerlessEndpoint('studio', { action: 'deleteFile', path });
    el.editorPath.value = '';
    el.editorContent.value = '';
    renderState({ activeProject: appState.activeProject, files: data.files });
    switchTab('files');
    showToast('🗑️ فایل حذف شد');
  } catch (err) {
    showToast(err.message);
  }
});

el.btnExportZip.addEventListener('click', async () => {
  try {
    showToast('📦 در حال ارسال ZIP به چت تلگرام...');
    await callServerlessEndpoint('studio', { action: 'exportZipToChat' });
    showToast('✅ فایل ZIP به چت شما ارسال شد!');
  } catch (err) {
    showToast(err.message);
  }
});

loadInitialState();
