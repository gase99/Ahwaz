import { InputFile, type Bot, type Context, type InlineKeyboard } from 'grammy';
import fs from 'node:fs/promises';
import { logger } from '../../config/logger.js';
import type { AgentProgressEvent, ArtifactDelivery } from '../../types/agent.js';

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Splits long Markdown into safe chunks while preserving fenced code blocks across boundaries.
 */
export function chunkMarkdownSafely(markdown: string, maxChunkLength = 3400): string[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];
  if (normalized.length <= maxChunkLength) return [normalized];

  const lines = normalized.split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLen = 0;
  let openFenceLang: string | null = null;

  const flushChunk = () => {
    if (currentLines.length === 0) return;
    if (openFenceLang !== null) {
      currentLines.push('```');
    }
    chunks.push(currentLines.join('\n'));
    currentLines = [];
    currentLen = 0;
    if (openFenceLang !== null) {
      const reopen = `\`\`\`${openFenceLang}`;
      currentLines.push(reopen);
      currentLen = reopen.length + 1;
    }
  };

  for (const rawLine of lines) {
    // Handle single extra-long line exceeding maxChunkLength
    const subLines: string[] = [];
    if (rawLine.length > maxChunkLength - 50) {
      for (let i = 0; i < rawLine.length; i += maxChunkLength - 80) {
        subLines.push(rawLine.slice(i, i + (maxChunkLength - 80)));
      }
    } else {
      subLines.push(rawLine);
    }

    for (const line of subLines) {
      const nextLen = currentLen + line.length + 1;
      if (currentLines.length > 0 && nextLen > maxChunkLength) {
        flushChunk();
      }

      currentLines.push(line);
      currentLen += line.length + 1;

      const fenceMatch = line.trimStart().match(/^```([a-zA-Z0-9_+-]*)\s*$/);
      if (fenceMatch) {
        if (openFenceLang === null) {
          openFenceLang = fenceMatch[1] ?? '';
        } else {
          openFenceLang = null;
        }
      }
    }
  }

  if (currentLines.length > 0) {
    if (openFenceLang !== null) {
      currentLines.push('```');
      openFenceLang = null;
    }
    chunks.push(currentLines.join('\n'));
  }

  return chunks;
}

/**
 * Converts LLM Markdown into clean, safe Telegram HTML (`parse_mode: 'HTML'`).
 */
