import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export class TelegramBotApiService {
  public readonly bot: Bot<Context>;
  private botInfoCache: UserFromGetMe | null = null;

  constructor(private readonly config: AppConfig) {
    const normalizedApiRoot = config.TELEGRAM_API_ROOT.replace(/\/+$/, '');
    const isCustomServer = normalizedApiRoot !== 'https://api.telegram.org';

    this.bot = new Bot<Context>(config.TELEGRAM_BOT_TOKEN, {
      client: {
        apiRoot: normalizedApiRoot,
        // Extended timeout (900s) when running against Local Telegram Bot API Server for multi-hundred-MB uploads
        timeoutSeconds: isCustomServer ? 900 : 500,
      },
    });

    this.bot.catch((err) => {
      logger.error(
        {
          err: err.error,
          updateId: err.ctx.update.update_id,
        },
        'خطای مدیریت‌نشده در پردازش آپدیت تلگرام',
      );
    });
  }

  get apiRoot(): string {
    return this.config.TELEGRAM_API_ROOT.replace(/\/+$/, '');
  }

  get isLocalBotApiServer(): boolean {
    return this.config.TELEGRAM_LOCAL_MODE || this.apiRoot !== 'https://api.telegram.org';
  }

  get maxFileLimitMb(): number {
    return this.isLocalBotApiServer ? 2000 : 50;
  }

  async verifyConnection(): Promise<UserFromGetMe> {
    const me = await this.bot.api.getMe();
    this.botInfoCache = me;
    this.bot.botInfo = me;
    logger.info(
      {
        username: me.username,
        id: me.id,
        apiRoot: this.apiRoot,
        localMode: this.config.TELEGRAM_LOCAL_MODE,
        maxFileLimitMb: this.maxFileLimitMb,
      },
      'اتصال به سرور Telegram Bot API با موفقیت برقرار شد',
    );
    return me;
  }

  getCachedBotInfo(): UserFromGetMe | null {
    return this.botInfoCache;
  }

  /**
   * Logs the bot out from the official cloud api.telegram.org server so it can be attached
   * to a self-hosted Local Telegram Bot API Server without conflict.
   */
  static async logOutFromCloudServer(botToken: string): Promise<boolean> {
    const cloudBot = new Bot(botToken, {
      client: { apiRoot: 'https://api.telegram.org' },
    });
    return cloudBot.api.logOut();
  }
}
