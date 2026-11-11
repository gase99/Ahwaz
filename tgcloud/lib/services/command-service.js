import { api } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  getProviderSpec,
  inferProviderFromApiKey,
  PROVIDER_HELP,
  PROVIDER_LIST,
  PROVIDERS,
} from '../agent/providers.js';
import {
  buildUserProvidersSnapshot,
  countStoredUserKeys,
  deleteProviderCredentials,
  getSetting,
  resolveGithubToken,
  resolveProviderAuth,
  saveProviderCredentials,
  saveUserGithubToken,
  setActiveModel,
  setActiveProject,
  setActiveProviderAndModel,
  setSetting,
  setUserAccess,
} from './auth-service.js';
import { clearConversationHistory } from './conversation-service.js';
import { sendDocumentBytes, sendSafeText } from './delivery-service.js';
import {
  importGithubRepoToWorkspace,
  pushWorkspaceToGithub,
} from './github-service.js';
import {
  buildGroupedModelsKeyboard,
  buildKeysManagementKeyboard,
  buildMainDashboardKeyboard,
  buildModelsKeyboard,
  buildProjectsKeyboard,
  buildProvidersKeyboard,
} from './keyboard-service.js';
import { testProviderConnection } from './key-test-service.js';
import {
  ensureProject,
  exportProjectZipBytes,
  listProjects,
  listWorkspaceFiles,
  readWorkspaceFile,
  sanitizeProjectName,
} from './workspace-service.js';

const BOT_COMMANDS_MENU = [
  { command: 'start', description: 'داشبورد ایجنت و وضعیت سرویس‌ها' },
  { command: 'keys', description: 'وضعیت کلیدهای API، تست اتصال و حذف کلید' },
  { command: 'model', description: 'انتخاب مدل گروه‌بندی‌شده یا /model list' },
  { command: 'provider', description: 'انتخاب سرویس رایگان (OpenCode / FreeLLM / Gemini)' },
  { command: 'opencode', description: 'مدل‌های رایگان کدنویسی OpenCode Zen' },
  { command: 'freellm', description: 'اتصال به روتر FreeLLMAPI یا ApiFreeLLM' },
  { command: 'guide', description: 'راهنمای اتصال و دریافت کلید رایگان' },
  { command: 'project', description: 'مدیریت پروژه‌ها در SQLite' },
  { command: 'files', description: 'مشاهده فایل‌های پروژه فعال' },
  { command: 'zip', description: 'دانلود کل پروژه به صورت فایل ZIP' },
  { command: 'clear', description: 'پاکسازی حافظه چت پروژه' },
  { command: 'status', description: 'مشاهده آمار و وضعیت ایجنت' },
];

async function tryDeleteSecretMessage(chatId, messageId) {
  try {
    await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  } catch {
    // Ignore if chat does not grant delete permission
  }
}

export async function deliverProjectZip(chatId, tgId, projectName) {
  const { zipBytes, count } = await exportProjectZipBytes(tgId, projectName);
  if (!zipBytes || count === 0) {
    await sendSafeText(chatId, `⚠️ پروژه \`${projectName}\` خالی است و فایلی برای ساخت ZIP ندارد.`);
    return { ok: false, count: 0 };
  }
  await sendDocumentBytes({
    chatId,
    bytes: zipBytes,
    fileName: `${projectName}.zip`,
    mimeType: 'application/zip',
    caption: `📦 آرشیو پروژه «${projectName}» شامل ${count} فایل`,
  });
  return { ok: true, count };
}

/**
 * Builds the formatted `/keys` status overview text + snapshot for both slash commands & inline callbacks.
 */
export async function buildKeysDashboardReport(userRow) {
  const [providersSnapshot, storedKeysCount] = await Promise.all([
    buildUserProvidersSnapshot(userRow),
    countStoredUserKeys(userRow.tgId),
  ]);

  const connectedCount = providersSnapshot.filter(
    (p) => p.status !== 'invalid' && p.isReady,
  ).length;
  const invalidCount = providersSnapshot.filter((p) => p.status === 'invalid').length;

  const lines = [
    `🔌 **وضعیت کلیدهای API و اتصال سرویس‌ها**`,
    `• سرویس‌های آماده اتصال: **${connectedCount} از ${providersSnapshot.length}**`,
    `• کلیدهای ذخیره‌شده در دیتابیس SQLite: **${storedKeysCount}**`,
    ...(invalidCount > 0 ? [`• ⚠️ نیازمند بررسی مجدد: **${invalidCount}**`] : []),
    ``,
  ];

  for (const p of providersSnapshot) {
    const isActive = p.id === (userRow.provider || 'opencode');
    const badge =
      p.status === 'invalid'
        ? '⚠️ نامعتبر'
        : p.isReady
          ? '✅ متصل'
          : '❌ متصل نیست';

    const detailParts = [];
    if (p.maskedKey) detailParts.push(`کلید: \`${p.maskedKey}\``);
    else if (!p.requiresKey && !p.requiresBaseUrl) detailParts.push('رایگان بدون کلید');

    if (p.lastLatencyMs && p.status === 'connected') {
      detailParts.push(`تست: ${p.lastLatencyMs}ms`);
    } else if (p.status === 'invalid' && p.lastError) {
      detailParts.push(`خطا: ${p.lastError.slice(0, 55)}`);
    }

    lines.push(
      `${isActive ? '🟢 ' : '• '}**${p.shortBadge}** — ${badge}${
        detailParts.length ? `\n   └ ${detailParts.join(' | ')}` : ''
      }`,
    );
  }

  lines.push(
    ``,
    `💡 ثبت کلید جدید: \`/setkey <provider> <API_KEY>\``,
    `💡 با دکمه‌های شیشه‌ای زیر می‌توانید هر اتصال را مستقیماً تست یا حذف کنید:`,
  );

  return {
    text: lines.join('\n'),
    providersSnapshot,
    storedKeysCount,
  };
}

