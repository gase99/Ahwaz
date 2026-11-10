import { api } from 'sdk';
import {
  ensureUser,
  setActiveModel,
  setActiveProject,
} from '../lib/services/auth-service.js';
import { renderStatusHtml } from '../lib/services/command-service.js';
import { clearConversationHistory } from '../lib/services/conversation-service.js';
import {
  escapeHtml,
  sendDocumentBytes,
} from '../lib/services/delivery-service.js';
import {
  buildModelSelectorKeyboard,
  buildProjectsKeyboard,
} from '../lib/services/keyboard-service.js';
import {
  ensureProject,
  exportProjectZipBytes,
  listProjects,
  listWorkspaceFiles,
  sanitizeProjectName,
} from '../lib/services/workspace-service.js';

export default async function (callbackQuery) {
  if (!callbackQuery || !callbackQuery.from) return;

  const queryId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = String(callbackQuery.data ?? '');

  const userRow = await ensureUser(callbackQuery.from);
  if (!userRow.isAdmin && !userRow.isAllowed) {
    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: `⛔️ دسترسی غیرمجاز (ID: ${userRow.tgId})`,
      show_alert: true,
    });
    return;
  }

  if (data === 'cb:files' && chatId) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject);
    const body =
      files.length === 0
        ? `📂 پروژه <code>${escapeHtml(userRow.activeProject)}</code> فعلاً خالی است.`
        : `📁 <b>فایل‌های پروژه <code>${escapeHtml(userRow.activeProject)}</code> (${files.length}):</b>\n<pre><code>${escapeHtml(
            files
              .map((f) => `${f.path} (${f.sizeBytes} B)`)
              .join('\n')
              .slice(0, 3500),
          )}</code></pre>`;
    await api.sendMessage({ chat_id: chatId, text: body, parse_mode: 'HTML' });
    return;
  }

  if (data === 'cb:zip' && chatId) {
    const { zipBytes, count } = await exportProjectZipBytes(
      userRow.tgId,
      userRow.activeProject,
    );
    if (!zipBytes || count === 0) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: 'پروژه فعلی خالی است!',
        show_alert: true,
      });
      return;
    }
    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: 'در حال ارسال فایل ZIP...',
    });
    await sendDocumentBytes({
      chatId,
      bytes: zipBytes,
      fileName: `${userRow.activeProject}.zip`,
      mimeType: 'application/zip',
      caption: `📦 خروجی پروژه «${userRow.activeProject}» (${count} فایل)`,
    });
    return;
  }

  if (data === 'cb:projects' && chatId) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const list = await listProjects(userRow.tgId);
    await api.sendMessage({
      chat_id: chatId,
      text: `🗂 <b>انتخاب پروژه فعال:</b>`,
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(list, userRow.activeProject),
    });
    return;
  }

  if (data === 'cb:models' && chatId) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    await api.sendMessage({
      chat_id: chatId,
      text: `🤖 <b>انتخاب مدل Google Gemini:</b>`,
      parse_mode: 'HTML',
      reply_markup: buildModelSelectorKeyboard(userRow.model),
    });
    return;
  }

  if (data === 'cb:status' && chatId) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const html = await renderStatusHtml(userRow);
    await api.sendMessage({ chat_id: chatId, text: html, parse_mode: 'HTML' });
    return;
  }

  if (data === 'cb:reset' && chatId) {
    await clearConversationHistory(userRow.tgId, userRow.activeProject);
    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: '🧹 حافظه گفتگوی پروژه پاک شد.',
    });
    await api.sendMessage({
      chat_id: chatId,
      text: `🧹 حافظه چت پروژه <code>${escapeHtml(userRow.activeProject)}</code> پاکسازی شد.`,
      parse_mode: 'HTML',
    });
    return;
  }

  if (data.startsWith('cb:set_model:') && chatId && messageId) {
    const modelId = data.slice('cb:set_model:'.length);
    await setActiveModel(userRow.tgId, modelId);
    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: `مدل فعال: ${modelId}`,
    });
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `✅ مدل هوش مصنوعی فعال به <code>${escapeHtml(modelId)}</code> تغییر یافت.`,
      parse_mode: 'HTML',
      reply_markup: buildModelSelectorKeyboard(modelId),
    });
    return;
  }

  if (data.startsWith('cb:switch_proj:') && chatId && messageId) {
    const rawName = data.slice('cb:switch_proj:'.length);
    const cleanName = sanitizeProjectName(rawName);
    await ensureProject(userRow.tgId, cleanName);
    await setActiveProject(userRow.tgId, cleanName);
    const list = await listProjects(userRow.tgId);
    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: `پروژه فعال: ${cleanName}`,
    });
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `✅ پروژه فعال به <code>${escapeHtml(cleanName)}</code> تغییر یافت.`,
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(list, cleanName),
    });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: queryId });
}
