import { getProviderSpec, PROVIDER_LIST } from '../agent/providers.js';

function formatModelButtonIcon(m) {
  const icons = [];
  if (m.recommended) icons.push('⭐');
  icons.push(m.free !== false ? '🆓' : '💰');
  if (m.tier === 'fast') icons.push('⚡');
  else if (m.tier === 'smart') icons.push('🧠');
  return icons.join('');
}

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
      { text: '🔑 کلیدها و تست اتصال (/keys)', callback_data: 'cb:keys' },
      { text: '🤖 انتخاب مدل (/model)', callback_data: 'cb:models_grouped' },
    ],
    [
      { text: '🌐 سرویس‌های هوش مصنوعی', callback_data: 'cb:providers' },
      { text: '📘 راهنمای دریافت کلید', callback_data: 'cb:guide_all' },
    ],
    [
      { text: '📁 پروژه‌ها', callback_data: 'cb:projects' },
      { text: '📂 فایل‌های پروژه', callback_data: 'cb:files' },
    ],
    [
      { text: '📦 دانلود ZIP پروژه', callback_data: 'cb:zip' },
      { text: '🧹 پاکسازی حافظه چت', callback_data: 'cb:clear' },
    ],
    [{ text: '📊 وضعیت ایجنت', callback_data: 'cb:status' }],
  );

  return { inline_keyboard: rows };
}

export function buildProvidersKeyboard(activeProvider, providerStatus = null) {
  const rows = [];
  for (let i = 0; i < PROVIDER_LIST.length; i += 2) {
    const pair = PROVIDER_LIST.slice(i, i + 2).map((p) => {
      const isActive = p.id === activeProvider;
      const status = providerStatus?.[p.id];
      const badge = status
        ? status.status === 'invalid' || !status.isReady
          ? '⚠️ '
          : '✅ '
        : '';
      return {
        text: `${badge}${isActive ? '🟢 ' : ''}${p.shortBadge}`,
        callback_data: `cb:prov:${p.id}`,
      };
    });
    rows.push(pair);
  }
  rows.push([
    { text: '🔑 مدیریت و تست کلیدها (/keys)', callback_data: 'cb:keys' },
  ]);
  rows.push([{ text: '📘 راهنمای اتصال همه سرویس‌ها', callback_data: 'cb:guide_all' }]);
  rows.push([{ text: '🔙 بازگشت به داشبورد اصلی', callback_data: 'cb:home' }]);
  return { inline_keyboard: rows };
}

/**
 * Grouped inline keyboard for `/model` (without arguments):
 * Groups models by provider with live connection status + direct featured model picks.
 */
export function buildGroupedModelsKeyboard(providersSnapshot, activeProvider, currentModel) {
  const rows = [];

  // Show active provider's top models first for 1-click switching
  const activeSpec =
    providersSnapshot.find((p) => p.id === activeProvider) || getProviderSpec(activeProvider);
  rows.push([
    {
      text: `📂 دسته فعال: ${activeSpec.shortBadge} — مشاهده همه مدل‌ها`,
      callback_data: `cb:mprov:${activeSpec.id}`,
    },
  ]);

  for (const m of (activeSpec.models || []).slice(0, 4)) {
    const isSel = activeSpec.id === activeProvider && m.id === currentModel;
    const cbData = `cb:model:${m.id}`;
    if (cbData.length <= 64) {
      rows.push([
        {
          text: `${isSel ? '✅ ' : ''}${formatModelButtonIcon(m)} ${m.id}`.slice(0, 60),
          callback_data: cbData,
        },
      ]);
    }
  }

  // Group buttons for all other providers (2 per row) with connection badge + model count
  const others = providersSnapshot.filter((p) => p.id !== activeProvider);
  for (let i = 0; i < others.length; i += 2) {
    const pair = others.slice(i, i + 2).map((p) => {
      const icon =
        p.status === 'invalid' ? '⚠️' : p.isReady ? '✅' : '❌';
      const count = (p.models || []).length;
      return {
        text: `${icon} ${p.shortBadge} (${count})`.slice(0, 60),
        callback_data: `cb:mprov:${p.id}`,
      };
    });
    rows.push(pair);
  }

  rows.push([
    { text: '📋 لیست متنی کامل همه مدل‌ها', callback_data: 'cb:model_list_text' },
  ]);
  rows.push([{ text: '🔙 بازگشت به داشبورد اصلی', callback_data: 'cb:home' }]);

  return { inline_keyboard: rows };
}

