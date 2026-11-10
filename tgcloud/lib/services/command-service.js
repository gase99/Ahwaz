import { api } from 'sdk';
import {
  getSetting,
  resolveGeminiApiKey,
  resolveGithubToken,
  saveUserGeminiKey,
  saveUserGithubToken,
  setActiveModel,
  setActiveProject,
  setSetting,
  setUserAccess,
} from './auth-service.js';
import { clearConversationHistory } from './conversation-service.js';
import {
  escapeHtml,
  sendDocumentBytes,
  sendFormattedMessage,
} from './delivery-service.js';
import {
  importGithubRepoToWorkspace,
  pushWorkspaceToGithub,
} from './github-service.js';
import {
  buildMainDashboardKeyboard,
  buildModelSelectorKeyboard,
  buildProjectsKeyboard,
} from './keyboard-service.js';
import {
  ensureProject,
  exportProjectZipBytes,
  listProjects,
  listWorkspaceFiles,
  readWorkspaceFile,
  sanitizeProjectName,
} from './workspace-service.js';

export async function syncBotCommandsOnce() {
  const synced = await getSetting('commands_synced_v2');
  if (synced === '1') return;

  try {
    await api.setMyCommands({
      commands: [
        { command: 'start', description: 'پنل اصلی ایجنت کدنویسی Serverless' },
        { command: 'help', description: 'راهنمای دستورات و تنظیم کلیدها' },
        { command: 'setkey', description: 'ثبت امن کلید Google Gemini (/setkey AIza...)' },
        { command: 'project', description: 'ساخت یا سوییچ پروژه (/project app)' },
        { command: 'projects', description: 'لیست تمام پروژه‌های شما' },
        { command: 'files', description: 'نمایش فایل‌های پروژه فعال' },
        { command: 'read', description: 'خواندن محتوای یک فایل (/read src/index.js)' },
        { command: 'zip', description: 'دریافت خروجی ZIP کل پروژه' },
        { command: 'importgh', description: 'دریافت ریپو از GitHub (/importgh owner/repo)' },
        { command: 'pushgh', description: 'ارسال پروژه به GitHub (/pushgh owner/repo)' },
        { command: 'model', description: 'تغییر مدل Google Gemini' },
        { command: 'status', description: 'وضعیت سرویس و آمار ایجنت' },
        { command: 'reset', description: 'پاکسازی حافظه چت پروژه فعال' },
      ],
    });
    await setSetting('commands_synced_v2', '1');
  } catch {
    // Non-fatal
  }
}

export async function renderStatusHtml(userRow) {
  const hasGemini = Boolean(await resolveGeminiApiKey(userRow));
  const hasGithub = Boolean(await resolveGithubToken(userRow));
  const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject);
  const allProjects = await listProjects(userRow.tgId);

  return [
    '📊 <b>وضعیت Ahwaz Coding Agent (Telegram Serverless)</b>',
    '',
    `• <b>زیرساخت اجرا:</b> <code>Telegram Serverless V8 + SQLite</code>`,
    `• <b>نقش کاربری شما:</b> <code>${userRow.isAdmin ? 'Admin (مدیر)' : 'کاربر مجاز'}</code>`,
    `• <b>کلید Google Gemini:</b> ${hasGemini ? '🟢 ثبت‌شده و آماده' : '🔴 ثبت‌نشده (با /setkey ثبت کنید)'}`,
    `• <b>توکن GitHub:</b> ${hasGithub ? '🟢 متصل' : '⚪️ ثبت‌نشده (اختیاری - /setgithub)'}`,
    `• <b>مدل فعال:</b> <code>${escapeHtml(userRow.model)}</code>`,
    `• <b>پروژه فعال:</b> <code>${escapeHtml(userRow.activeProject)}</code> (${files.length} فایل)`,
    `• <b>تعداد کل پروژه‌ها:</b> <code>${allProjects.length}</code>`,
    `• <b>پرامپت‌ها / ابزارهای اجراشده:</b> <code>${userRow.promptCount}</code> / <code>${userRow.toolCallCount}</code>`,
  ].join('\n');
}

