import { api } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  getProviderSpec,
  inferProviderFromApiKey,
  PROVIDERS,
} from '../agent/providers.js';
import {
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
  buildMainDashboardKeyboard,
  buildModelsKeyboard,
  buildProjectsKeyboard,
  buildProvidersKeyboard,
} from './keyboard-service.js';
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
  { command: 'provider', description: 'انتخاب سرویس رایگان (OpenCode / FreeLLM / Gemini)' },
  { command: 'opencode', description: 'مدل‌های رایگان کدنویسی OpenCode Zen' },
  { command: 'freellm', description: 'اتصال به روتر FreeLLMAPI یا ApiFreeLLM' },
  { command: 'model', description: 'انتخاب مدل کدنویسی' },
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

      const auth = await resolveProviderAuth(userRow);
      const ghToken = await resolveGithubToken(userRow);

      const welcome = [
        `👋 خوش آمدید به **Ahwaz Serverless Coding Agent (v2.1)**!`,
        `پشتیبانی کامل از **مدل‌های رایگان OpenCode Zen**، **FreeLLMAPI / ApiFreeLLM**، **LLM7 بدون کلید**، **OpenRouter :free**، **Groq** و **Google Gemini**!`,
        ``,
        `🌐 سرویس فعال: **${auth.providerSpec.shortBadge}** (${auth.isReady ? '✅ آماده به کار' : '⚠️ نیازمند تنظیم'})`,
        `🧠 مدل فعال: \`${auth.model}\``,
        `📁 پروژه فعال: \`${activeProject}\``,
        `🐙 توکن GitHub: ${ghToken ? '✅ متصل' : '⚪ تنظیم نشده (/setghtoken)'}`,
        ``,
        `🆓 **دستورات سرویس‌های رایگان هوش مصنوعی:**`,
        `• \`/provider\` — منوی انتخاب سرویس (OpenCode, FreeLLMAPI, ApiFreeLLM, LLM7, Gemini...)`,
        `• \`/opencode [API_KEY]\` — انتخاب مدل‌های رایگان **OpenCode Zen** یا ثبت کلید رایگان (\`opencode.ai/auth\`)`,
        `• \`/freellm <URL_OR_KEY> [KEY]\` — اتصال به روتر **FreeLLMAPI** یا سرویس **ApiFreeLLM.com**`,
        `• \`/setkey [provider] <KEY>\` — ثبت امن کلید هر سرویس (حذف خودکار پیام)`,
        `• \`/model [model_id]\` — تغییر سریع مدل کدنویسی`,
        ``,
        `🛠️ **دستورات مدیریت پروژه و GitHub:**`,
        `• \`/project <name>\` — ساخت یا سوییچ بین پروژه‌ها`,
        `• \`/files\` | \`/cat <path>\` | \`/zip\` — مدیریت و دانلود ZIP پروژه`,
        `• \`/ghclone <owner/repo> [branch]\` | \`/ghpush <owner/repo> <msg>\` — اتصال GitHub`,
        `• 📎 ارسال فایل کد یا آرشیو \`.zip\` در چت -> ایمپورت خودکار در پروژه!`,
      ].join('\n');

      await sendSafeText(chatId, welcome, {
        reply_markup: buildMainDashboardKeyboard(miniAppUrl),
      });
      return true;
    }

    case '/provider':
    case '/providers': {
      if (argText && PROVIDERS[argText.toLowerCase()]) {
        const nextProv = argText.toLowerCase();
        const updated = await setActiveProviderAndModel(userRow.tgId, nextProv);
        const spec = getProviderSpec(updated.provider);
        await sendSafeText(
          chatId,
          `✅ سرویس فعال به **${spec.title}** تغییر یافت.\n🧠 مدل پیش‌فرض: \`${updated.model}\`\n💡 ${spec.signupHint}`,
          { reply_markup: buildModelsKeyboard(updated.provider, updated.model) },
        );
        return true;
      }
      await sendSafeText(
        chatId,
        `🌐 **انتخاب سرویس هوش مصنوعی و مدل‌های رایگان:**\n\n• **🆓 OpenCode Zen**: مدل‌های رایگان کدنویسی مثل \`big-pickle\`، \`deepseek-v4.1-flash-free\` و \`glm-5.3-flash-free\`\n• **⚡ LLM7 & 🌸 Pollinations**: کاملاً رایگان و **بدون نیاز به هیچ کلید API**\n• **🔀 FreeLLMAPI & 🆓 ApiFreeLLM**: پشتیبانی بومی از روتر یکپارچه FreeLLMAPI و سایت ApiFreeLLM.com\n• **🌐 OpenRouter / ⚡ Groq / ✨ Gemini**: پشتیبانی کامل از مدل‌های رایگان و حرفه‌ای`,
        { reply_markup: buildProvidersKeyboard(userRow.provider || 'opencode') },
      );
      return true;
    }

    case '/opencode': {
      if (argText) {
        await tryDeleteSecretMessage(chatId, msg.message_id);
        await saveProviderCredentials(userRow, 'opencode', { apiKey: argText });
        const updated = await setActiveProviderAndModel(userRow.tgId, 'opencode', 'big-pickle');
        await sendSafeText(
          chatId,
          `✅ کلید رایگان **OpenCode Zen** با امنیت کامل ذخیره شد (پیام حاوی کلید حذف گردید)!\n🧠 مدل فعال: \`${updated.model}\``,
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
        `✅ کلید سرویس **ApiFreeLLM.com** با موفقیت ذخیره و فعال شد (پیام کلید حذف گردید)!\nهم‌اکنون می‌توانید درخواست‌های کدنویسی خود را ارسال کنید.`,
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
        `✅ سرویس اختصاصی سازگار با OpenAI ثبت و فعال شد!\n🔗 آدرس: \`${baseUrl}\n🧠 مدل: \`${model}\``,
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
        `✅ کلید سرویس **${spec.shortBadge}** با موفقیت ذخیره شد (پیام حاوی کلید حذف گردید).\n🧠 مدل فعال فعلی: \`${updated.model}\``,
        { reply_markup: buildModelsKeyboard(updated.provider, updated.model) },
      );
      return true;
    }

    case '/setghtoken': {
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
          '⚠️ آدرس HTTPS مینی‌اپ (خروجی دستور `npx tgcloud deploy`) را وارد کنید:\n`/setminiapp https://...`',
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

    case '/model':
    case '/models': {
      const provId = userRow.provider || 'opencode';
      if (argText) {
        await setActiveModel(userRow.tgId, argText);
        await sendSafeText(
          chatId,
          `✅ مدل فعال روی سرویس **${getProviderSpec(provId).shortBadge}** به \`${argText}\` تغییر یافت.`,
        );
        return true;
      }
      await sendSafeText(
        chatId,
        `🤖 **انتخاب مدل روی سرویس ${getProviderSpec(provId).title}**\nمدل فعلی: \`${userRow.model}\``,
        {
          reply_markup: buildModelsKeyboard(provId, userRow.model),
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
          text: `✅ ریپازیتوری ${res.repo} (شاخه ${res.branch}) با موفقیت وارد پروژه ${activeProject} شد!\n📄 تعداد فایل‌ها: ${res.importedFiles}`,
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
      const waitMsg = await sendSafeText(chatId, `⏳ در حال Push پروژه \`${activeProject}\` به \`${repo}\`...`);
      try {
        const res = await pushWorkspaceToGithub({
          tgId: userRow.tgId,
          projectName: activeProject,
          repoSpec: repo,
          branch: 'main',
          commitMessage,
          githubToken: ghToken,
        });
        await api.editMessageText({
          chat_id: chatId,
          message_id: waitMsg.message_id,
          text: `🚀 پروژه با موفقیت روی GitHub منتشر شد!\n🔗 ${res.commitUrl}\n📄 تعداد فایل‌ها: ${res.filesCommitted}`,
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
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      const auth = await resolveProviderAuth(userRow);
      const ghToken = await resolveGithubToken(userRow);
      await sendSafeText(
        chatId,
        [
          `📊 **وضعیت ایجنت Telegram Serverless**`,
          `• پلتفرم: \`@tgcloud V8 Isolate + SQLite\``,
          `• کاربر: \`${userRow.tgId}\` (${userRow.isAdmin ? 'ادمین' : 'کاربر مجاز'})`,
          `• سرویس فعال: **${auth.providerSpec.title}** (${auth.isReady ? '✅ آماده' : '⚠️ نیازمند کلید/آدرس'})`,
          `• مدل فعال: \`${auth.model}\``,
          `• پروژه فعال: \`${activeProject}\` (${files.length} فایل)`,
          `• تعداد پرامپت‌ها: ${userRow.promptCount || 0} | فراخوانی ابزارها: ${userRow.toolCallCount || 0}`,
          `• اتصال GitHub: ${ghToken ? '✅ فعال' : '⚪ غیرفعال'}`,
        ].join('\n'),
      );
      return true;
    }

    default:
      return false;
  }
}
