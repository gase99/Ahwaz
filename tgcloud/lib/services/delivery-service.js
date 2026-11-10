import { api, InputFile } from 'sdk';

export function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function chunkMarkdownSafely(markdown, maxChunkLength = 3400) {
  const normalized = String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!normalized) return [''];
  if (normalized.length <= maxChunkLength) return [normalized];

  const lines = normalized.split('\n');
  const chunks = [];
  let currentLines = [];
  let currentLen = 0;
  let openFenceLang = null;

  const flush = () => {
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
    const subLines = [];
    if (rawLine.length > maxChunkLength - 60) {
      for (let i = 0; i < rawLine.length; i += maxChunkLength - 80) {
        subLines.push(rawLine.slice(i, i + (maxChunkLength - 80)));
      }
    } else {
      subLines.push(rawLine);
    }

    for (const line of subLines) {
      if (currentLines.length > 0 && currentLen + line.length + 1 > maxChunkLength) {
        flush();
      }
      currentLines.push(line);
      currentLen += line.length + 1;

      const fenceMatch = line.trimStart().match(/^```([a-zA-Z0-9_+-]*)\s*$/);
      if (fenceMatch) {
        openFenceLang = openFenceLang === null ? (fenceMatch[1] ?? '') : null;
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

export function markdownToTelegramHtml(markdown) {
  const placeholders = [];
  const stash = (snippet) => {
    const idx = placeholders.length;
    placeholders.push(snippet);
    return `\x00TGPH_${idx}_\x00`;
  };

  let text = String(markdown ?? '').replace(
    /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
    (_m, lang, code) => {
      const cleanCode = escapeHtml(String(code).replace(/\n$/, ''));
      const langAttr = lang ? ` class="language-${escapeHtml(String(lang))}"` : '';
      return stash(`<pre><code${langAttr}>${cleanCode}</code></pre>`);
    },
  );

  text = text.replace(/`([^`\n]+)`/g, (_m, inline) => {
    return stash(`<code>${escapeHtml(String(inline))}</code>`);
  });

  text = escapeHtml(text);
  text = text.replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  text = text.replace(/\x00TGPH_(\d+)_\x00/g, (_m, idStr) => {
    return placeholders[Number(idStr)] ?? '';
  });

  return text;
}

export async function sendFormattedMessage({
  chatId,
  markdown,
  replyToMessageId,
  replyMarkup,
}) {
  const chunks = chunkMarkdownSafely(markdown, 3400);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const html = markdownToTelegramHtml(chunks[i]);
    const params = {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };

    if (i === 0 && replyToMessageId) {
      params.reply_parameters = { message_id: replyToMessageId };
    }
    if (isLast && replyMarkup) {
      params.reply_markup = replyMarkup;
    }

    try {
      await api.sendMessage(params);
    } catch {
      const plainParams = {
        chat_id: chatId,
        text: chunks[i].slice(0, 4000),
      };
      if (isLast && replyMarkup) plainParams.reply_markup = replyMarkup;
      await api.sendMessage(plainParams);
    }
  }
}

export async function createLiveProgressTracker({ chatId, projectName }) {
  const logLines = [];
  let header = `⚙️ <b>ایجنت روی Telegram Serverless</b> | پروژه: <code>${escapeHtml(projectName)}</code>`;
  let lastEditedAt = 0;
  let lastBody = '';

  const sent = await api.sendMessage({
    chat_id: chatId,
    text: `${header}\n⏳ در حال ارسال درخواست به Google Gemini...`,
    parse_mode: 'HTML',
  });

  const render = () => [header, '', ...logLines.slice(-8)].join('\n');

  const safeEdit = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEditedAt < 1400) return;
    const body = render();
    if (!force && body === lastBody) return;

    lastEditedAt = now;
    lastBody = body;
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: sent.message_id,
        text: body,
        parse_mode: 'HTML',
      });
    } catch {
      // Ignore harmless rate limit or unchanged message errors
    }
  };

  return {
    async update(event) {
      if (event.phase === 'thinking') {
        header = `🧠 <b>پروژه:</b> <code>${escapeHtml(projectName)}</code> — ${escapeHtml(event.label)}`;
      } else if (event.phase === 'tool_start') {
        logLines.push(`⏳ ${escapeHtml(event.label)}`);
      } else if (event.phase === 'tool_done') {
        const lastIdx = logLines.length - 1;
        if (lastIdx >= 0 && logLines[lastIdx].startsWith('⏳')) {
          logLines[lastIdx] = `✅ ${escapeHtml(event.label)}`;
        } else {
          logLines.push(`✅ ${escapeHtml(event.label)}`);
        }
      } else if (event.phase === 'tool_error') {
        const lastIdx = logLines.length - 1;
        if (lastIdx >= 0 && logLines[lastIdx].startsWith('⏳')) {
          logLines[lastIdx] = `⚠️ ${escapeHtml(event.label)}`;
        } else {
          logLines.push(`⚠️ ${escapeHtml(event.label)}`);
        }
      }
      await safeEdit(false);
    },

    async finish(summaryText) {
      if (logLines.length === 0) {
        try {
          await api.deleteMessage({ chat_id: chatId, message_id: sent.message_id });
        } catch {
          // ignore
        }
        return;
      }
      header = `✅ <b>${escapeHtml(summaryText)}</b>`;
      await safeEdit(true);
    },

    async dismiss() {
      try {
        await api.deleteMessage({ chat_id: chatId, message_id: sent.message_id });
      } catch {
        // ignore
      }
    },
  };
}

export async function sendDocumentBytes({
  chatId,
  bytes,
  fileName,
  mimeType = 'application/octet-stream',
  caption,
}) {
  await api
    .sendChatAction({ chat_id: chatId, action: 'upload_document' })
    .catch(() => undefined);

  await api.sendDocument({
    chat_id: chatId,
    document: new InputFile(bytes, fileName, { type: mimeType }),
    caption,
  });
}
