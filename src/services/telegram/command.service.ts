import type { Context } from 'grammy';
import { runShellCommand } from '../../agent/tools/executor.tool.js';
import { execGit } from '../../agent/tools/git.tool.js';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { SessionService } from '../session.service.js';
import { WorkspaceService } from '../workspace.service.js';
import type { TelegramTaskCoordinator } from './auth.middleware.js';
import type { TelegramBotApiService } from './bot-api.service.js';
import { escapeHtml, type TelegramDeliveryService } from './delivery.service.js';
import { TelegramKeyboardService } from './keyboard.service.js';

export class TelegramCommandService {
  constructor(
    private readonly config: AppConfig,
    private readonly botApi: TelegramBotApiService,
    private readonly delivery: TelegramDeliveryService,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionService: SessionService,
    private readonly coordinator: TelegramTaskCoordinator,
  ) {}

  async registerBotMenuCommands(): Promise<void> {
    try {
      await this.botApi.bot.api.setMyCommands([
        { command: 'start', description: 'پنل اصلی ایجنت برنامه‌نویسی' },
        { command: 'help', description: 'راهنمای کامل دستورات و قابلیت‌ها' },
        { command: 'project', description: 'ساخت یا سوییچ به پروژه (/project myapp)' },
        { command: 'projects', description: 'لیست تمام پروژه‌های Workspace' },
        { command: 'files', description: 'نمایش درخت فایل‌های پروژه فعال' },
        { command: 'zip', description: 'دریافت خروجی ZIP پروژه فعال' },
        { command: 'clone', description: 'کلون ریپوزیتوری Git در پروژه جدید' },
        { command: 'git', description: 'مشاهده وضعیت Git (status / diff / log)' },
        { command: 'run', description: 'اجرای مستقیم دستور ترمینال در پروژه' },
        { command: 'model', description: 'انتخاب یا تغییر مدل Google Gemini' },
        { command: 'status', description: 'وضعیت سرور تلگرام و ایجنت' },
        { command: 'reset', description: 'پاکسازی حافظه گفتگوی پروژه فعلی' },
        { command: 'cancel', description: 'توقف تسک در حال اجرا' },
      ]);
    } catch (err) {
      logger.warn({ err }, 'ثبت منوی دستورات تلگرام با هشدار مواجه شد');
    }
  }

  bindHandlers(): void {
    const bot = this.botApi.bot;

    bot.command('start', (ctx) => this.handleStart(ctx));
    bot.command('help', (ctx) => this.handleHelp(ctx));
    bot.command(['project', 'new'], (ctx) => this.handleSwitchProject(ctx));
    bot.command('projects', (ctx) => this.handleListProjects(ctx));
    bot.command('files', (ctx) => this.handleListFiles(ctx));
    bot.command('zip', (ctx) => this.handleExportZip(ctx));
    bot.command('clone', (ctx) => this.handleClone(ctx));
    bot.command('git', (ctx) => this.handleGit(ctx));
    bot.command('run', (ctx) => this.handleDirectRun(ctx));
    bot.command('model', (ctx) => this.handleModel(ctx));
    bot.command('reset', (ctx) => this.handleReset(ctx));
    bot.command('cancel', (ctx) => this.handleCancel(ctx));
    bot.command('status', (ctx) => this.handleStatus(ctx));
  }

  private async handleStart(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const session = await this.sessionService.getSession(userId, ctx.from?.username);
    await this.workspaceService.ensureProject(userId, session.activeProject);

    const serverBadge = this.botApi.isLocalBotApiServer
      ? `🟢 Local Telegram Bot API Server (تا ${this.botApi.maxFileLimitMb}MB)`
      : '🔵 Cloud Telegram Bot API (تا 50MB)';

    const welcomeHtml = [
      '👨‍💻 <b>به ایجنت برنامه‌نویسی اهواز (Ahwaz Coding Agent) خوش آمدید!</b>',
      '',
      'من یک مهندس نرم‌افزار خودکار مبتنی بر <b>Google Gemini</b> هستم که مستقیماً روی Workspace سرور شما کد می‌نویسد، دیباگ می‌کند، تست اجرا می‌کند، با Git کار می‌کند و خروجی پروژه را در تلگرام تحویل می‌دهد.',
      '',
      `📂 <b>پروژه فعال:</b> <code>${escapeHtml(session.activeProject)}</code>`,
      `🧠 <b>مدل هوش مصنوعی:</b> <code>${escapeHtml(session.model)}</code>`,
      `🖥 <b>سرویس تلگرام:</b> ${escapeHtml(serverBadge)}`,
      '',
      '💡 <b>چطور شروع کنم؟</b>',
      '• کافیست به فارسی یا انگلیسی بنویسید چه برنامه‌ای می‌خواهید یا چه باگی دارید.',
      '• می‌توانید فایل کد یا آرشیو <code>.zip</code> پروژه‌تان را مستقیم همین‌جا آپلود کنید!',
      '• برای مشاهده همه دستورات /help را بزنید.',
    ].join('\n');

    await ctx.reply(welcomeHtml, {
      parse_mode: 'HTML',
      reply_markup: TelegramKeyboardService.mainDashboard(),
    });
  }

