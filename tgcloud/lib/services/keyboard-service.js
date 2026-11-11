import { getProviderSpec, PROVIDER_LIST } from '../agent/providers.js';

export function buildMainDashboardKeyboard(miniAppUrl = '') {
  const rows = [];

  if (miniAppUrl && miniAppUrl.startsWith('https://')) {
    rows.push([
      {
        text: '🚀 باز کردن Code Studio (Mini App)',
        web_app: { url: miniAppUrl },
      },
    ]);
  }

  rows.push(
    [
      { text: '🆓 سرویس‌ها (OpenCode / FreeLLM)', callback_data: 'cb:providers' },
      { text: '🤖 انتخاب مدل', callback_data: 'cb:models' },
    ],
    [
      { text: '📁 پروژه‌ها', callback_data: 'cb:projects' },
      { text: '📂 فایل‌های پروژه', callback_data: 'cb:files' },
    ],
    [
      { text: '📦 دانلود ZIP پروژه', callback_data: 'cb:zip' },
      { text: '🧹 پاکسازی حافظه چت', callback_data: 'cb:clear' },
    ],
    [{ text: '📊 وضعیت ایجنت و راهنما', callback_data: 'cb:status' }],
  );

  return { inline_keyboard: rows };
}

export function buildProvidersKeyboard(activeProvider, providerStatus = null) {
  const rows = [];
  for (let i = 0; i < PROVIDER_LIST.length; i += 2) {
    const pair = PROVIDER_LIST.slice(i, i + 2).map((p) => {
      const isActive = p.id === activeProvider;
      const status = providerStatus?.[p.id];
      const ready = status ? (status.isReady ? '✅' : '⚠️') : '';
      return {
        text: `${ready}${isActive ? '🟢 ' : ''}${p.shortBadge}`,
        callback_data: `cb:prov:${p.id}`,
      };
    });
    rows.push(pair);
  }
  rows.push([{ text: '📘 راهنمای اتصال همه سرویس‌ها', callback_data: 'cb:guide_all' }]);
  rows.push([{ text: '🔙 بازگشت به داشبورد اصلی', callback_data: 'cb:home' }]);
  return { inline_keyboard: rows };
}

export function buildModelsKeyboard(providerId, currentModel, customModels = null) {
  const spec = getProviderSpec(providerId);
  const models = Array.isArray(customModels) && customModels.length > 0 ? customModels : spec.models;

  const rows = models.slice(0, 12).map((m) => [
    {
      text: `${m.id === currentModel ? '✅ ' : ''}${m.label}`.slice(0, 60),
      callback_data: `cb:model:${m.id}`.slice(0, 64),
    },
  ]);

  if (spec.id === 'opencode') {
    rows.push([
      {
        text: '🔄 دریافت زنده مدل‌های رایگان از opencode.ai',
        callback_data: 'cb:sync_opencode',
      },
    ]);
  }

  rows.push([
    { text: '🌐 تغییر سرویس (OpenCode / FreeLLM / ...)', callback_data: 'cb:providers' },
  ]);
  rows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'cb:home' }]);

  return { inline_keyboard: rows };
}

export function buildProjectsKeyboard(projectList, activeProject) {
  const rows = projectList.slice(0, 12).map((proj) => [
    {
      text: `${proj.name === activeProject ? '🟢 ' : '📁 '}${proj.name}`,
      callback_data: `cb:proj:${proj.name}`,
    },
  ]);
  rows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'cb:home' }]);
  return { inline_keyboard: rows };
}

export function buildPostAnswerKeyboard(projectName) {
  return {
    inline_keyboard: [
      [
        { text: `📂 فایل‌ها (${projectName})`, callback_data: 'cb:files' },
        { text: '📦 خروجی ZIP', callback_data: 'cb:zip' },
      ],
      [
        { text: '🆓 تغییر مدل / سرویس', callback_data: 'cb:models' },
        { text: '🏠 داشبورد', callback_data: 'cb:home' },
      ],
    ],
  };
}
