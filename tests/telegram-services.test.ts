import AdmZip from 'adm-zip';
import type { GenerateContentResponse } from '@google/genai';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodingAgent } from '../src/agent/coding-agent.js';
import type { GeminiClientLike, GenerateStepParams } from '../src/agent/gemini-provider.js';
import { ToolRegistry } from '../src/agent/tools/index.js';
import { loadConfig } from '../src/config/env.js';
import { SessionService } from '../src/services/session.service.js';
import { TelegramServicesModule } from '../src/services/telegram/index.js';
import { WorkspaceService } from '../src/services/workspace.service.js';

describe('TelegramServicesModule End-to-End (Local Bot API Server + Webhook)', () => {
  let tempDir: string;
  let mockLocalZipPath: string;
  let mockBotApiServer: http.Server;
  let mockBotApiCalls: Array<{ method: string; bodyRaw: string }>;
  let telegramServices: TelegramServicesModule | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-tg-e2e-'));
    mockBotApiCalls = [];

    const sampleZip = new AdmZip();
    sampleZip.addFile('src/server.ts', Buffer.from('export const port = 8080;\n'));
    mockLocalZipPath = path.join(tempDir, 'local-bot-api-sample.zip');
    await sampleZip.writeZipPromise(mockLocalZipPath);

    mockBotApiServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const bodyRaw = Buffer.concat(chunks).toString('utf8');
        const urlParts = (req.url ?? '').split('/');
        const method = urlParts[urlParts.length - 1] ?? '';
        mockBotApiCalls.push({ method, bodyRaw });

        res.setHeader('Content-Type', 'application/json');

        if (method === 'getMe') {
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                id: 777000,
                is_bot: true,
                first_name: 'Ahwaz Agent',
                username: 'ahwaz_coding_bot',
              },
            }),
          );
          return;
        }

        if (method === 'getFile') {
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                file_id: 'doc-local-1',
                file_unique_id: 'uniq-1',
                file_path: mockLocalZipPath,
              },
            }),
          );
          return;
        }

        if (
          method === 'setMyCommands' ||
          method === 'setWebhook' ||
          method === 'deleteWebhook' ||
          method === 'sendChatAction' ||
          method === 'deleteMessage' ||
          method === 'answerCallbackQuery'
        ) {
          res.end(JSON.stringify({ ok: true, result: true }));
          return;
        }

        res.end(
          JSON.stringify({
            ok: true,
            result: {
              message_id: mockBotApiCalls.length + 100,
              date: Math.floor(Date.now() / 1000),
              chat: { id: 12345, type: 'private' },
              text: 'ok',
            },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => mockBotApiServer.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    if (telegramServices) {
      await telegramServices.stop();
      telegramServices = null;
    }
    await new Promise<void>((resolve) => mockBotApiServer.close(() => resolve()));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('connects to Local Bot API Server, enforces auth allowlist, and runs coding prompts via Webhook', async () => {
    const botApiPort = (mockBotApiServer.address() as AddressInfo).port;
    const config = loadConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_TOKEN: '777000:TEST_LOCAL_BOT_API_TOKEN',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${botApiPort}`,
      TELEGRAM_LOCAL_MODE: 'true',
      TELEGRAM_MODE: 'webhook',
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '0',
      TELEGRAM_WEBHOOK_URL: 'https://bot.example.com',
      TELEGRAM_WEBHOOK_PATH: '/telegram/webhook',
      TELEGRAM_WEBHOOK_SECRET: 'top-secret-header',
      ALLOWED_TELEGRAM_USER_IDS: '12345',
      GEMINI_API_KEY: 'fake-gemini-key',
      WORKSPACES_ROOT: path.join(tempDir, 'workspaces'),
      DATA_DIR: path.join(tempDir, 'data'),
    });

    const workspaceService = new WorkspaceService(config.WORKSPACES_ROOT);
    await workspaceService.init();
    const sessionService = new SessionService(config.DATA_DIR, config.GEMINI_DEFAULT_MODEL);
    await sessionService.init();
    const toolRegistry = new ToolRegistry(workspaceService);

    let turn = 0;
    const mockGemini: GeminiClientLike = {
      async generateStep(): Promise<GenerateContentResponse> {
        turn += 1;
        if (turn === 1) {
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        id: 'call-1',
                        name: 'write_file',
                        args: {
                          file_path: 'hello.ts',
                          content: 'export const greet = () => "Salam Ahwaz!";\n',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse;
        }
        return {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'فایل `hello.ts` با موفقیت در پروژه ساخته شد.' }],
              },
            },
          ],
        } as unknown as GenerateContentResponse;
      },
    };

    const codingAgent = new CodingAgent(
      config,
      mockGemini,
      workspaceService,
      sessionService,
      toolRegistry,
    );

    telegramServices = new TelegramServicesModule({
      config,
      workspaceService,
      sessionService,
      codingAgent,
    });

    await telegramServices.start();
    const serverAddr = telegramServices.transport.httpServer.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${serverAddr.port}`;

    // 1. Verify /health reports Local Bot API Server mode & 2000MB limit
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    expect(healthJson.localBotApiServer).toBe(true);
    expect(healthJson.maxFileLimitMb).toBe(2000);
    expect(healthJson.botUsername).toBe('ahwaz_coding_bot');

    // 2. Reject invalid webhook secret
    const badWebhook = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(badWebhook.status).toBe(401);

    // 3. Block unauthorized Telegram user ID (99999)
    await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'top-secret-header',
      },
      body: JSON.stringify({
        update_id: 2,
        message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 99999, type: 'private' },
          from: { id: 99999, is_bot: false, first_name: 'Stranger' },
          text: '/start',
        },
      }),
    });

    expect(
      mockBotApiCalls.some((c) => c.method === 'sendMessage' && c.bodyRaw.includes('99999')),
    ).toBe(true);

    // 4. Authorized user (12345) sends coding prompt -> CodingAgent creates file & replies
    const okWebhook = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'top-secret-header',
      },
      body: JSON.stringify({
        update_id: 3,
        message: {
          message_id: 11,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Owner', username: 'owner_dev' },
          text: 'یک فایل hello.ts بساز',
        },
      }),
    });
    expect(okWebhook.status).toBe(200);

    await telegramServices.coordinator.waitForAll();

    const createdFile = await fs.readFile(
      path.join(config.WORKSPACES_ROOT, '12345', 'default', 'hello.ts'),
      'utf8',
    );
    expect(createdFile).toContain('Salam Ahwaz!');

    // 5. Authorized user uploads a .zip archive -> zero-copy local volume extraction!
    await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'top-secret-header',
      },
      body: JSON.stringify({
        update_id: 4,
        message: {
          message_id: 12,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Owner' },
          document: {
            file_id: 'doc-local-1',
            file_unique_id: 'uniq-1',
            file_name: 'project.zip',
          },
        },
      }),
    });

    const extractedServerTs = await fs.readFile(
      path.join(config.WORKSPACES_ROOT, '12345', 'default', 'src/server.ts'),
      'utf8',
    );
    expect(extractedServerTs).toContain('port = 8080');
  });

  it('aborts an in-flight coding task immediately when cb:cancel inline button is pressed', async () => {
    const botApiPort = (mockBotApiServer.address() as AddressInfo).port;
    const config = loadConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_TOKEN: '777000:TEST_LOCAL_BOT_API_TOKEN',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${botApiPort}`,
      TELEGRAM_LOCAL_MODE: 'true',
      TELEGRAM_MODE: 'webhook',
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '0',
      TELEGRAM_WEBHOOK_URL: 'https://bot.example.com',
      TELEGRAM_WEBHOOK_SECRET: 'secret-cancel',
      ALLOWED_TELEGRAM_USER_IDS: '12345',
      GEMINI_API_KEY: 'fake-gemini-key',
      WORKSPACES_ROOT: path.join(tempDir, 'workspaces'),
      DATA_DIR: path.join(tempDir, 'data'),
    });

    const workspaceService = new WorkspaceService(config.WORKSPACES_ROOT);
    await workspaceService.init();
    const sessionService = new SessionService(config.DATA_DIR, config.GEMINI_DEFAULT_MODEL);
    await sessionService.init();
    const toolRegistry = new ToolRegistry(workspaceService);

    const slowGemini: GeminiClientLike = {
      generateStep(params: GenerateStepParams): Promise<GenerateContentResponse> {
        return new Promise((_resolve, reject) => {
          params.abortSignal?.addEventListener('abort', () => {
            reject(new Error('Aborted by user'));
          });
        });
      },
    };

    const codingAgent = new CodingAgent(
      config,
      slowGemini,
      workspaceService,
      sessionService,
      toolRegistry,
    );

    telegramServices = new TelegramServicesModule({
      config,
      workspaceService,
      sessionService,
      codingAgent,
    });

    await telegramServices.start();
    const port = (telegramServices.transport.httpServer.server.address() as AddressInfo).port;
    const webhookUrl = `http://127.0.0.1:${port}/telegram/webhook`;

    // Start slow prompt
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'secret-cancel',
      },
      body: JSON.stringify({
        update_id: 10,
        message: {
          message_id: 50,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Owner' },
          text: 'یک تسک طولانی اجرا کن',
        },
      }),
    });

    expect(telegramServices.coordinator.isBusy(12345)).toBe(true);
    await new Promise((r) => setTimeout(r, 25));

    // Immediately click inline cancel button (cb:cancel) while Gemini is in-flight
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'secret-cancel',
      },
      body: JSON.stringify({
        update_id: 11,
        callback_query: {
          id: 'cbq-1',
          from: { id: 12345, is_bot: false, first_name: 'Owner' },
          chat_instance: 'ci-1',
          data: 'cb:cancel',
        },
      }),
    });

    await telegramServices.coordinator.waitForAll();
    expect(telegramServices.coordinator.isBusy(12345)).toBe(false);
    expect(mockBotApiCalls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
  });
});
