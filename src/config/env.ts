import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

const booleanEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val.trim() === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(val.trim().toLowerCase());
    });

const userIdsEnv = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === '') return [] as number[];
    return val
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((num) => Number.isInteger(num) && num > 0);
  });

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // Telegram & Local Bot API Server
    TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN الزامی است'),
    TELEGRAM_API_ROOT: z.string().url().default('https://api.telegram.org'),
    TELEGRAM_LOCAL_MODE: booleanEnv(false),
    TELEGRAM_LOCAL_FILES_DIR: z.string().default('/var/lib/telegram-bot-api'),

    // Transport (Polling / Webhook) & Fastify Server
    TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
    SERVER_HOST: z.string().default('0.0.0.0'),
    SERVER_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    TELEGRAM_WEBHOOK_URL: z.string().optional(),
    TELEGRAM_WEBHOOK_PATH: z.string().default('/telegram/webhook'),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    // Security & Execution
    ALLOWED_TELEGRAM_USER_IDS: userIdsEnv,
    ENABLE_SHELL_EXECUTION: booleanEnv(true),
    COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),

    // Google Gemini AI
    GEMINI_API_KEY: z.string().min(5, 'GEMINI_API_KEY الزامی است'),
    GEMINI_DEFAULT_MODEL: z.string().default('gemini-2.5-pro'),
    AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(60).default(25),

    // Workspace & Git
    WORKSPACES_ROOT: z
      .string()
      .default('./workspaces')
      .transform((p) => path.resolve(p)),
    DATA_DIR: z
      .string()
      .default('./data')
      .transform((p) => path.resolve(p)),
    GITHUB_TOKEN: z.string().optional(),
    GIT_AUTHOR_NAME: z.string().default('Ahwaz Coding Agent'),
    GIT_AUTHOR_EMAIL: z.string().default('agent@ahwaz.local'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.TELEGRAM_MODE === 'webhook' && !cfg.TELEGRAM_WEBHOOK_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_URL'],
        message: 'در حالت webhook مقدار TELEGRAM_WEBHOOK_URL الزامی است.',
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  const result = EnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`خطا در تنظیمات محیطی (.env):\n${details}`);
  }
  return result.data;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig(process.env);
  }
  return cachedConfig;
}