  private async handleHelp(ctx: Context): Promise<void> {
    const helpHtml = [
      '📚 <b>راهنمای دستورات ایجنت برنامه‌نویسی</b>',
      '',
      '<b>مدیریت پروژه‌ها و فایل‌ها:</b>',
      '• <code>/project نام</code> — ساخت یا سوییچ به یک پروژه مجزا',
      '• <code>/projects</code> — لیست و انتخاب پروژه‌ها با دکمه شیشه‌ای',
      '• <code>/files</code> — نمایش ساختار فایل‌ها و پوشه‌های پروژه فعال',
      '• <code>/zip</code> — فشرده‌سازی و دانلود کل پروژه به صورت ZIP',
      '• <b>ارسال فایل یا ZIP</b> — ذخیره یا اکسترکت خودکار در پروژه فعال',
      '',
      '<b>ابزارهای مهندسی، ترمینال و Git:</b>',
      '• <code>/clone &lt;https-url&gt; [project]</code> — کلون ریپوزیتوری از GitHub/GitLab',
      '• <code>/git [status|diff|log]</code> — بررسی سریع تغییرات Git',
      '• <code>/run &lt;command&gt;</code> — اجرای مستقیم دستور شل در پوشه پروژه',
      '',
      '<b>تنظیمات ایجنت و جلسه:</b>',
      '• <code>/model [نام-مدل]</code> — تغییر مدل Gemini (مثلاً gemini-2.5-pro)',
      '• <code>/reset</code> — پاک کردن حافظه چت پروژه فعلی (بدون حذف فایل‌ها)',
      '• <code>/cancel</code> — توقف فوری عملیات در حال اجرا',
      '• <code>/status</code> — وضعیت سرور، حافظه، API Root و محدودیت فایل',
    ].join('\n');

    await ctx.reply(helpHtml, { parse_mode: 'HTML' });
  }

