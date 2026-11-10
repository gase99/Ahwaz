import { api, EndpointError } from 'sdk';
import { runCodingAgent } from '../lib/agent/coding-agent.js';
import { ensureUser } from '../lib/services/auth-service.js';
import { sendDocumentBytes } from '../lib/services/delivery-service.js';
import { listWorkspaceFiles } from '../lib/services/workspace-service.js';

/**
 * Serverless Endpoint to run an AI coding prompt directly from the Mini App Studio (`POST /api/agent`).
 */
export default async function (input, ctx) {
  const caller = ctx?.initData?.user;
  if (!caller || !caller.id) {
    throw new EndpointError('کاربر احراز هویت نشد.', { code: 'UNAUTHORIZED' });
  }

  const userRow = await ensureUser(caller);
  if (!userRow.isAdmin && !userRow.isAllowed) {
    throw new EndpointError('دسترسی مجاز نیست.', { code: 'FORBIDDEN' });
  }

  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt) {
    throw new EndpointError('متن درخواست نمی‌تواند خالی باشد.', { code: 'EMPTY_PROMPT' });
  }

  try {
    const result = await runCodingAgent({
      userRow,
      prompt,
      attachedNotes: [],
    });

    // Deliver any exported ZIP/files straight to the user's private Telegram chat
    for (const artifact of result.artifacts) {
      await sendDocumentBytes({
        chatId: userRow.tgId,
        bytes: artifact.bytes,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        caption: artifact.caption,
      }).catch(() => undefined);
    }

    if (input?.notifyChat) {
      await api
        .sendMessage({
          chat_id: userRow.tgId,
          text: `✅ تسک ارسالی از استودیو Mini App روی پروژه «${result.projectName}» انجام شد.`,
        })
        .catch(() => undefined);
    }

    const files = await listWorkspaceFiles(userRow.tgId, result.projectName);
    return {
      replyText: result.replyText,
      projectName: result.projectName,
      toolCallsExecuted: result.toolCallsExecuted,
      files,
    };
  } catch (err) {
    throw new EndpointError(
      err instanceof Error ? err.message : String(err),
      { code: 'AGENT_ERROR' },
    );
  }
}
