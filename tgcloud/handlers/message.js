import { api } from 'sdk';
import { runCodingAgent } from '../lib/agent/coding-agent.js';
import { ensureUser } from '../lib/services/auth-service.js';
import { bytesToUtf8 } from '../lib/services/binary-utils.js';
import { handleSlashCommand } from '../lib/services/command-service.js';
import {
  sendDocumentBytes,
  sendSafeText,
} from '../lib/services/delivery-service.js';
import { buildPostAnswerKeyboard } from '../lib/services/keyboard-service.js';
import {
  ensureProject,
  importZipIntoWorkspace,
  writeWorkspaceFile,
} from '../lib/services/workspace-service.js';

async function ingestTelegramDocument(msg, userRow) {
  const doc = msg.document;
  const fileName = doc.file_name || 'uploaded_file.txt';
  const activeProject = userRow.activeProject || 'default';
  await ensureProject(userRow.tgId, activeProject);

  if (doc.file_size && doc.file_size > 15 * 1024 * 1024) {
    throw new Error('حجم فایل ارسالی بیش از سقف مجاز ۱۵ مگابایت است.');
  }

  const fileBytes = await api.getFileContent(doc.file_id);

  if (fileName.toLowerCase().endsWith('.zip')) {
    const savedPaths = await importZipIntoWorkspace(userRow.tgId, activeProject, fileBytes);
    return {
      kind: 'zip',
      imported: savedPaths.length,
      summary: `آرشیو ZIP با نام \`${fileName}\` استخراج شد و ${savedPaths.length} فایل در پروژه \`${activeProject}\` ذخیره گردید.`,
    };
  }

  const content = bytesToUtf8(fileBytes);
  const saved = await writeWorkspaceFile(userRow.tgId, activeProject, fileName, content);
  return {
    kind: 'file',
    imported: 1,
    path: saved.path,
    summary: `فایل \`${saved.path}\` (${saved.sizeBytes} بایت) در پروژه \`${activeProject}\` ذخیره شد.`,
  };
}

export default async function handleMessage(msg) {
  if (!msg || !msg.from || !msg.chat) return;

  const chatId = msg.chat.id;
  const userRow = await ensureUser(msg.from);

  if (typeof msg.text === 'string' && msg.text.trim().startsWith('/')) {
    const handled = await handleSlashCommand(msg, userRow);
    if (handled) return;
  }

  if (!userRow.isAllowed) {
    await sendSafeText(
      chatId,
      `⛔ دسترسی شما به این ایجنت مجاز نیست (\`${userRow.tgId}\`). از ادمین بخواهید \`/allow ${userRow.tgId}\` را اجرا کند.`,
    );
    return;
  }

  const attachedNotes = [];
  if (msg.document) {
    try {
      const ingestResult = await ingestTelegramDocument(msg, userRow);
      const captionPrompt = (msg.caption || msg.text || '').trim();
      if (!captionPrompt) {
        await sendSafeText(
          chatId,
          `✅ ${ingestResult.summary}\n\nحالا می‌توانید از ایجنت بخواهید فایل‌ها را بررسی، تکمیل یا دیباگ کند!`,
          { reply_markup: buildPostAnswerKeyboard(userRow.activeProject || 'default') },
        );
        return;
      }
      attachedNotes.push(`[فایل پیوست‌شده توسط کاربر وارد پروژه شد: ${ingestResult.summary}]`);
    } catch (err) {
      await sendSafeText(chatId, `❌ خطا در پردازش فایل ارسالی: ${err?.message ?? err}`);
      return;
    }
  }

  const effectivePrompt = (msg.text || msg.caption || '').trim();
  if (!effectivePrompt) return;

  const statusMsg = await sendSafeText(
    chatId,
    `🧠 ایجنت کدنویسی اهواز (پروژه \`${userRow.activeProject || 'default'}\`) در حال تحلیل درخواست شما...`,
  );

  let lastEditMs = 0;
  const updateProgress = async (info) => {
    const now = Date.now();
    if (now - lastEditMs < 1400) return;
    lastEditMs = now;
    const recentTools = info.toolLogs.slice(-4).join('\n');
    const text = [
      `🤖 [${info.providerBadge} • ${info.model}] (گام ${info.step})`,
      info.phase === 'tool'
        ? `در حال اجرا: ${info.currentTool}`
        : `💭 در حال تفکر و کدنویسی...`,
      recentTools ? `\nعملیات انجام‌شده:\n${recentTools}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: statusMsg.message_id,
        text,
      });
    } catch {
      // Ignore rate limit or identical text error
    }
  };

  try {
    await api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => undefined);
    const result = await runCodingAgent({
      userRow,
      prompt: effectivePrompt,
      attachedNotes,
      onProgress: updateProgress,
    });

    try {
      await api.deleteMessage({ chat_id: chatId, message_id: statusMsg.message_id });
    } catch {
      // Ignore if unable to delete status placeholder
    }

    const headerLine = `🌐 ${result.providerBadge} • \`${result.model}\`${
      result.routedVia ? ` _(via ${result.routedVia})_` : ''
    }`;
    const toolSummaryBlock =
      result.toolLogs.length > 0
        ? `\n\n━━━━━━━━━━━━━━\n🛠️ **ابزارهای اجراشده (${result.toolLogs.length}):**\n` +
          result.toolLogs.slice(-8).map((l) => `• ${l}`).join('\n') +
          `\n${headerLine}`
        : `\n\n_${headerLine}_`;

    await sendSafeText(chatId, `${result.replyText}${toolSummaryBlock}`, {
      reply_markup: buildPostAnswerKeyboard(result.projectName),
    });

    for (const artifact of result.artifacts) {
      await sendDocumentBytes({
        chatId,
        bytes: artifact.bytes,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        caption: artifact.caption,
      });
    }
  } catch (err) {
    const errText = `❌ خطا در اجرای ایجنت:\n${err?.message ?? err}`;
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: statusMsg.message_id,
        text: errText,
      });
    } catch {
      await sendSafeText(chatId, errText);
    }
  }
}
