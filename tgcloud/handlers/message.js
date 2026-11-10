import { api } from 'sdk';
import { runCodingAgent } from '../lib/agent/coding-agent.js';
import { ensureUser } from '../lib/services/auth-service.js';
import { bytesToUtf8 } from '../lib/services/binary-utils.js';
import { handleSlashCommand } from '../lib/services/command-service.js';
import {
  createLiveProgressTracker,
  escapeHtml,
  sendDocumentBytes,
  sendFormattedMessage,
} from '../lib/services/delivery-service.js';
import { buildAfterReplyKeyboard } from '../lib/services/keyboard-service.js';
import {
  importZipIntoWorkspace,
  writeWorkspaceFile,
} from '../lib/services/workspace-service.js';

export default async function (message) {
  if (!message || !message.from || !message.chat) return;

  const chatId = message.chat.id;
  const userRow = await ensureUser(message.from);

  if (!userRow.isAdmin && !userRow.isAllowed) {
    await api.sendMessage({
      chat_id: chatId,
      text: `⛔️ دسترسی شما به این ایجنت مجاز نیست.\nشناسه عددی تلگرام شما: <code>${userRow.tgId}</code>\n(ادمین ربات می‌تواند با دستور <code>/allow ${userRow.tgId}</code> دسترسی شما را فعال کند.)`,
      parse_mode: 'HTML',
    });
    return;
  }

  // 1. Handle uploaded documents (.zip archives or source files)
  if (message.document) {
    const doc = message.document;
    const fileName = String(doc.file_name || 'uploaded.txt').trim();
    const caption = String(message.caption || '').trim();

    try {
      const bytes = await api.getFileContent(doc.file_id);
      let attachedNotes = [];

      if (fileName.toLowerCase().endsWith('.zip')) {
        const savedPaths = await importZipIntoWorkspace(
          userRow.tgId,
          userRow.activeProject,
          bytes,
        );
        attachedNotes = [
          `ZIP "${fileName}" extracted (${savedPaths.length} files): ${savedPaths.slice(0, 25).join(', ')}`,
        ];

        if (!caption) {
          await api.sendMessage({
            chat_id: chatId,
            text: `📦 آرشیو <code>${escapeHtml(fileName)}</code> با موفقیت در پروژه <code>${escapeHtml(userRow.activeProject)}</code> استخراج شد (${savedPaths.length} فایل).\nحالا دستور برنامه‌نویسی خود را ارسال کنید!`,
            parse_mode: 'HTML',
          });
          return;
        }
      } else {
        const textContent = bytesToUtf8(bytes);
        await writeWorkspaceFile(
          userRow.tgId,
          userRow.activeProject,
          fileName,
          textContent,
        );
        attachedNotes = [`Uploaded file saved at "${fileName}"`];

        if (!caption) {
          await api.sendMessage({
            chat_id: chatId,
            text: `📄 فایل <code>${escapeHtml(fileName)}</code> در پروژه <code>${escapeHtml(userRow.activeProject)}</code> ذخیره شد.\nحالا هر تغییر یا دیباگی می‌خواهید بنویسید!`,
            parse_mode: 'HTML',
          });
          return;
        }
      }

      await runAndDeliverAgentTurn({
        chatId,
        replyToMessageId: message.message_id,
        userRow,
        prompt: caption,
        attachedNotes,
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ خطا در پردازش فایل ارسالی: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return;
  }

  const text = String(message.text ?? '').trim();
  if (!text) return;

  // 2. Handle slash commands
  if (text.startsWith('/')) {
    await handleSlashCommand(message, userRow);
    return;
  }

  // 3. Handle natural language / coding prompts
  await runAndDeliverAgentTurn({
    chatId,
    replyToMessageId: message.message_id,
    userRow,
    prompt: text,
    attachedNotes: [],
  });
}

async function runAndDeliverAgentTurn({
  chatId,
  replyToMessageId,
  userRow,
  prompt,
  attachedNotes,
}) {
  await api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => undefined);

  const tracker = await createLiveProgressTracker({
    chatId,
    projectName: userRow.activeProject,
  });

  try {
    const result = await runCodingAgent({
      userRow,
      prompt,
      attachedNotes,
      onProgress: (ev) => tracker.update(ev),
    });

    await tracker.finish(
      `تکمیل شد (${result.toolCallsExecuted.length} عملیات در پروژه ${result.projectName})`,
    );

    await sendFormattedMessage({
      chatId,
      markdown: result.replyText,
      replyToMessageId,
      replyMarkup: buildAfterReplyKeyboard(),
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
    await tracker.dismiss();
    await api.sendMessage({
      chat_id: chatId,
      text: `❌ <b>خطا در اجرای ایجنت:</b>\n<code>${escapeHtml(err instanceof Error ? err.message : String(err))}</code>`,
      parse_mode: 'HTML',
    });
  }
}
