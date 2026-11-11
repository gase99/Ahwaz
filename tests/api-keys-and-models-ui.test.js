import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import studioEndpoint from '../tgcloud/endpoints/studio.js';
import testKeyEndpoint from '../tgcloud/endpoints/test_key.js';
import callbackHandler from '../tgcloud/handlers/callback_query.js';
import messageHandler from '../tgcloud/handlers/message.js';
import {
  PROVIDER_HELP,
  PROVIDER_LINKS_TABLE,
  PROVIDER_LIST,
} from '../tgcloud/lib/agent/providers.js';
import {
  countStoredUserKeys,
  decryptStoredKey,
  encryptStoredKey,
  listUserApiKeyRecords,
  maskApiKey,
} from '../tgcloud/lib/services/auth-service.js';
import {
  formatModelOptionLabel,
  resolveUiConnectionState,
  summarizeProviderCounts,
} from '../miniapp/src/components/ProviderCatalog.js';
import { mockState, resetMockSdk } from './helpers/mock-sdk.js';
import { resetMockDatabase } from './helpers/mock-sdk-db.js';

describe('Unified API Keys, Connection Testing, & Grouped Model Selection', () => {
  beforeEach(() => {
    resetMockDatabase();
    resetMockSdk();
  });

  it('encrypts API keys in SQLite api_keys table, masks them in UI snapshots, and syncs Mini App <-> Chat', async () => {
    const ctx = { initData: { user: { id: 7701, first_name: 'Reza' } } };
    const sampleDummyKey = 'gsk_' + 'TestPlaceholderKey00009999';

    // 1. Encrypt/decrypt roundtrip never stores raw key
    const encrypted = encryptStoredKey(sampleDummyKey, 7701, 'groq');
    expect(encrypted.startsWith('enc1:')).toBe(true);
    expect(encrypted).not.toContain('TestPlaceholderKey');
    expect(decryptStoredKey(encrypted, 7701, 'groq')).toBe(sampleDummyKey);
    expect(maskApiKey(sampleDummyKey)).toBe('gsk_••••••••••9999');

    // 2. Save key from Mini App with `notifyChat: true` -> stores in api_keys & notifies chat
    const saveRes = await studioEndpoint(
      {
        action: 'setProvider',
        providerId: 'groq',
        apiKey: sampleDummyKey,
        model: 'llama-3.3-70b-versatile',
        notifyChat: true,
      },
      ctx,
    );

    expect(saveRes.provider).toBe('groq');
    expect(saveRes.model).toBe('llama-3.3-70b-versatile');

    const groqSnap = saveRes.providers.find((p) => p.id === 'groq');
    expect(groqSnap.apiKeyConfigured).toBe(true);
    expect(groqSnap.maskedKey).toBe('gsk_••••••••••9999');
    expect(JSON.stringify(groqSnap)).not.toContain(sampleDummyKey);

    // Verify SQLite `api_keys` row is encrypted at rest
    const dbRecords = await listUserApiKeyRecords(7701);
    expect(dbRecords).toHaveLength(1);
    expect(dbRecords[0].provider).toBe('groq');
    expect(dbRecords[0].keyEncrypted).not.toContain('TestPlaceholderKey');
    expect(await countStoredUserKeys(7701)).toBe(1);

    // Verify Telegram chat received masked sync confirmation
    const syncMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(syncMsg).toBeDefined();
    expect(syncMsg.params.text).toContain('Mini App');
    expect(syncMsg.params.text).toContain('gsk_••••••••••9999');
    expect(syncMsg.params.text).not.toContain(sampleDummyKey);

    // 3. Test connection via `test_key` endpoint -> returns `{ success, latency_ms, error }`
    mockState.fetchHandler = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: 'pong' } }] };
      },
    });

    const testOk = await testKeyEndpoint({ providerId: 'groq' }, ctx);
    expect(testOk.success).toBe(true);
    expect(testOk.latency_ms).toBeGreaterThanOrEqual(1);
    expect(testOk.error).toBeNull();
    expect(testOk.providers.find((p) => p.id === 'groq').status).toBe('connected');

    // Simulate HTTP 401 invalid key -> status flips to `invalid` with Persian error
    mockState.fetchHandler = async () => ({
      ok: false,
      status: 401,
      async text() {
        return 'Invalid API Key';
      },
    });

    const testFail = await testKeyEndpoint({ providerId: 'groq' }, ctx);
    expect(testFail.success).toBe(false);
    expect(testFail.error).toContain('401');
    expect(testFail.providers.find((p) => p.id === 'groq').status).toBe('invalid');

    // 4. Delete key from Mini App -> removes from SQLite `api_keys` and falls back to OpenCode
    mockState.apiCalls = [];
    const delRes = await studioEndpoint(
      {
        action: 'deleteKey',
        providerId: 'groq',
        notifyChat: true,
      },
      ctx,
    );
    expect(delRes.provider).toBe('opencode');
    expect(await countStoredUserKeys(7701)).toBe(0);
    expect(mockState.apiCalls.some((c) => c.method === 'sendMessage')).toBe(true);
  });

  it('supports /keys (DB count + inline test/delete callbacks) and /model (grouped menu, list, smart switch)', async () => {
    const from = { id: 8801, first_name: 'Mina' };

    // Bootstrap admin user
    await messageHandler({
      message_id: 1,
      chat: { id: 8801 },
      from,
      text: '/start',
    });

    // Save a Gemini placeholder key via `/setkey`
    await messageHandler({
      message_id: 2,
      chat: { id: 8801 },
      from,
      text: '/setkey gemini ' + 'AIza' + 'DummyTestKeyForUnitSpec1234',
    });

    // 1. `/keys` displays stored DB key count and inline test/delete buttons
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 3,
      chat: { id: 8801 },
      from,
      text: '/keys',
    });
    const keysMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(keysMsg.params.text).toContain('کلیدهای ذخیره‌شده در دیتابیس SQLite: <b>1</b>');
    const keysMarkup = JSON.stringify(keysMsg.params.reply_markup);
    expect(keysMarkup).toContain('cb:ktest:gemini');
    expect(keysMarkup).toContain('cb:kdel:gemini');

    // 2. Inline callback `cb:ktest:gemini` pings Gemini endpoint and edits report
    mockState.apiCalls = [];
    mockState.fetchHandler = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
      },
    });
    await callbackHandler({
      id: 'cbq-ktest-1',
      from,
      message: { chat: { id: 8801 }, message_id: 10 },
      data: 'cb:ktest:gemini',
    });
    const editAfterTest = mockState.apiCalls.find((c) => c.method === 'editMessageText');
    expect(editAfterTest.params.text).toContain('تست اتصال');
    expect(editAfterTest.params.text).toContain('موفق بود');

    // 3. `/model` (no args) shows grouped inline keyboard; `/model list` prints full catalog with ✅/❌
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 4,
      chat: { id: 8801 },
      from,
      text: '/model',
    });
    const modelMenuMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(JSON.stringify(modelMenuMsg.params.reply_markup)).toContain('cb:mprov:');

    mockState.apiCalls = [];
    await messageHandler({
      message_id: 5,
      chat: { id: 8801 },
      from,
      text: '/model list',
    });
    const modelListMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(modelListMsg.params.text).toContain('فهرست کامل مدل‌ها');
    expect(modelListMsg.params.text).toContain('✅ آماده');
    expect(modelListMsg.params.text).toContain('❌ فاقد کلید');

    // 4. `/model minimax-m2.5-free` smartly switches provider to `opencode` + model
    mockState.apiCalls = [];
    await messageHandler({
      message_id: 6,
      chat: { id: 8801 },
      from,
      text: '/model minimax-m2.5-free',
    });
    const modelSwitchMsg = mockState.apiCalls.find((c) => c.method === 'sendMessage');
    expect(modelSwitchMsg.params.text).toContain('minimax-m2.5-free');
    expect(modelSwitchMsg.params.text).toContain('OpenCode Zen');

    // 5. Inline callback `cb:kdel:gemini` deletes stored key
    mockState.apiCalls = [];
    await callbackHandler({
      id: 'cbq-kdel-1',
      from,
      message: { chat: { id: 8801 }, message_id: 10 },
      data: 'cb:kdel:gemini',
    });
    expect(await countStoredUserKeys(8801)).toBe(0);
  });

  it('provides complete 9-provider catalog, reference links table, and modular UI helpers without hardcoded secrets', () => {
    expect(PROVIDER_LIST).toHaveLength(9);
    expect(PROVIDER_LINKS_TABLE).toHaveLength(9);
    expect(Object.keys(PROVIDER_HELP)).toHaveLength(9);

    for (const help of Object.values(PROVIDER_HELP)) {
      expect(Array.isArray(help.steps) && help.steps.length > 0).toBe(true);
      expect(Array.isArray(help.freeModels) && help.freeModels.length > 0).toBe(true);
    }

    const counts = summarizeProviderCounts([
      { id: 'opencode', isReady: true, status: 'connected' },
      { id: 'groq', isReady: true, status: 'invalid' },
      { id: 'gemini', isReady: false, status: 'disconnected' },
    ]);
    expect(counts.connected).toHaveLength(1);
    expect(counts.invalid).toHaveLength(1);
    expect(counts.disconnected).toHaveLength(1);
    expect(resolveUiConnectionState({ isReady: true, status: 'invalid' })).toBe('invalid');

    const optLabel = formatModelOptionLabel(
      { id: 'big-pickle', label: 'big-pickle', free: true, recommended: true, tier: 'smart' },
      { id: 'opencode' },
    );
    expect(optLabel).toContain('⭐');
    expect(optLabel).toContain('🆓');
    expect(optLabel).toContain('🧠');

    // Verify all 4 ES modules are bundled into miniapp-dist/components/
    for (const modName of [
      'ProviderCatalog.js',
      'ApiKeysPanel.js',
      'ModelSelector.js',
      'ConnectionsDashboard.js',
    ]) {
      expect(
        fs.existsSync(path.resolve('miniapp-dist/components', modName)),
      ).toBe(true);
    }
  });
});
