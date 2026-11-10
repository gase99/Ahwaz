import { RECOMMENDED_MODELS } from './auth-service.js';

export function buildMainDashboardKeyboard(miniAppUrl = null) {
  const rows = [
    [
      { text: '📁 فایل‌های پروژه', callback_data: 'cb:files' },
      { text: '📦 خروجی ZIP پروژه', callback_data: 'cb:zip' },
    ],
    [
      { text: '🗂 تغییر پروژه', callback_data: 'cb:projects' },
      { text: '🤖 تغییر مدل Gemini', callback_data: 'cb:models' },
    ],
    [
      { text: '📊 وضعیت سرویس', callback_data: 'cb:status' },
      { text: '🧹 پاکسازی حافظه چت', callback_data: 'cb:reset' },
    ],
  ];

  if (miniAppUrl && miniAppUrl.startsWith('https://')) {
    rows.unshift([
      {
        text: '🖥 باز کردن Code Studio (Mini App)',
        web_app: { url: miniAppUrl },
      },
    ]);
  }

  return { inline_keyboard: rows };
}

export function buildAfterReplyKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📁 فایل‌ها', callback_data: 'cb:files' },
        { text: '📦 دانلود ZIP پروژه', callback_data: 'cb:zip' },
      ],
    ],
  };
}

export function buildModelSelectorKeyboard(currentModel) {
  return {
    inline_keyboard: RECOMMENDED_MODELS.map((m) => [
      {
        text: `${m.id === currentModel ? '✅ ' : ''}${m.label}`,
        callback_data: `cb:set_model:${m.id}`,
      },
    ]),
  };
}

export function buildProjectsKeyboard(projectList, activeProject) {
  return {
    inline_keyboard: projectList.slice(0, 12).map((p) => [
      {
        text: `${p.name === activeProject ? '✅ ' : '📂 '}${p.name} (${p.fileCount} فایل)`,
        callback_data: `cb:switch_proj:${p.name}`,
      },
    ]),
  };
}
