const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

function callEndpoint(name, payload) {
  return new Promise((resolve, reject) => {
    if (!tg?.Serverless?.call) {
      reject(
        new Error(
          'این صفحه باید از داخل دکمه Mini App در تلگرام باز شود تا Telegram.WebApp.Serverless فعال باشد.',
        ),
      );
      return;
    }
    tg.Serverless.call(name, payload, (err, result) => {
      if (err) {
        reject(new Error(err.message || 'خطا در فراخوانی اندپوینت Serverless'));
      } else {
        resolve(result);
      }
    });
  });
}

const els = {
  projectSelect: document.getElementById('projectSelect'),
  newProjectBtn: document.getElementById('newProjectBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  newFileBtn: document.getElementById('newFileBtn'),
  fileList: document.getElementById('fileList'),
  currentFilePath: document.getElementById('currentFilePath'),
  deleteFileBtn: document.getElementById('deleteFileBtn'),
  saveFileBtn: document.getElementById('saveFileBtn'),
  codeEditor: document.getElementById('codeEditor'),
  agentPromptInput: document.getElementById('agentPromptInput'),
  runAgentBtn: document.getElementById('runAgentBtn'),
  agentOutput: document.getElementById('agentOutput'),
  settingsModal: document.getElementById('settingsModal'),
  modelInput: document.getElementById('modelInput'),
  geminiKeyInput: document.getElementById('geminiKeyInput'),
  githubTokenInput: document.getElementById('githubTokenInput'),
  geminiKeyState: document.getElementById('geminiKeyState'),
  githubTokenState: document.getElementById('githubTokenState'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
};

let activeFile = null;

function showBanner(text) {
  els.agentOutput.textContent = text;
  els.agentOutput.classList.remove('hidden');
}

function renderProjects(projects, activeName) {
  els.projectSelect.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = `${p.name} (${p.fileCount})`;
    if (p.name === activeName) opt.selected = true;
    els.projectSelect.appendChild(opt);
  }
}

function renderFiles(files) {
  els.fileList.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = f.path;
    if (f.path === activeFile) li.classList.add('active');
    li.addEventListener('click', () => loadFile(f.path));
    els.fileList.appendChild(li);
  }
}

async function loadFile(filePath) {
  try {
    const res = await callEndpoint('studio', { action: 'read_file', path: filePath });
    activeFile = res.path;
    els.currentFilePath.textContent = res.path;
    els.codeEditor.value = res.content;
    els.saveFileBtn.disabled = false;
    els.deleteFileBtn.disabled = false;
    for (const li of els.fileList.querySelectorAll('li')) {
      li.classList.toggle('active', li.textContent === activeFile);
    }
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
}

async function bootstrap() {
  try {
    const data = await callEndpoint('studio', { action: 'bootstrap' });
    renderProjects(data.projects, data.user.activeProject);
    renderFiles(data.files);
    els.modelInput.value = data.user.model || 'gemini-2.5-pro';
    els.geminiKeyState.textContent = data.hasGeminiKey ? 'ثبت‌شده ✅' : 'ثبت‌نشده ⚠️';
    els.githubTokenState.textContent = data.hasGithubToken ? 'متصل ✅' : 'اختیاری';
    if (data.files.length > 0) {
      await loadFile(data.files[0].path);
    }
  } catch (err) {
    showBanner(`ℹ️ ${err.message}`);
  }
}

els.projectSelect.addEventListener('change', async () => {
  try {
    const res = await callEndpoint('studio', {
      action: 'switch_project',
      projectName: els.projectSelect.value,
    });
    activeFile = null;
    els.currentFilePath.textContent = 'فایلی انتخاب نشده است';
    els.codeEditor.value = '';
    els.saveFileBtn.disabled = true;
    els.deleteFileBtn.disabled = true;
    renderProjects(res.projects, res.activeProject);
    renderFiles(res.files);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
});

els.newProjectBtn.addEventListener('click', async () => {
  const name = window.prompt('نام انگلیسی پروژه جدید (مثلاً shop-api):');
  if (!name) return;
  try {
    const res = await callEndpoint('studio', {
      action: 'switch_project',
      projectName: name.trim(),
    });
    renderProjects(res.projects, res.activeProject);
    renderFiles(res.files);
    showBanner(`✅ پروژه ${res.activeProject} ایجاد و فعال شد.`);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
});

els.newFileBtn.addEventListener('click', async () => {
  const path = window.prompt('مسیر نسبی فایل جدید (مثلاً src/index.js):');
  if (!path) return;
  try {
    const res = await callEndpoint('studio', {
      action: 'save_file',
      path: path.trim(),
      content: '// New file\n',
    });
    renderFiles(res.files);
    await loadFile(res.saved.path);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
});

els.saveFileBtn.addEventListener('click', async () => {
  if (!activeFile) return;
  try {
    els.saveFileBtn.disabled = true;
    const res = await callEndpoint('studio', {
      action: 'save_file',
      path: activeFile,
      content: els.codeEditor.value,
    });
    renderFiles(res.files);
    showBanner(`✅ فایل ${activeFile} ذخیره شد.`);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  } finally {
    els.saveFileBtn.disabled = false;
  }
});

els.deleteFileBtn.addEventListener('click', async () => {
  if (!activeFile || !window.confirm(`آیا فایل ${activeFile} حذف شود؟`)) return;
  try {
    const res = await callEndpoint('studio', {
      action: 'delete_file',
      path: activeFile,
    });
    activeFile = null;
    els.currentFilePath.textContent = 'فایلی انتخاب نشده است';
    els.codeEditor.value = '';
    els.saveFileBtn.disabled = true;
    els.deleteFileBtn.disabled = true;
    renderFiles(res.files);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
});

els.runAgentBtn.addEventListener('click', async () => {
  const prompt = els.agentPromptInput.value.trim();
  if (!prompt) return;
  els.runAgentBtn.disabled = true;
  showBanner('⏳ ایجنت Google Gemini در حال تحلیل و نوشتن کد روی پروژه است...');
  try {
    const res = await callEndpoint('agent', { prompt, notifyChat: false });
    els.agentPromptInput.value = '';
    renderFiles(res.files);
    if (activeFile) {
      await loadFile(activeFile).catch(() => undefined);
    } else if (res.files.length > 0) {
      await loadFile(res.files[0].path).catch(() => undefined);
    }
    showBanner(`✅ پاسخ ایجنت:\n${res.replyText}`);
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  } finally {
    els.runAgentBtn.disabled = false;
  }
});

els.settingsBtn.addEventListener('click', () => {
  els.settingsModal.classList.remove('hidden');
});

els.closeSettingsBtn.addEventListener('click', () => {
  els.settingsModal.classList.add('hidden');
});

els.saveSettingsBtn.addEventListener('click', async () => {
  try {
    await callEndpoint('studio', {
      action: 'save_settings',
      model: els.modelInput.value,
      geminiKey: els.geminiKeyInput.value.trim(),
      githubToken: els.githubTokenInput.value.trim(),
    });
    els.geminiKeyInput.value = '';
    els.githubTokenInput.value = '';
    els.settingsModal.classList.add('hidden');
    await bootstrap();
    showBanner('✅ تنظیمات با موفقیت در SQLite سرور تلگرام ذخیره شد.');
  } catch (err) {
    showBanner(`❌ ${err.message}`);
  }
});

bootstrap();