/**
 * Builds the formatted `/model list` text catalog across all 9 providers with ✅/❌ key status.
 */
export async function buildModelListReportText(userRow) {
  const providersSnapshot = await buildUserProvidersSnapshot(userRow);
  const activeProv = userRow.provider || 'opencode';
  const activeMod = userRow.model || 'big-pickle';

  const lines = [
    `📋 **فهرست کامل مدل‌ها و وضعیت کلید سرویس‌ها**`,
    `🎯 انتخاب فعلی شما: \`${activeMod}\` روی **${getProviderSpec(activeProv).shortBadge}**`,
    ``,
  ];

  for (const p of providersSnapshot) {
    const keyBadge =
      p.status === 'invalid'
        ? '⚠️ کلید نامعتبر'
        : p.isReady
          ? '✅ آماده'
          : '❌ فاقد کلید';

    lines.push(`**${p.shortBadge}** (${keyBadge}):`);
    for (const m of p.models || []) {
      const activeMark = p.id === activeProv && m.id === activeMod ? ' 👈 فعال' : '';
      const costIcon = m.free !== false ? '🆓' : '💰';
      const tierIcon = m.tier === 'fast' ? '⚡' : m.tier === 'smart' ? '🧠' : '';
      const starIcon = m.recommended ? '⭐' : '';
      lines.push(`  • ${starIcon}${costIcon}${tierIcon} \`${m.id}\`${activeMark}`);
    }
    lines.push('');
  }

  lines.push(
    `💡 تغییر مستقیم مدل: \`/model <model_id>\``,
    `💡 منوی شیشه‌ای گروه‌بندی‌شده: \`/model\``,
  );

  return lines.join('\n');
}

function findProviderForModelId(modelId, currentProviderId) {
  const clean = String(modelId ?? '').trim();
  const currentSpec = getProviderSpec(currentProviderId);
  if ((currentSpec.models || []).some((m) => m.id === clean)) {
    return currentSpec.id;
  }
  for (const p of PROVIDER_LIST) {
    if ((p.models || []).some((m) => m.id === clean)) {
      return p.id;
    }
  }
  if (clean.endsWith(':free')) return 'openrouter';
  if (clean.startsWith('gemini-')) return 'gemini';
  return currentSpec.id;
}

