import { beforeEach, describe, expect, it } from 'vitest';
import agentEndpoint from '../tgcloud/endpoints/agent.js';
import studioEndpoint from '../tgcloud/endpoints/studio.js';
import callbackHandler from '../tgcloud/handlers/callback_query.js';
import messageHandler from '../tgcloud/handlers/message.js';
import { createZipBytes } from '../tgcloud/lib/services/zip-service.js';
import { mockState, resetMockSdk } from './helpers/mock-sdk.js';
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
  });
});
