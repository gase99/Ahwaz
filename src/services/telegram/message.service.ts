import type { Context } from 'grammy';
import type { CodingAgent } from '../../agent/coding-agent.js';
import { logger } from '../../config/logger.js';
import type { SessionService } from '../session.service.js';
import type { TelegramTaskCoordinator } from './auth.middleware.js';
import type { TelegramBotApiService } from './bot-api.service.js';
import { escapeHtml, type TelegramDeliveryService } from './delivery.service.js';
import type { TelegramFileIngestService } from './file-ingest.service.js';
import { TelegramKeyboardService } from './keyboard.service.js';

export class TelegramMessageService {
  constructor(
    private readonly botApi: TelegramBotApiService,
    private readonly delivery: TelegramDeliveryService,
    private readonly fileIngest: TelegramFileIngestService,
    private readonly sessionService: SessionService,
    private readonly codingAgent: CodingAgent,
    private readonly coordinator: TelegramTaskCoordinator,
  ) {}

  bindHandlers(): void {
    const bot = this.botApi.bot;

    bot.on('message:document', (ctx) => this.handleDocumentMessage(ctx));
    bot.on('message:text', (ctx) => this.handleTextMessage(ctx));
  }

  private async handleDocumentMessage(ctx: Context): Promise<void> {
    const doc = ctx.message?.document;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!doc || !userId || !chatId) return;

    if (this.coordinator.isBusy(userId)) {
      await ctx.reply(
        '⏳ ایجنت هم‌اکنون در حال اجرای تسک قبلی شماست. لطفاً صبر کنید یا دکمه توقف (/cancel) را بزنید.',
        { reply_markup: TelegramKeyboardService.cancelExecution() },
      );
      return;
    }

    const session = await this.sessionService.getSession(userId, ctx.from?.username);
    const caption = ctx.message?.caption?.trim() ?? '';

    try {
      const summary = await this.fileIngest.ingestDocument({
        userId,
        projectName: session.activeProject,
        fileId: doc.file_id,
        fileName: doc.file_name,
      });

      const sourceNote =
        summary.sourceMode === 'local_volume'
          ? 'خوانش مستقیم از دیسک Local Bot API Server'
          : 'دریافت از طریق Bot API';

      if (!caption) {
        const desc = summary.isZipExtracted
          ? `📦 آرشیو <code>${escapeHtml(summary.originalName)}</code> اکسترکت شد (${summary.savedPaths.length} فایل در پروژه <code>${escapeHtml(session.activeProject)}</code> — ${sourceNote}).\nحالا هر تغییری یا تحلیلی نیاز دارید بنویسید!`
          : `📄 فایل <code>${escapeHtml(summary.originalName)}</code> در پروژه <code>${escapeHtml(session.activeProject)}</code> ذخیره شد (${sourceNote}).\nحالا دستور برنامه‌نویسی خود را ارسال کنید!`;
        await ctx.reply(desc, {
          parse_mode: 'HTML',
          reply_markup: TelegramKeyboardService.mainDashboard(),
        });
        return;
      }

      const attachedInfo = summary.isZipExtracted
        ? [
            `ZIP "${summary.originalName}" extracted (${summary.savedPaths.length} files): ${summary.savedPaths.slice(0, 25).join(', ')}`,
          ]
        : [`Uploaded file saved as "${summary.originalName}"`];

      this.launchAgentBackgroundJob({
        ctx,
        userId,
        chatId,
        prompt: caption,
        attachedFilesInfo: attachedInfo,
      });
    } catch (err) {
      logger.error({ err, userId }, 'خطا در پردازش فایل ارسالی تلگرام');
      await ctx.reply(`❌ خطا در دریافت فایل: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    const text = ctx.message?.text?.trim();
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!text || !userId || !chatId) return;

    if (text.startsWith('/')) {
      await ctx.reply('❓ دستور شناخته نشد. برای مشاهده دستورات مجاز /help را ارسال کنید.');
      return;
    }

    if (this.coordinator.isBusy(userId)) {
      await ctx.reply(
        '⏳ ایجنت هم‌اکنون در حال اجرای تسک قبلی شماست. لطفاً صبر کنید یا /cancel را بزنید.',
        { reply_markup: TelegramKeyboardService.cancelExecution() },
      );
      return;
    }

    this.launchAgentBackgroundJob({
      ctx,
      userId,
      chatId,
      prompt: text,
    });
  }

  /**
   * Launches the CodingAgent job without blocking grammY's update loop,
   * allowing `/cancel` and inline `cb:cancel` callbacks to respond immediately.
   */
  private launchAgentBackgroundJob(params: {
    ctx: Context;
    userId: number;
    chatId: number;
    prompt: string;
    attachedFilesInfo?: string[];
  }): void {
    const { ctx, userId, chatId, prompt, attachedFilesInfo } = params;
    const controller = this.coordinator.startTask(userId);
    const replyToMessageId = ctx.message?.message_id;
    const username = ctx.from?.username;

    const jobPromise = (async () => {
      let typingTimer: ReturnType<typeof setInterval> | null = null;
      let tracker: Awaited<ReturnType<TelegramDeliveryService['createLiveTracker']>> | null = null;

      try {
        if (controller.signal.aborted) {
          await this.botApi.bot.api
            .sendMessage(chatId, '⏹ اجرای ایجنت به درخواست شما متوقف شد.')
            .catch(() => undefined);
          return;
        }

        const session = await this.sessionService.getSession(userId, username);

        typingTimer = setInterval(() => {
          this.botApi.bot.api.sendChatAction(chatId, 'typing').catch(() => undefined);
        }, 4500);

        await this.botApi.bot.api.sendChatAction(chatId, 'typing').catch(() => undefined);

        tracker = await this.delivery.createLiveTracker({
          chatId,
          projectName: session.activeProject,
          cancelKeyboard: TelegramKeyboardService.cancelExecution(),
        });

        const result = await this.codingAgent.run({
          userId,
          username,
          prompt,
          attachedFilesInfo,
          abortSignal: controller.signal,
          onProgress: (ev) => tracker!.onProgress(ev),
        });

        await tracker.complete(
          `انجام شد (${result.toolCallsExecuted.length} عملیات در پروژه ${result.projectName})`,
        );

        await this.delivery.sendFormattedReply({
          chatId,
          markdown: result.replyText,
          replyToMessageId,
          replyMarkup: TelegramKeyboardService.afterAgentReply(),
        });

        if (result.artifacts.length > 0) {
          await this.delivery.sendArtifacts(chatId, result.artifacts);
        }
      } catch (err) {
        if (tracker) {
          await tracker.dismiss();
        }
        if (controller.signal.aborted) {
          await this.botApi.bot.api
            .sendMessage(chatId, '⏹ اجرای ایجنت به درخواست شما متوقف شد.')
            .catch(() => undefined);
        } else {
          logger.error({ err, userId }, 'خطا در اجرای حلقه CodingAgent');
          await this.botApi.bot.api
            .sendMessage(
              chatId,
              `❌ خطا هنگام پردازش درخواست توسط ایجنت:\n<code>${escapeHtml(err instanceof Error ? err.message : String(err))}</code>`,
              { parse_mode: 'HTML' },
            )
            .catch(() => undefined);
        }
      } finally {
        if (typingTimer) clearInterval(typingTimer);
        this.coordinator.finishTask(userId, controller);
      }
    })();

    this.coordinator.attachPromise(userId, jobPromise);
  }
}
