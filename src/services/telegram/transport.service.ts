import Fastify, { type FastifyInstance } from 'fastify';
import type { Update } from 'grammy/types';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { TelegramTaskCoordinator } from './auth.middleware.js';
import type { TelegramBotApiService } from './bot-api.service.js';
import type { TelegramCommandService } from './command.service.js';

export class TelegramTransportService {
  public readonly httpServer: FastifyInstance;
  private isPollingStarted = false;

  constructor(
    private readonly config: AppConfig,
    private readonly botApi: TelegramBotApiService,
    private readonly commandService: TelegramCommandService,
    private readonly coordinator: TelegramTaskCoordinator,
  ) {
    this.httpServer = Fastify({
      logger: false,
      bodyLimit: 10 * 1024 * 1024, // 10MB JSON update body limit
    });

    this.registerHttpRoutes();
  }

  private registerHttpRoutes(): void {
    this.httpServer.get('/health', async () => {
      const botInfo = this.botApi.getCachedBotInfo();
      return {
        status: 'ok',
        service: 'ahwaz-telegram-coding-agent',
        botUsername: botInfo?.username ?? null,
        mode: this.config.TELEGRAM_MODE,
        telegramApiRoot: this.botApi.apiRoot,
        localBotApiServer: this.botApi.isLocalBotApiServer,
        maxFileLimitMb: this.botApi.maxFileLimitMb,
        defaultGeminiModel: this.config.GEMINI_DEFAULT_MODEL,
        activeTasks: this.coordinator.activeTaskCount(),
        uptimeSeconds: Math.round(process.uptime()),
      };
    });

    this.httpServer.get('/', async () => ({
      name: 'Ahwaz Telegram Coding Agent',
      architecture: 'Modular Telegram Services + Google Gemini',
      healthEndpoint: '/health',
    }));

    if (this.config.TELEGRAM_MODE === 'webhook') {
      const webhookPath = this.config.TELEGRAM_WEBHOOK_PATH.startsWith('/')
        ? this.config.TELEGRAM_WEBHOOK_PATH
        : `/${this.config.TELEGRAM_WEBHOOK_PATH}`;

      this.httpServer.post(webhookPath, async (request, reply) => {
        if (this.config.TELEGRAM_WEBHOOK_SECRET) {
          const headerToken = request.headers['x-telegram-bot-api-secret-token'];
          if (headerToken !== this.config.TELEGRAM_WEBHOOK_SECRET) {
            logger.warn('درخواست Webhook با توکن امنیتی نامعتبر رد شد');
            return reply.code(401).send({ ok: false, error: 'Invalid webhook secret token' });
          }
        }

        const update = request.body as Update;
        await this.botApi.bot.handleUpdate(update);
        return reply.code(200).send({ ok: true });
      });
    }
  }

  async startHttpServerOnly(): Promise<string> {
    const address = await this.httpServer.listen({
      host: this.config.SERVER_HOST,
      port: this.config.SERVER_PORT,
    });
    logger.info({ address }, 'سرور HTTP وضعیت و Webhook راه‌اندازی شد');
    return address;
  }

  async start(): Promise<void> {
    await this.startHttpServerOnly();
    await this.botApi.verifyConnection();
    await this.commandService.registerBotMenuCommands();

    if (this.config.TELEGRAM_MODE === 'webhook') {
      const base = this.config.TELEGRAM_WEBHOOK_URL!.replace(/\/+$/, '');
      const pathPart = this.config.TELEGRAM_WEBHOOK_PATH.startsWith('/')
        ? this.config.TELEGRAM_WEBHOOK_PATH
        : `/${this.config.TELEGRAM_WEBHOOK_PATH}`;
      const fullWebhookUrl = `${base}${pathPart}`;

      await this.botApi.bot.api.setWebhook(fullWebhookUrl, {
        secret_token: this.config.TELEGRAM_WEBHOOK_SECRET || undefined,
      });

      logger.info({ fullWebhookUrl }, 'سرویس تلگرام در حالت Webhook فعال شد');
    } else {
      await this.botApi.bot.api.deleteWebhook({ drop_pending_updates: false });
      this.isPollingStarted = true;
      // Non-blocking start for long polling
      void this.botApi.bot.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, apiRoot: this.botApi.apiRoot },
            'سرویس تلگرام در حالت Long Polling فعال شد',
          );
        },
      });
    }
  }

  async stop(): Promise<void> {
    logger.info('در حال خاموش‌سازی ایمن سرویس‌های تلگرام...');
    if (this.isPollingStarted) {
      await this.botApi.bot.stop();
      this.isPollingStarted = false;
    }
    await this.coordinator.waitForAll();
    await this.httpServer.close();
  }
}