  private async handleSwitchProject(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const arg = (ctx.match ? String(ctx.match) : '').trim();

    if (!arg) {
      const session = await this.sessionService.getSession(userId);
      await ctx.reply(
        `📂 پروژه فعال فعلی: <code>${escapeHtml(session.activeProject)}</code>\nبرای ساخت یا تغییر پروژه بنویسید:\n<code>/project my-new-app</code>`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    try {
      const cleanName = this.workspaceService.sanitizeProjectName(arg);
      await this.workspaceService.ensureProject(userId, cleanName);
      await this.sessionService.setActiveProject(userId, cleanName);
      const files = await this.workspaceService.listFilesRelative(
        this.workspaceService.getProjectRoot(userId, cleanName),
      );
      await ctx.reply(
        `✅ پروژه فعال به <code>${escapeHtml(cleanName)}</code> تغییر یافت (${files.length} آیتم در Workspace).`,
        {
          parse_mode: 'HTML',
          reply_markup: TelegramKeyboardService.mainDashboard(),
        },
      );
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleListProjects(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const session = await this.sessionService.getSession(userId);
    await this.workspaceService.ensureProject(userId, session.activeProject);
    const projects = await this.workspaceService.listProjects(userId);

    await ctx.reply(
      `🗂 <b>پروژه‌های موجود شما (${projects.length}):</b>\nپروژه فعال فعلی: <code>${escapeHtml(session.activeProject)}</code>\n\nبرای ساخت پروژه جدید از دستور <code>/project نام</code> استفاده کنید:`,
      {
        parse_mode: 'HTML',
        reply_markup: TelegramKeyboardService.projectSwitcher(projects, session.activeProject),
      },
    );
  }

  async handleListFiles(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const subPath = typeof ctx.match === 'string' && ctx.match.trim() ? ctx.match.trim() : '.';
    const session = await this.sessionService.getSession(userId);
    const projectRoot = await this.workspaceService.ensureProject(userId, session.activeProject);

    try {
      const files = await this.workspaceService.listFilesRelative(projectRoot, {
        subPath,
        maxEntries: 150,
      });

      if (files.length === 0) {
        await ctx.reply(
          `📂 پروژه <code>${escapeHtml(session.activeProject)}</code> فعلاً خالی است.`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      const listing = files.join('\n');
      await ctx.reply(
        `📁 <b>ساختار پروژه <code>${escapeHtml(session.activeProject)}</code> (${files.length} مورد):</b>\n<pre><code>${escapeHtml(listing)}</code></pre>`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleExportZip(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const chatId = ctx.chat!.id;
    const session = await this.sessionService.getSession(userId);

    try {
      const { zipPath, entryCount } = await this.workspaceService.createProjectZip(
        userId,
        session.activeProject,
      );
      if (entryCount === 0) {
        await ctx.reply('⚠️ پروژه فعلی خالی است و فایلی برای فشرده‌سازی وجود ندارد.');
        return;
      }
      await this.delivery.sendArtifacts(chatId, [
        {
          filePath: zipPath,
          fileName: `${session.activeProject}.zip`,
          caption: `📦 خروجی پروژه «${session.activeProject}» شامل ${entryCount} فایل`,
        },
      ]);
    } catch (err) {
      await ctx.reply(`❌ خطا در ساخت ZIP: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleClone(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const raw = (ctx.match ? String(ctx.match) : '').trim();
    if (!raw) {
      await ctx.reply(
        '🌿 نحوه استفاده:\n<code>/clone https://github.com/owner/repo.git [نام-پروژه]</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    const parts = raw.split(/\s+/);
    const repoUrl = parts[0];
    if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('http://')) {
      await ctx.reply('❌ آدرس ریپوزیتوری باید با https:// شروع شود.');
      return;
    }

    const inferredName =
      parts[1] ||
      repoUrl
        .replace(/\/+$/, '')
        .split('/')
        .pop()
        ?.replace(/\.git$/i, '') ||
      'cloned-repo';

    try {
      const projectName = this.workspaceService.sanitizeProjectName(inferredName);
      const projectRoot = await this.workspaceService.ensureProject(userId, projectName);
      const existing = await this.workspaceService.listFilesRelative(projectRoot, {
        includeIgnored: true,
        maxEntries: 5,
      });

      if (existing.length > 0) {
        await ctx.reply(
          `⚠️ پوشه پروژه <code>${escapeHtml(projectName)}</code> از قبل پر است. یک نام جدید به انتهای دستور اضافه کنید.`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      const waitMsg = await ctx.reply(
        `⏳ در حال کلون کردن ریپوزیتوری داخل پروژه <code>${escapeHtml(projectName)}</code>...`,
        { parse_mode: 'HTML' },
      );

      const res = await execGit({
        gitArgs: ['clone', repoUrl, '.'],
        cwd: projectRoot,
        authorName: this.config.GIT_AUTHOR_NAME,
        authorEmail: this.config.GIT_AUTHOR_EMAIL,
        githubToken: this.config.GITHUB_TOKEN,
      });

      if (res.exitCode !== 0) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          waitMsg.message_id,
          `❌ خطا در کلون ریپوزیتوری:\n<pre><code>${escapeHtml(res.stderr || res.stdout)}</code></pre>`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      await this.sessionService.setActiveProject(userId, projectName);
      const files = await this.workspaceService.listFilesRelative(projectRoot, { maxEntries: 200 });

      await ctx.api.editMessageText(
        ctx.chat!.id,
        waitMsg.message_id,
        `✅ ریپوزیتوری با موفقیت در پروژه <code>${escapeHtml(projectName)}</code> کلون شد (${files.length} فایل).\nهم‌اکنون می‌توانید هر تغییری می‌خواهید از ایجنت بخواهید!`,
        {
          parse_mode: 'HTML',
          reply_markup: TelegramKeyboardService.mainDashboard(),
        },
      );
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleGit(ctx: Context, overrideSubCmd?: string): Promise<void> {
    const userId = ctx.from!.id;
    const sub = (
      overrideSubCmd ??
      (typeof ctx.match === 'string' && ctx.match.trim() ? ctx.match.trim() : 'status')
    ).toLowerCase();

    const session = await this.sessionService.getSession(userId);
    const projectRoot = await this.workspaceService.ensureProject(userId, session.activeProject);

    const gitArgs =
      sub === 'diff'
        ? ['diff', '--stat', '-p']
        : sub === 'log'
          ? ['log', '-n', '10', '--oneline', '--decorate']
          : ['status', '--short', '--branch'];

    const res = await execGit({
      gitArgs,
      cwd: projectRoot,
      authorName: this.config.GIT_AUTHOR_NAME,
      authorEmail: this.config.GIT_AUTHOR_EMAIL,
    });

    const out = (res.stdout || res.stderr || '(خروجی خالی)').slice(0, 3500);
    await ctx.reply(
      `🌿 <b>Git (${escapeHtml(sub)}) — <code>${escapeHtml(session.activeProject)}</code>:</b>\n<pre><code>${escapeHtml(out)}</code></pre>`,
      { parse_mode: 'HTML' },
    );
  }

  private async handleDirectRun(ctx: Context): Promise<void> {
    if (!this.config.ENABLE_SHELL_EXECUTION) {
      await ctx.reply('⛔️ اجرای مستقیم دستورات ترمینال در تنظیمات سرور غیرفعال است.');
      return;
    }

    const cmd = (ctx.match ? String(ctx.match) : '').trim();
    if (!cmd) {
      await ctx.reply('⚡ نحوه استفاده:\n<code>/run npm test</code>', { parse_mode: 'HTML' });
      return;
    }

    const userId = ctx.from!.id;
    const session = await this.sessionService.getSession(userId);
    const projectRoot = await this.workspaceService.ensureProject(userId, session.activeProject);

    const statusMsg = await ctx.reply(
      `⏳ در حال اجرای دستور در <code>${escapeHtml(session.activeProject)}</code>:\n<code>${escapeHtml(cmd)}</code>`,
      { parse_mode: 'HTML' },
    );

    try {
      const res = await runShellCommand({
        command: cmd,
        cwd: projectRoot,
        timeoutMs: this.config.COMMAND_TIMEOUT_MS,
      });
      const combined = [res.stdout, res.stderr].filter(Boolean).join('\n').slice(0, 3400) || '(بدون خروجی)';
      const icon = res.exitCode === 0 ? '✅' : '⚠️';

      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `${icon} <b>خروجی دستور</b> (Exit: <code>${res.exitCode}</code> | زمان: ${res.durationMs}ms):\n<pre><code>${escapeHtml(combined)}</code></pre>`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
        { parse_mode: 'HTML' },
      );
    }
  }

  async handleModel(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const arg = typeof ctx.match === 'string' ? ctx.match.trim() : '';

    if (arg) {
      await this.sessionService.setModel(userId, arg);
      await ctx.reply(`✅ مدل هوش مصنوعی به <code>${escapeHtml(arg)}</code> تغییر یافت.`, {
        parse_mode: 'HTML',
      });
      return;
    }

    const session = await this.sessionService.getSession(userId);
    await ctx.reply(
      `🤖 <b>مدل فعال فعلی:</b> <code>${escapeHtml(session.model)}</code>\nیک مدل را انتخاب کنید یا نام دلخواه را با <code>/model gemini-2.5-pro</code> وارد کنید:`,
      {
        parse_mode: 'HTML',
        reply_markup: TelegramKeyboardService.modelSelector(session.model),
      },
    );
  }

  async handleReset(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const session = await this.sessionService.getSession(userId);
    await this.sessionService.clearProjectHistory(userId, session.activeProject);
    await ctx.reply(
      `🧹 حافظه گفتگوی پروژه <code>${escapeHtml(session.activeProject)}</code> پاکسازی شد (فایل‌های Workspace دست‌نخورده باقی ماندند).`,
      { parse_mode: 'HTML' },
    );
  }

  async handleCancel(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const cancelled = this.coordinator.cancelTask(userId);
    if (cancelled) {
      await ctx.reply('⏹ درخواست توقف ارسال شد؛ اجرای ایجنت متوقف گردید.');
    } else {
      await ctx.reply('ℹ️ در حال حاضر هیچ تسک فعالی برای شما در حال اجرا نیست.');
    }
  }

  private async handleStatus(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const session = await this.sessionService.getSession(userId);
    const botInfo = this.botApi.getCachedBotInfo();

    const html = [
      '📊 <b>وضعیت سرویس Telegram Coding Agent</b>',
      '',
      `• <b>ربات:</b> @${escapeHtml(botInfo?.username ?? 'unknown')}`,
      `• <b>حالت دریافت آپدیت:</b> <code>${escapeHtml(this.config.TELEGRAM_MODE)}</code>`,
      `• <b>آدرس Bot API Server:</b> <code>${escapeHtml(this.botApi.apiRoot)}</code>`,
      `• <b>حالت Local Server:</b> <code>${this.botApi.isLocalBotApiServer ? 'فعال (تا 2000MB)' : 'غیرفعال (تا 50MB)'}</code>`,
      `• <b>اجرای ترمینال (Shell):</b> <code>${this.config.ENABLE_SHELL_EXECUTION ? 'فعال' : 'غیرفعال'}</code>`,
      `• <b>مدل فعال شما:</b> <code>${escapeHtml(session.model)}</code>`,
      `• <b>پروژه فعال شما:</b> <code>${escapeHtml(session.activeProject)}</code>`,
      `• <b>تعداد پرامپت‌های شما:</b> <code>${session.stats.totalPrompts}</code>`,
      `• <b>تعداد ابزارهای اجراشده:</b> <code>${session.stats.totalToolCalls}</code>`,
    ].join('\n');

    await ctx.reply(html, { parse_mode: 'HTML' });
  }
}
