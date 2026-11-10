import type { SessionService } from '../session.service.js';
import type { WorkspaceService } from '../workspace.service.js';
import type { TelegramTaskCoordinator } from './auth.middleware.js';
import type { TelegramBotApiService } from './bot-api.service.js';
import type { TelegramCommandService } from './command.service.js';
import { escapeHtml } from './delivery.service.js';
import { TelegramKeyboardService } from './keyboard.service.js';

export class TelegramCallbackService {
  constructor(
    private readonly botApi: TelegramBotApiService,
    private readonly commandService: TelegramCommandService,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionService: SessionService,
    private readonly coordinator: TelegramTaskCoordinator,
  ) {}

  bindHandlers(): void {
    this.botApi.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const userId = ctx.from.id;

      if (data === 'cb:cancel') {
        const stopped = this.coordinator.cancelTask(userId);
        await ctx.answerCallbackQuery({
          text: stopped ? '⏹ اجرای ایجنت متوقف شد.' : 'تسک فعالی در حال اجرا نیست.',
        });
        return;
      }

      if (data === 'cb:files') {
        await ctx.answerCallbackQuery();
        await this.commandService.handleListFiles(ctx);
        return;
      }

      if (data === 'cb:zip') {
        await ctx.answerCallbackQuery({ text: 'در حال آماده‌سازی فایل ZIP...' });
        await this.commandService.handleExportZip(ctx);
        return;
      }

      if (data === 'cb:git_status') {
        await ctx.answerCallbackQuery();
        await this.commandService.handleGit(ctx, 'status');
        return;
      }

      if (data === 'cb:reset') {
        await ctx.answerCallbackQuery({ text: 'حافظه چت پاک شد.' });
        await this.commandService.handleReset(ctx);
        return;
      }

      if (data === 'cb:projects') {
        await ctx.answerCallbackQuery();
        await this.commandService.handleListProjects(ctx);
        return;
      }

      if (data === 'cb:models') {
        await ctx.answerCallbackQuery();
        await this.commandService.handleModel(ctx);
        return;
      }

      if (data.startsWith('cb:set_model:')) {
        const modelId = data.slice('cb:set_model:'.length);
        await this.sessionService.setModel(userId, modelId);
        await ctx.answerCallbackQuery({ text: `مدل به ${modelId} تغییر کرد` });
        await ctx.editMessageText(
          `✅ مدل هوش مصنوعی فعال شما به <code>${escapeHtml(modelId)}</code> تغییر یافت.`,
          {
            parse_mode: 'HTML',
            reply_markup: TelegramKeyboardService.modelSelector(modelId),
          },
        );
        return;
      }

      if (data.startsWith('cb:switch_proj:')) {
        const projName = data.slice('cb:switch_proj:'.length);
        const safeName = this.workspaceService.sanitizeProjectName(projName);
        await this.workspaceService.ensureProject(userId, safeName);
        await this.sessionService.setActiveProject(userId, safeName);
        const projects = await this.workspaceService.listProjects(userId);
        await ctx.answerCallbackQuery({ text: `پروژه فعال: ${safeName}` });
        await ctx.editMessageText(
          `✅ پروژه فعال به <code>${escapeHtml(safeName)}</code> تغییر یافت.`,
          {
            parse_mode: 'HTML',
            reply_markup: TelegramKeyboardService.projectSwitcher(projects, safeName),
          },
        );
        return;
      }

      await ctx.answerCallbackQuery();
    });
  }
}