export function buildModelsKeyboard(providerId, currentModel, customModels = null) {
  const spec = getProviderSpec(providerId);
  const models =
    Array.isArray(customModels) && customModels.length > 0 ? customModels : spec.models;

  const rows = models.slice(0, 12).map((m, idx) => {
    const icons = formatModelButtonIcon(m);
    const directCb = `cb:pmodel:${spec.id}:${m.id}`;
    // Stay strictly under Telegram's 64-byte callback_data limit even for long OpenRouter IDs
    const safeCb = directCb.length <= 64 ? directCb : `cb:pmidx:${spec.id}:${idx}`;
    return [
      {
        text: `${m.id === currentModel ? '✅ ' : ''}${icons} ${m.label || m.id}`.slice(0, 60),
        callback_data: safeCb,
      },
    ];
  });

  if (spec.id === 'opencode') {
    rows.push([
      {
        text: '🔄 دریافت زنده مدل‌های رایگان از opencode.ai',
        callback_data: 'cb:sync_opencode',
      },
    ]);
  } else if (spec.id === 'openrouter') {
    rows.push([
      {
        text: '🔄 دریافت زنده مدل‌های :free از OpenRouter',
        callback_data: 'cb:sync_openrouter',
      },
    ]);
  }

  rows.push([
    { text: '🗂️ دسته‌بندی همه سرویس‌ها (/model)', callback_data: 'cb:models_grouped' },
  ]);
  rows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'cb:home' }]);

  return { inline_keyboard: rows };
}

/**
 * Inline keyboard for `/keys`: per-provider Test & Delete actions.
 */
export function buildKeysManagementKeyboard(providersSnapshot, miniAppUrl = '') {
  const rows = [];

  if (miniAppUrl && miniAppUrl.startsWith('https://')) {
    rows.push([
      {
        text: '🔑 مدیریت گرافیکی کلیدها در Mini App',
        web_app: { url: miniAppUrl },
      },
    ]);
  }

  for (const p of providersSnapshot) {
    const hasStoredSecret = Boolean(p.apiKeyConfigured || (p.requiresBaseUrl && p.baseUrl));
    if (hasStoredSecret) {
      rows.push([
        {
          text: `⚡ تست ${p.shortBadge}`.slice(0, 40),
          callback_data: `cb:ktest:${p.id}`,
        },
        {
          text: `🗑️ حذف کلید ${p.id}`.slice(0, 40),
          callback_data: `cb:kdel:${p.id}`,
        },
      ]);
    } else if (!p.requiresKey && !p.requiresBaseUrl) {
      rows.push([
        {
          text: `⚡ تست سرویس رایگان ${p.shortBadge}`,
          callback_data: `cb:ktest:${p.id}`,
        },
      ]);
    }
  }

  rows.push([
    { text: '🔄 بروزرسانی وضعیت', callback_data: 'cb:keys' },
    { text: '🏠 داشبورد اصلی', callback_data: 'cb:home' },
  ]);

  return { inline_keyboard: rows };
}

export function buildProjectsKeyboard(projectList, activeProject) {
  const rows = projectList.slice(0, 12).map((proj) => [
    {
      text: `${proj.name === activeProject ? '🟢 ' : '📁 '}${proj.name}`.slice(0, 60),
      callback_data: `cb:proj:${proj.name}`.slice(0, 64),
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
        { text: '🤖 تغییر مدل / سرویس', callback_data: 'cb:models_grouped' },
        { text: '🔑 کلیدها', callback_data: 'cb:keys' },
      ],
      [{ text: '🏠 داشبورد', callback_data: 'cb:home' }],
    ],
  };
}