export async function handleSlashCommand(message, userRow) {
  const chatId = message.chat.id;
  const rawText = String(message.text ?? '').trim();
  const spaceIdx = rawText.indexOf(' ');
  const cmdToken = (spaceIdx === -1 ? rawText : rawText.slice(0, spaceIdx))
    .split('@')[0]
    .toLowerCase();
  const argText = spaceIdx === -1 ? '' : rawText.slice(spaceIdx + 1).trim();

  if (cmdToken === '/start') {
    await syncBotCommandsOnce();
    await ensureProject(userRow.tgId, userRow.activeProject);
    const hasGemini = Boolean(await resolveGeminiApiKey(userRow));
    const miniAppUrl = await getSetting('mini_app_url');

    const setupBanner = hasGemini
      ? '🟢 <b>کلید Google Gemini فعال است!</b> همین الان درخواست برنامه‌نویسی خود را بنویسید یا فایل/ZIP بفرستید.'
      : '⚠️ <b>گام اول راه‌اندازی:</b> کلید Gemini خود را بفرستید (پیام شما بلافاصله برای امنیت پاک می‌شود):\n<code>/setkey AIzaSy...</code>';

    const html = [
      `👨‍💻 <b>سلام ${escapeHtml(userRow.firstName || 'برنامه‌نویس')}! به ایجنت برنامه‌نویسی Ahwaz خوش آمدید.</b>`,
      '',
      'این ایجنت به صورت <b>۱۰۰٪ بومی روی زیرساخت ابری خود تلگرام (Telegram Serverless V8 + SQLite)</b> بدون نیاز به هیچ سرور خارجی اجرا می‌شود.',
      '',
      setupBanner,
      '',
      `📂 <b>پروژه فعال:</b> <code>${escapeHtml(userRow.activeProject)}</code>`,
      `🧠 <b>مدل فعال:</b> <code>${escapeHtml(userRow.model)}</code>`,
    ].join('\n');

    await api.sendMessage({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      reply_markup: buildMainDashboardKeyboard(miniAppUrl),
    });
    return true;
  }

  if (cmdToken === '/help') {
    const html = [
      '📚 <b>راهنمای کامل ایجنت برنامه‌نویسی (Telegram Serverless)</b>',
      '',
      '<b>۱. تنظیم کلیدها و دسترسی‌ها:</b>',
      '• <code>/setkey AIzaSy...</code> — ثبت امن کلید Google Gemini (پیام کلید خودکار حذف می‌شود)',
      '• <code>/setgithub ghp_...</code> — ثبت توکن GitHub برای Push و ریپوهای خصوصی',
      '• <code>/setminiapp https://app...tgcloud.ai</code> — اتصال دکمه استودیو وب Mini App',
      '• <code>/allow 123456789</code> — افزودن کاربر مجاز جدید (ویژه ادمین)',
      '',
      '<b>۲. مدیریت پروژه‌ها و فایل‌ها (SQLite Workspace):</b>',
      '• <code>/project my-api</code> — ساخت یا سوییچ به پروژه مجزا',
      '• <code>/projects</code> — مشاهده و انتخاب پروژه‌ها با دکمه شیشه‌ای',
      '• <code>/files</code> — نمایش درخت فایل‌های پروژه فعال',
      '• <code>/read src/index.js</code> — نمایش کد یک فایل',
      '• <code>/zip</code> — ساخت و دانلود آرشیو <code>.zip</code> کل پروژه',
      '• <b>آپلود فایل یا ZIP</b> — ذخیره یا اکسترکت مستقیم داخل پروژه فعال',
      '',
      '<b>۳. اتصال مستقیم به GitHub:</b>',
      '• <code>/importgh owner/repo [branch]</code> — ایمپورت مستقیم کدهای ریپو به Workspace',
      '• <code>/pushgh owner/repo [branch]</code> — کامیت و Push فایل‌های پروژه روی GitHub',
      '',
      '<b>۴. مدل هوش مصنوعی و حافظه:</b>',
      '• <code>/model [نام-مدل]</code> — انتخاب مدل Gemini (مثلاً gemini-2.5-pro)',
      '• <code>/reset</code> — پاکسازی حافظه چت پروژه فعلی',
      '• <code>/status</code> — وضعیت سلامت سرویس و آمار',
    ].join('\n');

    await api.sendMessage({ chat_id: chatId, text: html, parse_mode: 'HTML' });
    return true;
  }

  if (cmdToken === '/setkey') {
    // Delete message containing sensitive API key immediately
    try {
      await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    } catch {
      // ignore if already gone
    }

    if (!argText || argText.length < 15) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ فرمت کلید معتبر نیست. نمونه:\n<code>/setkey AIzaSyYourGeminiApiKey</code>',
        parse_mode: 'HTML',
      });
      return true;
    }

    await saveUserGeminiKey(userRow, argText);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ <b>کلید Google Gemini با موفقیت در دیتابیس امن ذخیره شد</b> (پیام حاوی کلید از چت پاک گردید).\nاکنون هر پروژه یا کدی می‌خواهید به فارسی یا انگلیسی بنویسید!',
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/setgithub') {
    try {
      await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    } catch {
      // ignore
    }

    if (!argText || argText.length < 10) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ نحوه استفاده:\n<code>/setgithub ghp_your_github_token</code>',
        parse_mode: 'HTML',
      });
      return true;
    }

    await saveUserGithubToken(userRow, argText);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ <b>توکن GitHub ذخیره شد</b> (پیام حاوی توکن برای امنیت پاک شد).',
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/setminiapp') {
    if (!userRow.isAdmin) {
      await api.sendMessage({ chat_id: chatId, text: '⛔️ این دستور مخصوص ادمین ربات است.' });
      return true;
    }
    if (!argText.startsWith('https://')) {
      await api.sendMessage({
        chat_id: chatId,
        text: '🔗 آدرس Mini App چاپ‌شده پس از `npx tgcloud push` را وارد کنید:\n<code>/setminiapp https://app12345.tgcloud.ai</code>',
        parse_mode: 'HTML',
      });
      return true;
    }
    await setSetting('mini_app_url', argText);
    await api.sendMessage({
      chat_id: chatId,
      text: `✅ دکمه Mini App Code Studio روی آدرس <code>${escapeHtml(argText)}</code> فعال شد! /start را بزنید.`,
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/allow' || cmdToken === '/disallow') {
    if (!userRow.isAdmin) {
      await api.sendMessage({ chat_id: chatId, text: '⛔️ فقط ادمین می‌تواند دسترسی کاربران را تغییر دهد.' });
      return true;
    }
    const targetId = Number(argText);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: `نحوه استفاده:\n<code>${cmdToken} 123456789</code>`,
        parse_mode: 'HTML',
      });
      return true;
    }
    const allow = cmdToken === '/allow';
    await setUserAccess(targetId, allow);
    await api.sendMessage({
      chat_id: chatId,
      text: allow
        ? `✅ دسترسی کاربر <code>${targetId}</code> فعال شد.`
        : `🚫 دسترسی کاربر <code>${targetId}</code> لغو شد.`,
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/project' || cmdToken === '/new') {
    if (!argText) {
      await api.sendMessage({
        chat_id: chatId,
        text: `📂 پروژه فعال فعلی: <code>${escapeHtml(userRow.activeProject)}</code>\nبرای ساخت یا سوییچ پروژه بنویسید:\n<code>/project my-new-app</code>`,
        parse_mode: 'HTML',
      });
      return true;
    }
    try {
      const cleanName = sanitizeProjectName(argText);
      await ensureProject(userRow.tgId, cleanName);
      await setActiveProject(userRow.tgId, cleanName);
      const files = await listWorkspaceFiles(userRow.tgId, cleanName);
      await api.sendMessage({
        chat_id: chatId,
        text: `✅ پروژه فعال به <code>${escapeHtml(cleanName)}</code> تغییر یافت (${files.length} فایل).`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return true;
  }

  if (cmdToken === '/projects') {
    const list = await listProjects(userRow.tgId);
    await api.sendMessage({
      chat_id: chatId,
      text: `🗂 <b>پروژه‌های شما (${list.length}):</b>\nپروژه فعال: <code>${escapeHtml(userRow.activeProject)}</code>`,
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(list, userRow.activeProject),
    });
    return true;
  }

  if (cmdToken === '/files') {
    const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject, argText);
    if (files.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: `📂 پروژه <code>${escapeHtml(userRow.activeProject)}</code> فعلاً خالی است.`,
        parse_mode: 'HTML',
      });
      return true;
    }
    const lines = files.map((f) => `${f.path} (${f.sizeBytes} B)`).join('\n');
    await api.sendMessage({
      chat_id: chatId,
      text: `📁 <b>فایل‌های پروژه <code>${escapeHtml(userRow.activeProject)}</code> (${files.length}):</b>\n<pre><code>${escapeHtml(lines.slice(0, 3500))}</code></pre>`,
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/read') {
    if (!argText) {
      await api.sendMessage({
        chat_id: chatId,
        text: '📖 نام فایل را وارد کنید؛ مثال:\n<code>/read src/index.js</code>',
        parse_mode: 'HTML',
      });
      return true;
    }
    const row = await readWorkspaceFile(userRow.tgId, userRow.activeProject, argText);
    if (!row) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ فایل <code>${escapeHtml(argText)}</code> پیدا نشد.`,
        parse_mode: 'HTML',
      });
      return true;
    }
    const ext = row.path.includes('.') ? row.path.split('.').pop() : '';
    await sendFormattedMessage({
      chatId,
      markdown: `📄 **${row.path}**\n\`\`\`${ext}\n${row.content}\n\`\`\``,
    });
    return true;
  }

  if (cmdToken === '/zip') {
    const { zipBytes, count } = await exportProjectZipBytes(
      userRow.tgId,
      userRow.activeProject,
    );
    if (!zipBytes || count === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: '⚠️ پروژه فعلی خالی است و فایلی برای ساخت ZIP ندارد.',
      });
      return true;
    }
    await sendDocumentBytes({
      chatId,
      bytes: zipBytes,
      fileName: `${userRow.activeProject}.zip`,
      mimeType: 'application/zip',
      caption: `📦 خروجی پروژه «${userRow.activeProject}» (${count} فایل)`,
    });
    return true;
  }

  if (cmdToken === '/importgh') {
    if (!argText) {
      await api.sendMessage({
        chat_id: chatId,
        text: '🌿 نحوه استفاده:\n<code>/importgh owner/repo [branch]</code>',
        parse_mode: 'HTML',
      });
      return true;
    }
    const [repoSpec, branch] = argText.split(/\s+/);
    const wait = await api.sendMessage({
      chat_id: chatId,
      text: `⏳ در حال دریافت فایل‌های ریپوزیتوری <code>${escapeHtml(repoSpec)}</code> از GitHub...`,
      parse_mode: 'HTML',
    });

    try {
      const githubToken = await resolveGithubToken(userRow);
      const res = await importGithubRepoToWorkspace({
        tgId: userRow.tgId,
        projectName: userRow.activeProject,
        repoSpec,
        branch,
        githubToken,
      });
      await api.editMessageText({
        chat_id: chatId,
        message_id: wait.message_id,
        text: `✅ تعداد <b>${res.importedCount}</b> فایل از <code>${escapeHtml(res.repo)}</code> (شاخه <code>${escapeHtml(res.branch)}</code>) وارد پروژه <code>${escapeHtml(userRow.activeProject)}</code> شد!`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: wait.message_id,
        text: `❌ ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
        parse_mode: 'HTML',
      });
    }
    return true;
  }

  if (cmdToken === '/pushgh') {
    if (!argText) {
      await api.sendMessage({
        chat_id: chatId,
        text: '🚀 نحوه استفاده:\n<code>/pushgh owner/repo [branch]</code>',
        parse_mode: 'HTML',
      });
      return true;
    }
    const parts = argText.split(/\s+/);
    const repoSpec = parts[0];
    const branch = parts[1] || 'main';
    const commitMessage =
      parts.slice(2).join(' ') || `feat: sync project ${userRow.activeProject} from Telegram`;

    const wait = await api.sendMessage({
      chat_id: chatId,
      text: `⏳ در حال ارسال فایل‌های پروژه <code>${escapeHtml(userRow.activeProject)}</code> به GitHub...`,
      parse_mode: 'HTML',
    });

    try {
      const githubToken = await resolveGithubToken(userRow);
      const res = await pushWorkspaceToGithub({
        tgId: userRow.tgId,
        projectName: userRow.activeProject,
        repoSpec,
        branch,
        commitMessage,
        githubToken,
      });
      await api.editMessageText({
        chat_id: chatId,
        message_id: wait.message_id,
        text: `✅ تعداد <b>${res.filesPushed}</b> فایل در کامیت <code>${escapeHtml(res.commitSha)}</code> روی <code>${escapeHtml(res.repo)}@${escapeHtml(res.branch)}</code> پوش شد!\n🔗 ${escapeHtml(res.commitUrl)}`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: wait.message_id,
        text: `❌ ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
        parse_mode: 'HTML',
      });
    }
    return true;
  }

  if (cmdToken === '/model') {
    if (argText) {
      await setActiveModel(userRow.tgId, argText);
      await api.sendMessage({
        chat_id: chatId,
        text: `✅ مدل هوش مصنوعی فعال به <code>${escapeHtml(argText)}</code> تغییر یافت.`,
        parse_mode: 'HTML',
      });
      return true;
    }
    await api.sendMessage({
      chat_id: chatId,
      text: `🤖 <b>مدل فعلی:</b> <code>${escapeHtml(userRow.model)}</code>\nیک مدل انتخاب کنید یا بنویسید <code>/model gemini-2.5-pro</code>:`,
      parse_mode: 'HTML',
      reply_markup: buildModelSelectorKeyboard(userRow.model),
    });
    return true;
  }

  if (cmdToken === '/reset') {
    await clearConversationHistory(userRow.tgId, userRow.activeProject);
    await api.sendMessage({
      chat_id: chatId,
      text: `🧹 حافظه گفتگوی پروژه <code>${escapeHtml(userRow.activeProject)}</code> پاکسازی شد (فایل‌های کد دست‌نخورده باقی ماندند).`,
      parse_mode: 'HTML',
    });
    return true;
  }

  if (cmdToken === '/status') {
    const html = await renderStatusHtml(userRow);
    await api.sendMessage({ chat_id: chatId, text: html, parse_mode: 'HTML' });
    return true;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: '❓ دستور شناخته نشد. برای مشاهده لیست دستورات /help را بزنید.',
  });
  return true;
}