export function markdownToTelegramHtml(markdown: string): string {
  const placeholders: string[] = [];
  const stash = (htmlSnippet: string): string => {
    const idx = placeholders.length;
    placeholders.push(htmlSnippet);
    return `\x00TGPH_${idx}_\x00`;
  };

  // 1. Extract fenced code blocks first
  let text = markdown.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const cleanCode = escapeHtml(String(code).replace(/\n$/, ''));
    const langAttr = lang ? ` class="language-${escapeHtml(String(lang))}"` : '';
    return stash(`<pre><code${langAttr}>${cleanCode}</code></pre>`);
  });

  // 2. Extract inline code spans
  text = text.replace(/`([^`\n]+)`/g, (_match, inlineCode) => {
    return stash(`<code>${escapeHtml(String(inlineCode))}</code>`);
  });

  // 3. Escape remaining HTML special chars
  text = escapeHtml(text);

  // 4. Convert Markdown headings, bold, links
  text = text.replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // 5. Restore code block & inline code placeholders
  text = text.replace(/\x00TGPH_(\d+)_\x00/g, (_m, idStr) => {
    return placeholders[Number(idStr)] ?? '';
  });

  return text;
}

export interface LiveProgressTracker {
  onProgress: (event: AgentProgressEvent) => Promise<void>;
  complete: (summaryLine?: string) => Promise<void>;
  dismiss: () => Promise<void>;
}

export class TelegramDeliveryService {
  constructor(private readonly bot: Bot<Context>) {}

  async sendFormattedReply(options: {
    chatId: number;
    markdown: string;
    replyToMessageId?: number;
    replyMarkup?: InlineKeyboard;
  }): Promise<void> {
    const chunks = chunkMarkdownSafely(options.markdown, 3400);

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkMd = chunks[i];
      const html = markdownToTelegramHtml(chunkMd);

      try {
        await this.bot.api.sendMessage(options.chatId, html, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_parameters:
            i === 0 && options.replyToMessageId
              ? { message_id: options.replyToMessageId }
              : undefined,
          reply_markup: isLast ? options.replyMarkup : undefined,
        });
      } catch (err) {
        logger.warn({ err }, 'ارسال HTML ناموفق بود؛ ارسال به صورت متن ساده');
        await this.bot.api.sendMessage(options.chatId, chunkMd.slice(0, 4000), {
          reply_markup: isLast ? options.replyMarkup : undefined,
        });
      }
    }
  }

  async createLiveTracker(options: {
    chatId: number;
    projectName: string;
    cancelKeyboard?: InlineKeyboard;
  }): Promise<LiveProgressTracker> {
    const historyLines: string[] = [];
    let currentHeader = `🚀 <b>ایجنت کدنویسی فعال شد</b> | پروژه: <code>${escapeHtml(options.projectName)}</code>`;
    let lastEditedAt = 0;
    let lastRenderedText = '';

    const sent = await this.bot.api.sendMessage(
      options.chatId,
      `${currentHeader}\n⏳ در حال ارسال درخواست به Google Gemini...`,
      {
        parse_mode: 'HTML',
        reply_markup: options.cancelKeyboard,
      },
    );

    const renderBody = () => {
      const recent = historyLines.slice(-8);
      return [currentHeader, '', ...recent].join('\n');
    };

    const safeEdit = async (text: string, withKeyboard: boolean, force = false) => {
      const now = Date.now();
      if (!force && now - lastEditedAt < 1500) return;
      if (text === lastRenderedText && !force) return;

      lastEditedAt = now;
      lastRenderedText = text;
      try {
        await this.bot.api.editMessageText(options.chatId, sent.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: withKeyboard ? options.cancelKeyboard : undefined,
        });
      } catch {
        // Ignore harmless "message is not modified" or rate-limit hiccups
      }
    };

    return {
      onProgress: async (event: AgentProgressEvent) => {
        if (event.phase === 'thinking') {
          currentHeader = `⚙️ <b>پروژه:</b> <code>${escapeHtml(options.projectName)}</code> — ${escapeHtml(event.label)}`;
        } else if (event.phase === 'tool_start') {
          historyLines.push(`⏳ ${escapeHtml(event.label)}`);
        } else if (event.phase === 'tool_done') {
          const lastIdx = historyLines.length - 1;
          if (lastIdx >= 0 && historyLines[lastIdx].startsWith('⏳')) {
            historyLines[lastIdx] = `✅ ${escapeHtml(event.label)}`;
          } else {
            historyLines.push(`✅ ${escapeHtml(event.label)}`);
          }
        } else if (event.phase === 'tool_error') {
          const lastIdx = historyLines.length - 1;
          if (lastIdx >= 0 && historyLines[lastIdx].startsWith('⏳')) {
            historyLines[lastIdx] = `⚠️ ${escapeHtml(event.label)}`;
          } else {
            historyLines.push(`⚠️ ${escapeHtml(event.label)}`);
          }
        }
        await safeEdit(renderBody(), true, false);
      },

      complete: async (summaryLine?: string) => {
        if (historyLines.length === 0) {
          // No tools were called -> remove progress message cleanly so chat stays uncluttered
          try {
            await this.bot.api.deleteMessage(options.chatId, sent.message_id);
          } catch {
            // ignore
          }
          return;
        }
        currentHeader = summaryLine
          ? `✅ <b>${escapeHtml(summaryLine)}</b>`
          : `✅ <b>عملیات روی پروژه <code>${escapeHtml(options.projectName)}</code> تکمیل شد</b>`;
        await safeEdit(renderBody(), false, true);
      },

      dismiss: async () => {
        try {
          await this.bot.api.deleteMessage(options.chatId, sent.message_id);
        } catch {
          // ignore
        }
      },
    };
  }

  async sendArtifacts(chatId: number, artifacts: ArtifactDelivery[]): Promise<void> {
    for (const artifact of artifacts) {
      try {
        await this.bot.api.sendChatAction(chatId, 'upload_document');
        await this.bot.api.sendDocument(
          chatId,
          new InputFile(artifact.filePath, artifact.fileName),
          {
            caption: artifact.caption,
          },
        );
      } catch (err) {
        logger.error({ err, artifact }, 'خطا در ارسال فایل به تلگرام');
        await this.bot.api.sendMessage(
          chatId,
          `⚠️ خطا در ارسال فایل «${artifact.fileName}»: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        // Clean up temporary zip files created in os.tmpdir()
        if (artifact.filePath.includes('ahwaz-zip-')) {
          await fs.rm(artifact.filePath, { force: true }).catch(() => undefined);
        }
      }
    }
  }
}
