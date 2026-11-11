import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import agentEndpoint from '../tgcloud/endpoints/agent.js';
import studioEndpoint from '../tgcloud/endpoints/studio.js';
import callbackHandler from '../tgcloud/handlers/callback_query.js';
import messageHandler from '../tgcloud/handlers/message.js';
import { bytesToBase64, utf8ToBytes } from '../tgcloud/lib/services/binary-utils.js';
import { createZipBytes } from '../tgcloud/lib/services/zip-service.js';
import { BotApiError, mockState, resetMockSdk } from './helpers/mock-sdk.js';
import { resetMockDatabase } from './helpers/mock-sdk-db.js';

describe('Telegram Serverless Handlers & Mini App Endpoints End-to-End', () => {
  beforeEach(() => {
    resetMockDatabase();
    resetMockSdk();
  });

  it('bootstraps first user as Admin, blocks strangers until /allow, auto-deletes /setkey, and handles ZIP uploads', async () => {
    // 1. First user sends /start -> automatically becomes Admin
    await messageHandler({
      message_id: 1,
      chat: { id: 1001 },
      from: { id: 1001, first_name: 'Owner' },
      text: '/start',
    });

    expect(mockState.apiCalls.some((c) => c.method === 'setMyCommands')).toBe(true);
    expect(
      mockState.apiCalls.some(
        (c) => c.method === 'sendMessage' && c.params.text.includes('Ahwaz'),
      ),
    ).toBe(true);

    // 2. Second unknown user is blocked
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 2,
      chat: { id: 2002 },
      from: { id: 2002, first_name: 'Guest' },
      text: '/start',
    });
    expect(mockState.apiCalls[0].params.text).toContain('دسترسی شما به این ایجنت مجاز نیست');

    // 3. Admin grants access via `/allow 2002`
    await messageHandler({
      message_id: 3,
      chat: { id: 1001 },
      from: { id: 1001, first_name: 'Owner' },
      text: '/allow 2002',
    });

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 4,
      chat: { id: 2002 },
      from: { id: 2002, first_name: 'Guest' },
      text: '/start',
    });
    expect(mockState.apiCalls[0].params.text).toContain('خوش آمدید');

    // 4. Admin sends `/setkey AIza...` -> message is deleted immediately for security
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 55,
      chat: { id: 1001 },
      from: { id: 1001, first_name: 'Owner' },
      text: '/setkey AIzaSySuperSecretKeyValue999',
    });
    expect(
      mockState.apiCalls.some(
        (c) => c.method === 'deleteMessage' && c.params.message_id === 55,
      ),
    ).toBe(true);

    // 5. User uploads a .zip archive -> extracted into SQLite workspace via api.getFileContent
    const zipBytes = createZipBytes([
      { path: 'app/main.js', content: 'console.log("from zip");\n' },
    ]);
    mockState.fileStore.set('file-zip-1', zipBytes);

    await messageHandler({
      message_id: 56,
      chat: { id: 1001 },
      from: { id: 1001, first_name: 'Owner' },
      document: {
        file_id: 'file-zip-1',
        file_name: 'starter.zip',
      },
    });

    // 6. Callback query `cb:zip` sends back InputFile document
    mockState.apiCalls = [];
    await callbackHandler({
      id: 'cbq-99',
      from: { id: 1001, first_name: 'Owner' },
      message: { chat: { id: 1001 }, message_id: 90 },
      data: 'cb:zip',
    });
    const docCall = mockState.apiCalls.find((c) => c.method === 'sendDocument');
    expect(docCall).toBeDefined();
    expect(docCall.params.document.filename).toBe('default.zip');
  });

  it('serves Mini App studio & agent endpoints with verified ctx.initData.user', async () => {
    // Reject unauthenticated call
    await expect(studioEndpoint({ action: 'bootstrap' }, {})).rejects.toThrow();

    // Bootstrap owner via studio endpoint
    const ctx = { initData: { user: { id: 5005, first_name: 'Sara' } } };
    const initData = await studioEndpoint({ action: 'bootstrap' }, ctx);
    expect(initData.user.isAdmin).toBe(true);

    // Save API key & create a file from Mini App Studio
    await studioEndpoint(
      {
        action: 'save_settings',
        geminiKey: 'AIzaSyStudioKey1234567890',
        model: 'gemini-2.5-flash',
      },
      ctx,
    );

    const saveRes = await studioEndpoint(
      {
        action: 'save_file',
        path: 'utils/math.js',
        content: 'export const double = (x) => x * 2;\n',
      },
      ctx,
    );
    expect(saveRes.files).toHaveLength(1);

    // Run AI prompt from Mini App `agent` endpoint
    mockState.fetchHandler = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'کد `utils/math.js` بررسی شد و کاملاً صحیح است.' }],
              },
            },
          ],
        };
      },
    });

    const agentRes = await agentEndpoint(
      { prompt: 'فایل math.js را بررسی کن' },
      ctx,
    );
    expect(agentRes.replyText).toContain('utils/math.js');

    // Verify setProvider immediately returns refreshed provider readiness & configured URL
    const routerUpdate = await studioEndpoint(
      {
        action: 'setProvider',
        providerId: 'freellmapi',
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'freellmapi-key-999',
        model: 'auto:smart',
      },
      ctx,
    );
    expect(routerUpdate.provider).toBe('freellmapi');
    expect(routerUpdate.model).toBe('auto:smart');
    const freeLlmEntry = routerUpdate.providers.find((p) => p.id === 'freellmapi');
    expect(freeLlmEntry.isReady).toBe(true);
    expect(freeLlmEntry.apiKeyConfigured).toBe(true);
    expect(freeLlmEntry.baseUrl).toBe('https://router.example.com/v1');
  });

  it('handles /provider, /guide, /setcustom, /ghclone, /ghpush, unknown commands, and callback_query HTML/dedup cleanly', async () => {
    // Bootstrap owner
    await messageHandler({
      message_id: 1,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/start',
    });

    // 1. /provider shows inline keyboard with readiness badges (✅ / ⚠️)
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 2,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/provider',
    });
    const provMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    const provMarkupStr = JSON.stringify(provMsg.params.reply_markup);
    expect(provMarkupStr).toContain('✅');
    expect(provMarkupStr).toContain('⚠️');

    // 2. /provider gemini & /guide opencode & /setcustom work cleanly
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 3,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/provider gemini',
    });
    expect(mockState.apiCalls[0].params.text).toContain('Google Gemini');

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 4,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/guide opencode',
    });
    expect(mockState.apiCalls[0].params.text).toContain('OpenCode Zen');

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 5,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/setcustom https://custom.example.com/v1 sk-custom-123 coder-v1',
    });
    const setCustomReply = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(setCustomReply.params.text).toContain('<code>https://custom.example.com/v1</code>');
    expect(setCustomReply.params.text).toContain('<code>coder-v1</code>');

    // 3. /setgithub alias + /ghclone + /ghpush on slashed branch (feat/ui) report exact numeric counts
    await messageHandler({
      message_id: 6,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/setgithub ghp_validGithubTokenValue12345',
    });

    const ghUrls = [];
    mockState.fetchHandler = async (url, init = {}) => {
      ghUrls.push(`${init.method || 'GET'} ${url}`);
      if (url.endsWith('/git/trees/feat/ui?recursive=1')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              tree: [
                {
                  type: 'blob',
                  path: 'src/hello.js',
                  size: 32,
                  url: 'https://api.github.com/repos/octocat/Hello-World/git/blobs/sha1',
                },
              ],
            };
          },
        };
      }
      if (url.endsWith('/git/blobs/sha1')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              encoding: 'base64',
              content: bytesToBase64(utf8ToBytes('export const hi = 1;\n')),
            };
          },
        };
      }
      if (url.endsWith('/git/ref/heads/feat/ui')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { object: { sha: 'basecommit1234567' } };
          },
        };
      }
      if (url.endsWith('/git/commits/basecommit1234567')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { tree: { sha: 'basetree1234567' } };
          },
        };
      }
      if (url.endsWith('/git/trees') && init.method === 'POST') {
        return {
          ok: true,
          status: 201,
          async json() {
            return { sha: 'newtree1234567' };
          },
        };
      }
      if (url.endsWith('/git/commits') && init.method === 'POST') {
        return {
          ok: true,
          status: 201,
          async json() {
            return {
              sha: 'newcommit1234567',
              html_url: 'https://github.com/octocat/Hello-World/commit/newcommit1234567',
            };
          },
        };
      }
      if (url.endsWith('/git/refs/heads/feat/ui') && init.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          async json() {
            return { ref: 'refs/heads/feat/ui' };
          },
        };
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    };

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 7,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/ghclone octocat/Hello-World feat/ui',
    });
    const cloneEdit = mockState.apiCalls.find((c) => c.method === 'editMessageText');
    expect(cloneEdit.params.text).toContain('تعداد فایل‌ها: 1');
    expect(cloneEdit.params.text).not.toContain('undefined');

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 8,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/ghpush octocat/Hello-World feat: sync workspace',
    });
    const pushEdit = mockState.apiCalls.find((c) => c.method === 'editMessageText');
    expect(pushEdit.params.text).toContain('تعداد فایل‌ها: 1');
    expect(pushEdit.params.text).not.toContain('undefined');
    expect(ghUrls).toContain(
      'PATCH https://api.github.com/repos/octocat/Hello-World/git/refs/heads/feat/ui',
    );

    // 4. Unknown command containing 'key' deletes secret message and never invokes LLM fetch
    mockState.apiCalls = [];
    mockState.fetchHandler = async () => {
      throw new Error('LLM should not be called for unknown slash commands');
    };
    await messageHandler({
      message_id: 9,
      chat: { id: 3001 },
      from: { id: 3001, first_name: 'Admin' },
      text: '/setapikey sk-accidentally-typed-secret',
    });
    expect(
      mockState.apiCalls.some((c) => c.method === 'deleteMessage' && c.params.message_id === 9),
    ).toBe(true);
    expect(
      mockState.apiCalls.some(
        (c) => c.method === 'sendMessage' && c.params.text.includes('شناخته نشد'),
      ),
    ).toBe(true);

    // 5. callback_query `cb:guide_all` formats HTML and ignores benign "message is not modified"
    mockState.apiCalls = [];
    await callbackHandler({
      id: 'cbq-guide',
      from: { id: 3001, first_name: 'Admin' },
      message: { chat: { id: 3001 }, message_id: 50 },
      data: 'cb:guide_all',
    });
    const guideEdit = mockState.apiCalls.find((c) => c.method === 'editMessageText');
    expect(guideEdit.params.parse_mode).toBe('HTML');
    expect(guideEdit.params.text).toContain('<b>');
    expect(guideEdit.params.text).not.toContain('**');

    mockState.apiCalls = [];
    mockState.apiInterceptor = async (method) => {
      if (method === 'editMessageText') {
        throw new BotApiError(400, 'Bad Request: message is not modified', 'editMessageText');
      }
      return undefined;
    };
    await callbackHandler({
      id: 'cbq-dup',
      from: { id: 3001, first_name: 'Admin' },
      message: { chat: { id: 3001 }, message_id: 50 },
      data: 'cb:status',
    });
    expect(mockState.apiCalls.some((c) => c.method === 'sendMessage')).toBe(false);
  });

  it('keeps Mini App HTML, JS DOM bindings, toast/confirm helpers, and built bundle consistent', () => {
    const html = fs.readFileSync(path.resolve('miniapp/src/index.html'), 'utf8');
    const appJs = fs.readFileSync(path.resolve('miniapp/src/app.js'), 'utf8');

    const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
    const queriedIds = Array.from(
      appJs.matchAll(/document\.getElementById\('([^']+)'\)/g),
      (m) => m[1],
    );
    expect(queriedIds.length).toBeGreaterThan(15);
    for (const id of queriedIds) {
      expect(htmlIds.has(id)).toBe(true);
    }

    expect(appJs).toContain('function showToast(');
    expect(appJs).toContain('function confirmDialog(');
    // Ensure modular ApiKeysPanel renders a single .provider-card root per card
    const apiKeysPanelJs = fs.readFileSync(
      path.resolve('miniapp/src/components/ApiKeysPanel.js'),
      'utf8',
    );
    const cardClassMatches =
      apiKeysPanelJs.match(/card\.className = `provider-card/g) ?? [];
    expect(cardClassMatches).toHaveLength(1);
  });
});
