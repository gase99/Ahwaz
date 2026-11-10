import type { CodingAgent } from '../../agent/coding-agent.js';
import type { AppConfig } from '../../config/env.js';
import type { SessionService } from '../session.service.js';
import type { WorkspaceService } from '../workspace.service.js';
import { createAuthMiddleware, TelegramTaskCoordinator } from './auth.middleware.js';
import { TelegramBotApiService } from './bot-api.service.js';
import { TelegramCallbackService } from './callback.service.js';
import { TelegramCommandService } from './command.service.js';
import { TelegramDeliveryService } from './delivery.service.js';
import { TelegramFileIngestService } from './file-ingest.service.js';
import { TelegramMessageService } from './message.service.js';
import { TelegramTransportService } from './transport.service.js';

/**
 * Orchestrates all modular Telegram services (API client, Auth, Delivery, File Ingest,
 * Commands, Callbacks, Messages, and HTTP/Polling Transport).
 */
export class TelegramServicesModule {
  public readonly botApi: TelegramBotApiService;
  public readonly delivery: TelegramDeliveryService;
  public readonly fileIngest: TelegramFileIngestService;
  public readonly coordinator: TelegramTaskCoordinator;
  public readonly commands: TelegramCommandService;
  public readonly callbacks: TelegramCallbackService;
  public readonly messages: TelegramMessageService;
  public readonly transport: TelegramTransportService;

  constructor(params: {
    config: AppConfig;
    workspaceService: WorkspaceService;
    sessionService: SessionService;
    codingAgent: CodingAgent;
  }) {
    const { config, workspaceService, sessionService, codingAgent } = params;

    this.botApi = new TelegramBotApiService(config);
    this.delivery = new TelegramDeliveryService(this.botApi.bot);
    this.fileIngest = new TelegramFileIngestService(config, this.botApi.bot, workspaceService);
    this.coordinator = new TelegramTaskCoordinator();

    // Register global authentication / allowlist middleware first
    this.botApi.bot.use(createAuthMiddleware(config));

    this.commands = new TelegramCommandService(
      config,
      this.botApi,
      this.delivery,
      workspaceService,
      sessionService,
      this.coordinator,
    );

    this.callbacks = new TelegramCallbackService(
      this.botApi,
      this.commands,
      workspaceService,
      sessionService,
      this.coordinator,
    );

    this.messages = new TelegramMessageService(
      this.botApi,
      this.delivery,
      this.fileIngest,
      sessionService,
      codingAgent,
      this.coordinator,
    );

    // Bind handlers in deterministic order: commands -> callbacks -> documents & text messages
    this.commands.bindHandlers();
    this.callbacks.bindHandlers();
    this.messages.bindHandlers();

    this.transport = new TelegramTransportService(
      config,
      this.botApi,
      this.commands,
      this.coordinator,
    );
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  async stop(): Promise<void> {
    await this.transport.stop();
  }
}