export async function handleSlashCommand(msg, userRow) {
  const chatId = msg.chat.id;
  const rawText = (msg.text || '').trim();
  const spaceIdx = rawText.indexOf(' ');
  const cmdToken = (spaceIdx === -1 ? rawText : rawText.slice(0, spaceIdx))
    .split('@')[0]
    .toLowerCase();
  const argText = spaceIdx === -1 ? '' : rawText.slice(spaceIdx + 1).trim();

  const activeProject = userRow.activeProject || 'default';
  const miniAppUrl = (await getSetting('mini_app_url')) || '';

  if (cmdToken === '/whoami') {
    await sendSafeText(
      chatId,
      `🆔 شناسه عددی تلگرام شما: \`${userRow.tgId}\`\n👤 وضعیت دسترسی: ${userRow.isAllowed ? '✅ مجاز' : '⛔ در انتظار تایید ادمین'}`,
    );
    return true;
  }

  if (!userRow.isAllowed) {
    await sendSafeText(
      chatId,
      `⛔ دسترسی شما به این ایجنت مجاز نیست (\`${userRow.tgId}\`).\nاز ادمین بخواهید دستور زیر را وارد کند:\n/allow ${userRow.tgId}`,
    );
    return true;
  }

  switch (cmdToken) {
    case '/start':
    case '/help': {
      await ensureProject(userRow.tgId, activeProject);
      if (userRow.isAdmin) {
        await api.setMyCommands({ commands: BOT_COMMANDS_MENU }).catch(() => undefined);
      }

      const [auth, ghToken, storedKeys] = await Promise.all([
        resolveProviderAuth(userRow),
        resolveGithubToken(userRow),
        countStoredUserKeys(userRow.tgId),
      ]);

      const welcome = [
        `👋 خوش آمدید به **Ahwaz Serverless Coding Agent (v2.1)**!`,
        `پشتیبانی یکپارچه از **OpenCode Zen**، **FreeLLMAPI / ApiFreeLLM**، **LLM7**، **Pollinations**، **OpenRouter :free**، **Groq** و **Google Gemini**!`,
        ``,
        `🌐 سرویس فعال: **${auth.providerSpec.shortBadge}** (${auth.isReady ? '✅ آماده به کار' : '⚠️ نیازمند تنظیم'})`,
        `🧠 مدل فعال: \`${auth.model}\``,
        `🔑 کلیدهای ذخیره‌شده در دیتابیس: **${storedKeys}** (\`/keys\`)`,
        `📁 پروژه فعال: \`${activeProject}\``,
        `🐙 توکن GitHub: ${ghToken ? '✅ متصل' : '⚪ تنظیم نشده (/setghtoken)'}`,
        ``,
        `🔑 **مدیریت کلیدها و انتخاب مدل:**`,
        `• \`/keys\` — داشبورد وضعیت اتصال همه سرویس‌ها + دکمه‌های تست و حذف`,
        `• \`/model\` — منوی شیشه‌ای گروه‌بندی‌شده مدل‌ها (\`/model list\` برای فهرست متنی کامل)`,
        `• \`/setkey [provider] <KEY>\` — ثبت امن کلید در SQLite (حذف خودکار پیام)`,
        `• \`/provider\` — تغییر سرویس هوش مصنوعی`,
        `• \`/opencode [API_KEY]\` — مدل‌های رایگان **OpenCode Zen**`,
        `• \`/freellm <URL_OR_KEY> [KEY]\` — اتصال به **FreeLLMAPI** یا **ApiFreeLLM.com**`,
        `• \`/guide [provider_id]\` — راهنمای گام‌به‌گام دریافت کلید هر سرویس`,
        ``,
        `🛠️ **مدیریت پروژه و GitHub:**`,
        `• \`/project <name>\` | \`/files\` | \`/cat <path>\` | \`/zip\``,
        `• \`/ghclone <owner/repo> [branch]\` | \`/ghpush <owner/repo> <msg>\``,
      ].join('\n');

      await sendSafeText(chatId, welcome, {
        reply_markup: buildMainDashboardKeyboard(miniAppUrl),
      });
      return true;
    }

    case '/keys': {
      const subParts = argText.split(/\s+/).filter(Boolean);
      if (subParts.length >= 2 && ['test', 'delete', 'remove', 'del'].includes(subParts[0].toLowerCase())) {
        const subCmd = subParts[0].toLowerCase();
        const targetProv = subParts[1].toLowerCase();
        if (!PROVIDERS[targetProv]) {
          await sendSafeText(chatId, `⚠️ سرویس \`${targetProv}\` شناخته نشد.`);
          return true;
        }
        const spec = getProviderSpec(targetProv);
        if (subCmd === 'test') {
          const testRes = await testProviderConnection({ userRow, providerId: spec.id });
          const report = await buildKeysDashboardReport(userRow);
          const header = testRes.success
            ? `✅ تست اتصال **${spec.shortBadge}** موفق بود (${testRes.latency_ms}ms)!\n\n`
            : `❌ تست اتصال **${spec.shortBadge}** ناموفق بود:\n${testRes.error}\n\n`;
          await sendSafeText(chatId, `${header}${report.text}`, {
            reply_markup: buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
          });
          return true;
        }

        await deleteProviderCredentials(userRow, spec.id);
        const report = await buildKeysDashboardReport(userRow);
        await sendSafeText(
          chatId,
          `🗑️ کلید سرویس **${spec.shortBadge}** با موفقیت از دیتابیس حذف شد.\n\n${report.text}`,
          {
            reply_markup: buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
          },
        );
        return true;
      }

      const report = await buildKeysDashboardReport(userRow);
      await sendSafeText(chatId, report.text, {
        reply_markup: buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
      });
      return true;
    }

    case '/provider':
    case '/providers': {
      if (argText && PROVIDERS[argText.toLowerCase()]) {
        const nextProv = argText.toLowerCase();
        const updated = await setActiveProviderAndModel(userRow.tgId, nextProv);
        const spec = getProviderSpec(updated.provider);
        const auth = await resolveProviderAuth(userRow, nextProv);
        const help = PROVIDER_HELP[nextProv];
        const statusLine = auth.isReady
          ? '✅ آماده به کار'
          : `⚠️ نیاز به تنظیم: ${auth.missingReason || 'کلید/آدرس ثبت نشده'}`;
        const guideLines = help
          ? [
              '',
              `📘 راهنمای اتصال به ${help.title}:`,
              ...(help.steps || []).map((s, i) => `  ${i + 1}) ${s}`),
              ...(help.links || []).length
                ? [
                    '',
                    '🔗 لینک‌های کاربردی:',
                    ...(help.links || []).map((l) => `  • ${l.label}: ${l.url}`),
                  ]
                : [],
              ...(help.commands || []).length
                ? ['', `💬 دستور: ${help.commands.join(' · ')}`]
                : [],
            ]
          : [];
        await sendSafeText(
          chatId,
          [
            `✅ سرویس فعال به **${spec.title}** تغییر یافت.`,
            `🧠 مدل پیش‌فرض: \`${updated.model}\``,
            `📊 وضعیت: ${statusLine}`,
            ...guideLines,
          ].join('\n'),
          { reply_markup: buildModelsKeyboard(updated.provider, updated.model) },
        );
        return true;
      }

      const auth = await resolveProviderAuth(userRow);
      const statusMap = {};
      const lines = [
        '🌐 انتخاب سرویس هوش مصنوعی و وضعیت اتصال:',
        `سرویس فعلی: **${auth.providerSpec.shortBadge}** (${auth.isReady ? '✅ آماده' : '⚠️ نیازمند تنظیم'})`,
        `مدل فعلی: \`${auth.model}\``,
        '',
        '📋 فهرست ارائه‌دهندگان و راهنمای اتصال:',
      ];

      for (const [id, help] of Object.entries(PROVIDER_HELP)) {
        const providerAuth = await resolveProviderAuth(userRow, id);
        statusMap[id] = { isReady: providerAuth.isReady, status: providerAuth.status };
        const ready =
          providerAuth.status === 'invalid'
            ? '⚠️'
            : providerAuth.isReady
              ? '✅'
              : '❌';
        const shortMissing = providerAuth.missingReason
          ? providerAuth.missingReason.split('\n')[0]
          : 'ثبت کلید/آدرس';
        lines.push(
          `${ready} **${help.title}**${help.keyless ? ' (رایگان، بدون کلید)' : ''}`,
          `   ${help.summary}`,
          providerAuth.isReady
            ? '   وضعیت: آماده به کار'
            : `   نیاز به تنظیم: ${shortMissing}`,
          ...(help.commands || []).length
            ? [`   دستور: ${help.commands.join(' · ')}`]
            : [],
          ...(help.links || []).length
            ? [`   لینک: ${help.links.map((l) => l.url).join(' · ')}`]
            : [],
          '',
        );
      }

      lines.push(
        '💡 برای انتخاب سرویس: `/provider <provider_id>`',
        '💡 برای مدیریت و تست کلیدها: `/keys`',
        '💡 برای ثبت کلید: `/setkey <provider_id> <API_KEY>`',
      );

      await sendSafeText(chatId, lines.join('\n'), {
        reply_markup: buildProvidersKeyboard(userRow.provider || 'opencode', statusMap),
      });
      return true;
    }

    case '/opencode': {
      if (argText) {
        await tryDeleteSecretMessage(chatId, msg.message_id);
        await saveProviderCredentials(userRow, 'opencode', { apiKey: argText });
        const updated = await setActiveProviderAndModel(userRow.tgId, 'opencode', 'big-pickle');
        await sendSafeText(
          chatId,
          `✅ کلید رایگان **OpenCode Zen** با امنیت کامل در دیتابیس ذخیره شد (پیام حاوی کلید حذف گردید)!\n🧠 مدل فعال: \`${updated.model}\``,
          { reply_markup: buildModelsKeyboard('opencode', updated.model) },
        );
        return true;
      }

      await setActiveProviderAndModel(
        userRow.tgId,
        'opencode',
        userRow.provider === 'opencode' ? userRow.model : 'big-pickle',
      );
      let modelsList = PROVIDERS.opencode.models;
      try {
        const auth = await resolveProviderAuth(userRow, 'opencode');
        modelsList = await fetchLiveOpenCodeFreeModels(auth.apiKey);
      } catch {
        // Fallback to built-in curated OpenCode free models
      }
      await sendSafeText(
        chatId,
        `🆓 **مدل‌های رایگان کدنویسی OpenCode Zen (\`opencode.ai/zen/v1\`)**\nیک مدل رایگان انتخاب کنید یا برای سقف اختصاصی خود، کلید رایگان \`https://opencode.ai/auth\` را با دستور \`/opencode YOUR_KEY\` ثبت نمایید:`,
        {
          reply_markup: buildModelsKeyboard(
            'opencode',
            userRow.provider === 'opencode' ? userRow.model : 'big-pickle',
            modelsList,
          ),
        },
      );
      return true;
    }

    case '/freellm': {
      if (!argText) {
        await sendSafeText(
          chatId,
          `🔀 **راهنمای اتصال به FreeLLMAPI و ApiFreeLLM:**\n\n۱) **اتصال به روتر FreeLLMAPI** (تجمیع ۳۴ سرویس رایگان در یک اندپوینت \`/v1\`):\n\`/freellm https://your-freellmapi-domain.com/v1 freellmapi-your-key [auto]\`\n\n۲) **اتصال مستقیم به سایت ApiFreeLLM.com**:\n\`/freellm YOUR_APIFREELLM_API_KEY\`\n\n۳) **استفاده فوری و بدون کلید از LLM7 رایگان**:\n\`/provider llm7\``,
        );
        return true;
      }

      await tryDeleteSecretMessage(chatId, msg.message_id);
      const parts = argText.split(/\s+/);
      if (parts[0].startsWith('http://') || parts[0].startsWith('https://')) {
        const baseUrl = parts[0];
        const apiKey = parts[1] || 'unused';
        const chosenModel = parts[2] || 'auto';
        await saveProviderCredentials(userRow, 'freellmapi', { baseUrl, apiKey });
        await setActiveProviderAndModel(userRow.tgId, 'freellmapi', chosenModel);
        await sendSafeText(
          chatId,
          `✅ روتر **FreeLLMAPI** با موفقیت متصل شد!\n🔗 آدرس: \`${baseUrl}\`\n🧠 مدل فعال: \`${chosenModel}\` (می‌توانید از \`auto\`، \`auto:smart\` یا \`auto:fast\` استفاده کنید)`,
          { reply_markup: buildModelsKeyboard('freellmapi', chosenModel) },
        );
        return true;
      }

      const apiKey = parts[0];
      await saveProviderCredentials(userRow, 'apifreellm', { apiKey });
      await setActiveProviderAndModel(userRow.tgId, 'apifreellm', 'apifreellm');
      await sendSafeText(
        chatId,
        `✅ کلید سرویس **ApiFreeLLM.com** با موفقیت در دیتابیس ذخیره و فعال شد (پیام کلید حذف گردید)!\nهم‌اکنون می‌توانید درخواست‌های کدنویسی خود را ارسال کنید.`,
      );
      return true;
    }

    case '/setcustom': {
      const parts = argText.split(/\s+/).filter(Boolean);
      if (parts.length < 1 || !parts[0].startsWith('http')) {
        await sendSafeText(
          chatId,
          `⚠️ فرمت صحیح اتصال به هر سرویس سازگار با OpenAI:\n\`/setcustom https://api.example.com/v1 [API_KEY] [MODEL_ID]\``,
        );
        return true;
      }
      await tryDeleteSecretMessage(chatId, msg.message_id);
      const [baseUrl, apiKey = 'unused', model = 'auto'] = parts;
      await saveProviderCredentials(userRow, 'custom', { baseUrl, apiKey });
      await setActiveProviderAndModel(userRow.tgId, 'custom', model);
      await sendSafeText(
        chatId,
        `✅ سرویس اختصاصی سازگار با OpenAI ثبت و فعال شد!\n🔗 آدرس: \`${baseUrl}\`\n🧠 مدل: \`${model}\``,
      );
      return true;
    }

    case '/setkey': {
      if (!argText || argText.length < 6) {
        await sendSafeText(
          chatId,
          `⚠️ فرمت ثبت کلید API:\n• \`/setkey opencode <KEY>\` (کلید رایگان OpenCode Zen)\n• \`/setkey gemini <KEY>\` (کلید Google AI Studio)\n• \`/setkey openrouter <KEY>\` (کلید OpenRouter)\n• \`/setkey groq <KEY>\` (کلید Groq)\n• \`/setkey apifreellm <KEY>\` (کلید ApiFreeLLM.com)`,
        );
        return true;
      }
      await tryDeleteSecretMessage(chatId, msg.message_id);
      const tokens = argText.split(/\s+/);
      let targetProvider;
      let secretKey;

      if (tokens.length >= 2 && PROVIDERS[tokens[0].toLowerCase()]) {
        targetProvider = tokens[0].toLowerCase();
        secretKey = tokens.slice(1).join(' ');
      } else {
        secretKey = argText.trim();
        targetProvider = inferProviderFromApiKey(secretKey);
      }

      await saveProviderCredentials(userRow, targetProvider, { apiKey: secretKey });
      const updated = await setActiveProviderAndModel(userRow.tgId, targetProvider);
      const spec = getProviderSpec(targetProvider);

      await sendSafeText(
        chatId,
        `✅ کلید سرویس **${spec.shortBadge}** با امنیت کامل در دیتابیس ذخیره شد (پیام حاوی کلید حذف گردید).\n🧠 مدل فعال فعلی: \`${updated.model}\`\n💡 این تنظیم به‌صورت خودکار با Mini App نیز همگام است.`,
        { reply_markup: buildModelsKeyboard(updated.provider, updated.model) },
      );
      return true;
    }

    case '/setghtoken':
    case '/setgithub': {
      if (!argText || argText.length < 10) {
        await sendSafeText(chatId, '⚠️ لطفاً توکن GitHub را وارد کنید:\n`/setghtoken ghp_...`');
        return true;
      }
      await tryDeleteSecretMessage(chatId, msg.message_id);
      await saveUserGithubToken(userRow, argText);
      await sendSafeText(
        chatId,
        '✅ توکن **GitHub** ذخیره شد و پیام حاوی توکن برای امنیت شما حذف گردید.',
      );
      return true;
    }

    case '/setminiapp': {
      if (!userRow.isAdmin) {
        await sendSafeText(chatId, '⛔ فقط ادمین ربات می‌تواند آدرس Mini App را تنظیم کند.');
        return true;
      }
      if (!argText.startsWith('https://')) {
        await sendSafeText(
          chatId,
          '⚠️ آدرس HTTPS مینی‌اپ (خروجی دستور `npm run deploy`) را وارد کنید:\n`/setminiapp https://...`',
        );
        return true;
      }
      await setSetting('mini_app_url', argText);
      await sendSafeText(chatId, `✅ دکمه **Code Studio Mini App** به آدرس زیر متصل شد:\n${argText}`, {
        reply_markup: buildMainDashboardKeyboard(argText),
      });
      return true;
    }

    case '/allow':
    case '/revoke': {
      if (!userRow.isAdmin) {
        await sendSafeText(chatId, '⛔ این دستور مخصوص ادمین ربات است.');
        return true;
      }
      const targetId = Number(argText);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        await sendSafeText(chatId, `⚠️ شناسه عددی کاربر را وارد کنید: \`${cmdToken} 123456789\``);
        return true;
      }
      const allow = cmdToken === '/allow';
      await setUserAccess(targetId, allow);
      await sendSafeText(
        chatId,
        allow
          ? `✅ دسترسی کاربر \`${targetId}\` به ربات فعال شد.`
          : `🚫 دسترسی کاربر \`${targetId}\` لغو شد.`,
      );
      return true;
    }

    case '/guide':
    case '/connect': {
      const targetId = argText ? argText.toLowerCase() : null;
      if (targetId && PROVIDER_HELP[targetId]) {
        const help = PROVIDER_HELP[targetId];
        const spec = getProviderSpec(targetId);
        const auth = await resolveProviderAuth(userRow, targetId);
        const lines = [
          `📘 راهنمای اتصال به **${help.title}**`,
          '',
          `📝 خلاصه: ${help.summary}`,
          '',
        ];
        if (help.steps && help.steps.length) {
          lines.push('🔑 نحوه دریافت کلید:');
          lines.push(...help.steps.map((s, i) => `  ${i + 1}) ${s}`));
          lines.push('');
        }
        if (help.freeModels && help.freeModels.length) {
          lines.push('📋 مدل‌های رایگان موجود:');
          lines.push(
            ...help.freeModels.map((m) =>
              typeof m === 'string' ? `  • \`${m}\`` : `  • \`${m.id}\` — ${m.desc}`,
            ),
          );
          lines.push('');
        }
        if (help.commands && help.commands.length) {
          lines.push('💬 دستورات ربات:');
          lines.push(`  ${help.commands.join(' · ')}`);
          lines.push('');
        }
        if (help.links && help.links.length) {
          lines.push('🔗 لینک‌های کاربردی:');
          lines.push(...help.links.map((l) => `  • ${l.label}: ${l.url}`));
          lines.push('');
        }
        if (help.note) {
          lines.push(`💡 نکته: ${help.note}`);
          lines.push('');
        }
        lines.push(`📊 وضعیت فعلی: ${auth.isReady ? '✅ آماده به کار' : '❌ متصل نیست'}`);
        if (!auth.isReady && auth.missingReason) {
          lines.push(`   ${auth.missingReason}`);
        }
        lines.push(`🧠 مدل پیش‌فرض: \`${spec.defaultModel}\``);
        await sendSafeText(chatId, lines.join('\n'));
        return true;
      }

      const allLines = [
        '📘 راهنمای اتصال به ارائه‌دهندگان هوش مصنوعی',
        '',
        'برای راهنمای کامل هر سرویس: `/guide <provider_id>`',
        'نمونه: `/guide gemini` یا `/guide openrouter`',
        '',
        '📋 فهرست ارائه‌دهندگان:',
      ];
      for (const [id, help] of Object.entries(PROVIDER_HELP)) {
        const auth = await resolveProviderAuth(userRow, id);
        const ready = auth.isReady ? '✅' : '❌';
        allLines.push(
          `${ready} **${help.title}**${help.keyless ? ' (رایگان بدون کلید)' : ''}`,
          `   ${help.summary}`,
        );
      }
      allLines.push('');
      allLines.push('🔑 مدیریت کلیدها: `/keys` | ثبت کلید: `/setkey <provider_id> <API_KEY>`');
      await sendSafeText(chatId, allLines.join('\n'));
      return true;
    }

    case '/model':
    case '/models': {
      const currentProv = userRow.provider || 'opencode';

      // `/model list`: Full text list of all providers + models + key status (✅/❌)
      if (argText.toLowerCase() === 'list') {
        const listText = await buildModelListReportText(userRow);
        await sendSafeText(chatId, listText);
        return true;
      }

      // `/model <model_name>` or `/model <provider> <model_name>`: Direct switch
      if (argText) {
        const tokens = argText.split(/\s+/).filter(Boolean);
        let targetProv = currentProv;
        let targetModel = argText.trim();

        if (tokens.length >= 2 && PROVIDERS[tokens[0].toLowerCase()]) {
          targetProv = tokens[0].toLowerCase();
          targetModel = tokens.slice(1).join(' ');
        } else {
          targetProv = findProviderForModelId(targetModel, currentProv);
        }

        if (targetProv !== currentProv) {
          await setActiveProviderAndModel(userRow.tgId, targetProv, targetModel);
          userRow.provider = targetProv;
          userRow.model = targetModel;
        } else {
          await setActiveModel(userRow.tgId, targetModel);
          userRow.model = targetModel;
        }

        const auth = await resolveProviderAuth(userRow, targetProv);
        const keyWarn = auth.isReady
          ? '✅ وضعیت کلید سرویس: آماده به کار'
          : `⚠️ توجه: کلید سرویس **${auth.providerSpec.shortBadge}** هنوز ثبت نشده است (\`/setkey ${targetProv} YOUR_KEY\`).`;

        await sendSafeText(
          chatId,
          `✅ مدل فعال به \`${targetModel}\` روی سرویس **${getProviderSpec(targetProv).shortBadge}** تغییر یافت.\n${keyWarn}`,
        );
        return true;
      }

      // `/model` (no args): Grouped inline keyboard by provider
      const providersSnapshot = await buildUserProvidersSnapshot(userRow);
      const auth = await resolveProviderAuth(userRow);
      await sendSafeText(
        chatId,
        [
          `🤖 **انتخاب مدل کدنویسی (گروه‌بندی‌شده بر اساس سرویس)**`,
          `• مدل فعال فعلی: \`${auth.model}\``,
          `• سرویس فعال: **${auth.providerSpec.shortBadge}** (${auth.isReady ? '✅ متصل' : '❌ نیازمند کلید'})`,
          ``,
          `یک مدل از دسته فعال انتخاب کنید یا روی هر سرویس بزنید تا مدل‌های آن نمایش داده شود (برای فهرست متنی: \`/model list\`):`,
        ].join('\n'),
        {
          reply_markup: buildGroupedModelsKeyboard(
            providersSnapshot,
            currentProv,
            auth.model,
          ),
        },
      );
      return true;
    }

    case '/project':
    case '/projects': {
      if (argText) {
        const nextProj = sanitizeProjectName(argText);
        await ensureProject(userRow.tgId, nextProj);
        await setActiveProject(userRow.tgId, nextProj);
        const files = await listWorkspaceFiles(userRow.tgId, nextProj);
        await sendSafeText(
          chatId,
          `📁 پروژه فعال به \`${nextProj}\` تغییر یافت (${files.length} فایل موجود).`,
        );
        return true;
      }
      const list = await listProjects(userRow.tgId);
      await sendSafeText(
        chatId,
        `📁 پروژه‌های شما (پروژه فعال: \`${activeProject}\`)\nبرای ساخت پروژه جدید بنویسید: \`/project my-new-app\``,
        { reply_markup: buildProjectsKeyboard(list, activeProject) },
      );
      return true;
    }

    case '/files': {
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      if (files.length === 0) {
        await sendSafeText(
          chatId,
          `📂 پروژه \`${activeProject}\` فعلاً خالی است. از ایجنت بخواهید کدی بسازد یا یک فایل \`.zip\` در چت بفرستید!`,
        );
        return true;
      }
      const lines = files
        .slice(0, 80)
        .map((f) => `• \`${f.path}\` (${f.sizeBytes} B)`)
        .join('\n');
      await sendSafeText(
        chatId,
        `📂 **فایل‌های پروژه \`${activeProject}\` (${files.length} فایل):**\n\n${lines}`,
      );
      return true;
    }

    case '/cat': {
      if (!argText) {
        await sendSafeText(chatId, '⚠️ مسیر فایل را وارد کنید: `/cat src/index.js`');
        return true;
      }
      const file = await readWorkspaceFile(userRow.tgId, activeProject, argText);
      if (!file) {
        await sendSafeText(chatId, `❌ فایل \`${argText}\` در پروژه \`${activeProject}\` پیدا نشد.`);
        return true;
      }
      const snippet =
        file.content.length > 3500
          ? `${file.content.slice(0, 3500)}\n// ... (ادامه فایل خلاصه شد)`
          : file.content;
      await sendSafeText(chatId, `📄 **\`${file.path}\`**:\n\`\`\`\n${snippet}\n\`\`\``);
      return true;
    }

    case '/zip': {
      await deliverProjectZip(chatId, userRow.tgId, activeProject);
      return true;
    }

    case '/clear': {
      await clearConversationHistory(userRow.tgId, activeProject);
      await sendSafeText(
        chatId,
        `🧹 حافظه گفتگوی پروژه \`${activeProject}\` پاک شد (فایل‌های پروژه دست‌نخورده باقی ماندند).`,
      );
      return true;
    }

    case '/ghclone': {
      const parts = argText.split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        await sendSafeText(chatId, '⚠️ مثال استفاده:\n`/ghclone octocat/Hello-World main`');
        return true;
      }
      const [repo, branch] = parts;
      const ghToken = await resolveGithubToken(userRow);
      const waitMsg = await sendSafeText(chatId, `⏳ در حال دریافت \`${repo}\` از GitHub...`);
      try {
        const res = await importGithubRepoToWorkspace({
          tgId: userRow.tgId,
          projectName: activeProject,
          repoSpec: repo,
          branch,
          githubToken: ghToken,
        });
        await api.editMessageText({
          chat_id: chatId,
          message_id: waitMsg.message_id,
          text: `✅ ریپازیتوری ${res.repo} (شاخه ${res.branch}) با موفقیت وارد پروژه ${activeProject} شد!\n📄 تعداد فایل‌ها: ${res.importedCount}`,
        });
      } catch (err) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: waitMsg.message_id,
          text: `❌ خطا در ایمپورت از GitHub: ${err?.message ?? err}`,
        });
      }
      return true;
    }

    case '/ghpush': {
      const parts = argText.split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        await sendSafeText(
          chatId,
          '⚠️ مثال ارسال پروژه به GitHub:\n`/ghpush username/repo-name feat: update from Telegram Serverless`',
        );
        return true;
      }
      const repo = parts[0];
      const commitMessage = parts.slice(1).join(' ') || `Update ${activeProject} from Ahwaz Agent`;
      const ghToken = await resolveGithubToken(userRow);
      const projMeta = await ensureProject(userRow.tgId, activeProject);
      const targetBranch = projMeta?.githubBranch || 'main';
      const waitMsg = await sendSafeText(chatId, `⏳ در حال Push پروژه \`${activeProject}\` به \`${repo}\`...`);
      try {
        const res = await pushWorkspaceToGithub({
          tgId: userRow.tgId,
          projectName: activeProject,
          repoSpec: repo,
          branch: targetBranch,
          commitMessage,
          githubToken: ghToken,
        });
        await api.editMessageText({
          chat_id: chatId,
          message_id: waitMsg.message_id,
          text: `🚀 پروژه با موفقیت روی GitHub منتشر شد!\n🔗 ${res.commitUrl}\n📄 تعداد فایل‌ها: ${res.filesPushed}`,
        });
      } catch (err) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: waitMsg.message_id,
          text: `❌ خطا در ارسال به GitHub: ${err?.message ?? err}`,
        });
      }
      return true;
    }

    case '/status': {
      const [files, auth, ghToken, storedKeys] = await Promise.all([
        listWorkspaceFiles(userRow.tgId, activeProject),
        resolveProviderAuth(userRow),
        resolveGithubToken(userRow),
        countStoredUserKeys(userRow.tgId),
      ]);
      await sendSafeText(
        chatId,
        [
          `📊 **وضعیت ایجنت Telegram Serverless**`,
          `• پلتفرم: \`@tgcloud V8 Isolate + SQLite\``,
          `• کاربر: \`${userRow.tgId}\` (${userRow.isAdmin ? 'ادمین' : 'کاربر مجاز'})`,
          `• سرویس فعال: **${auth.providerSpec.title}** (${auth.isReady ? '✅ آماده' : '⚠️ نیازمند کلید/آدرس'})`,
          `• مدل فعال: \`${auth.model}\``,
          `• کلیدهای ذخیره‌شده در دیتابیس: **${storedKeys}**`,
          `• پروژه فعال: \`${activeProject}\` (${files.length} فایل)`,
          `• تعداد پرامپت‌ها: ${userRow.promptCount || 0} | فراخوانی ابزارها: ${userRow.toolCallCount || 0}`,
          `• اتصال GitHub: ${ghToken ? '✅ فعال' : '⚪ غیرفعال'}`,
        ].join('\n'),
      );
      return true;
    }

    default: {
      if (/^\/[a-z0-9_]+$/i.test(cmdToken)) {
        if (/key|token|secret/i.test(cmdToken) && argText) {
          await tryDeleteSecretMessage(chatId, msg.message_id);
        }
        await sendSafeText(
          chatId,
          `⚠️ دستور \`${cmdToken}\` شناخته نشد. برای مشاهده فهرست کامل دستورات \`/help\` را ارسال کنید.`,
        );
        return true;
      }
      return false;
    }
  }
}
