import type { Context, MiddlewareFn } from 'grammy';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../config/logger.js';

interface ActiveTaskEntry {
  controller: AbortController;
  promise?: Promise<void>;
}

export class TelegramTaskCoordinator {
  private readonly activeTasks = new Map<number, ActiveTaskEntry>();

  isBusy(userId: number): boolean {
    const entry = this.activeTasks.get(userId);
    return Boolean(entry && !entry.controller.signal.aborted);
  }

  startTask(userId: number): AbortController {
    const existing = this.activeTasks.get(userId);
    if (existing && !existing.controller.signal.aborted) {
      throw new Error('یک تسک کدنویسی در حال حاضر برای شما در حال اجراست.');
    }
    const controller = new AbortController();
    this.activeTasks.set(userId, { controller });
    return controller;
  }

  attachPromise(userId: number, promise: Promise<void>): void {
    const entry = this.activeTasks.get(userId);
    if (entry) {
      entry.promise = promise;
    }
  }

  cancelTask(userId: number): boolean {
    const entry = this.activeTasks.get(userId);
    if (!entry || entry.controller.signal.aborted) return false;
    entry.controller.abort();
    return true;
  }

  finishTask(userId: number, controller?: AbortController): void {
    const current = this.activeTasks.get(userId);
    if (!current) return;
    if (!controller || current.controller === controller) {
      this.activeTasks.delete(userId);
    }
  }

  activeTaskCount(): number {
    return this.activeTasks.size;
  }

  async waitForAll(): Promise<void> {
    const promises = Array.from(this.activeTasks.values())
      .map((t) => t.promise)
      .filter((p): p is Promise<void> => Boolean(p));
    await Promise.allSettled(promises);
  }
}

export function createAuthMiddleware(config: AppConfig): MiddlewareFn<Context> {
  const allowedSet = new Set(config.ALLOWED_TELEGRAM_USER_IDS);

  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (allowedSet.size > 0 && !allowedSet.has(userId)) {
      logger.warn(
        { userId, username: ctx.from?.username },
        'تلاش برای دسترسی غیرمجاز به ایجنت تلگرام مسدود شد',
      );
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: `⛔️ شما دسترسی استفاده از این ایجنت را ندارید (ID: ${userId}).`,
          show_alert: true,
        });
      } else {
        await ctx.reply(
          `⛔️ دسترسی شما به این ایجنت مجاز نیست.\nشناسه عددی تلگرام شما: <code>${userId}</code>\n(مدیر سرور می‌تواند این شناسه را در متغیر <code>ALLOWED_TELEGRAM_USER_IDS</code> اضافه کند.)`,
          { parse_mode: 'HTML' },
        );
      }
      return;
    }

    await next();
  };
}
