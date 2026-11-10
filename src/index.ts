import { CodingAgent } from './agent/coding-agent.js';
import { GeminiProvider } from './agent/gemini-provider.js';
import { ToolRegistry } from './agent/tools/index.js';
import { getConfig } from './config/env.js';
import { logger } from './config/logger.js';
import { SessionService } from './services/session.service.js';
import { TelegramServicesModule } from './services/telegram/index.js';
import { WorkspaceService } from './services/workspace.service.js';

async function bootstrap(): Promise<void> {
  const config = getConfig();

  logger.info(
    {
      mode: config.TELEGRAM_MODE,
      telegramApiRoot: config.TELEGRAM_API_ROOT,
      localMode: config.TELEGRAM_LOCAL_MODE,
      defaultModel: config.GEMINI_DEFAULT_MODEL,
      workspacesRoot: config.WORKSPACES_ROOT,
    },
    'در حال راه‌اندازی Ahwaz Telegram Coding Agent...',
  );

  const workspaceService = new WorkspaceService(config.WORKSPACES_ROOT);
  await workspaceService.init();

  const sessionService = new SessionService(config.DATA_DIR, config.GEMINI_DEFAULT_MODEL);
  await sessionService.init();

  const toolRegistry = new ToolRegistry(workspaceService);
  const geminiProvider = new GeminiProvider(config.GEMINI_API_KEY);

  const codingAgent = new CodingAgent(
    config,
    geminiProvider,
    workspaceService,
    sessionService,
    toolRegistry,
  );

  const telegramServices = new TelegramServicesModule({
    config,
    workspaceService,
    sessionService,
    codingAgent,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'سیگنال خروج دریافت شد؛ در حال توقف سرویس‌ها...');
    try {
      await telegramServices.stop();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'خطا هنگام توقف سرویس');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await telegramServices.start();
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'خطای بحرانی در راه‌اندازی سرویس');
  process.exit(1);
});
