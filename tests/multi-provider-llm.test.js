import { beforeEach, describe, expect, it } from 'vitest';
import callbackHandler from '../tgcloud/handlers/callback_query.js';
import messageHandler from '../tgcloud/handlers/message.js';
import { runCodingAgent } from '../tgcloud/lib/agent/coding-agent.js';
import {
  ensureUser,
  saveProviderCredentials,
  saveUserGeminiKey,
  setActiveProviderAndModel,
} from '../tgcloud/lib/services/auth-service.js';
import { readWorkspaceFile } from '../tgcloud/lib/services/workspace-service.js';
import { mockState, resetMockSdk } from './helpers/mock-sdk.js';
import { resetMockDatabase } from './helpers/mock-sdk-db.js';

describe('Multi-Provider Free LLM Support (OpenCode Zen, FreeLLMAPI, ApiFreeLLM, LLM7 Keyless)', () => {
  beforeEach(() => {
    resetMockDatabase();
    resetMockSdk();
  });

  it('executes OpenCode Zen free models (big-pickle / deepseek-v4.1-flash-free) with native OpenAI tool_calls and syncs live /models', async () => {
    // 1. User configures OpenCode Zen via `/opencode oc_free_key_123` -> secret message deleted
    await messageHandler({
      message_id: 10,
      chat: { id: 9001 },
      from: { id: 9001, first_name: 'Reza' },
      text: '/opencode oc_free_key_123',
    });

    expect(
      mockState.apiCalls.some(
        (c) => c.method === 'deleteMessage' && c.params.message_id === 10,
      ),
    ).toBe(true);

    // 2. User taps `cb:sync_opencode` -> fetches live catalog from https://opencode.ai/zen/v1/models
    mockState.fetchHandler = async (url) => {
      expect(url).toBe('https://opencode.ai/zen/v1/models');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              { id: 'big-pickle' },
              { id: 'deepseek-v4.1-flash-free' },
              { id: 'qwen3.6-plus-free' },
              { id: 'claude-sonnet-4-6' }, // paid -> should be filtered out
            ],
          };
        },
      };
    };

    await callbackHandler({
      id: 'cb-sync-1',
      from: { id: 9001, first_name: 'Reza' },
      message: { chat: { id: 9001 }, message_id: 20 },
      data: 'cb:sync_opencode',
    });

    const editCall = mockState.apiCalls.find((c) => c.method === 'editMessageText');
    const serializedMarkup = JSON.stringify(editCall.params.reply_markup);
    expect(serializedMarkup).toContain('qwen3.6-plus-free');
    expect(serializedMarkup).not.toContain('claude-sonnet-4-6');

    // 3. Run multi-step coding agent on OpenCode Zen `deepseek-v4.1-flash-free`
    await setActiveProviderAndModel(9001, 'opencode', 'deepseek-v4.1-flash-free');
    const userRow = await ensureUser({ id: 9001, first_name: 'Reza' });

    const openCodeCalls = [];
    let turn = 0;
    mockState.fetchHandler = async (url, init) => {
      openCodeCalls.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      turn += 1;

      if (turn === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          async json() {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: 'oc_tc_1',
                        type: 'function',
                        function: {
                          name: 'write_file',
                          arguments: JSON.stringify({
                            file_path: 'src/greet.js',
                            content: 'export const greet = (n) => `Salam ${n}`;\n',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'فایل `src/greet.js` با مدل رایگان OpenCode ساخته شد.',
                },
              },
            ],
          };
        },
      };
    };

    const res = await runCodingAgent({
      userRow,
      prompt: 'فایل greet.js را بساز',
    });

    expect(openCodeCalls[0].url).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(openCodeCalls[0].headers.Authorization).toBe('Bearer oc_free_key_123');
    // Verify tool schema types were lowercased for OpenAI compatibility (`object` instead of `OBJECT`)
    expect(openCodeCalls[0].body.tools[0].function.parameters.type).toBe('object');
    expect(res.providerId).toBe('opencode');
    expect(res.model).toBe('deepseek-v4.1-flash-free');

    const saved = await readWorkspaceFile(9001, 'default', 'src/greet.js');
    expect(saved.content).toContain('Salam');
  });

  it('automatically falls back to ReAct <tool_call> mode when a free model rejects native OpenAI tools (HTTP 400)', async () => {
    const userRow = await ensureUser({ id: 9002, first_name: 'Mina' });
    await saveProviderCredentials(userRow, 'opencode', { apiKey: 'oc_key_react' });
    const refreshed = await ensureUser({ id: 9002, first_name: 'Mina' });

    let callCount = 0;
    mockState.fetchHandler = async (_url, init) => {
      callCount += 1;
      const body = JSON.parse(init.body);

      // Call 1 has `tools` -> simulate free model returning 400 "tools not supported"
      if (callCount === 1) {
        expect(body.tools).toBeDefined();
        return {
          ok: false,
          status: 400,
          async text() {
            return '{"error": "tool use / function calling is not supported on this free model"}';
          },
        };
      }

      // Call 2 is the automatic ReAct retry WITHOUT `tools` -> model emits `<tool_call>` block!
      if (callCount === 2) {
        expect(body.tools).toBeUndefined();
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          async json() {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content:
                      'در حال ساخت فایل...\n<tool_call>\n{"name": "write_file", "args": {"file_path": "hello.txt", "content": "ReAct works!"}}\n</tool_call>',
                  },
                },
              ],
            };
          },
        };
      }

      // Next step after tool execution
      if (body.tools) {
        return {
          ok: false,
          status: 400,
          async text() {
            return 'function calling unsupported';
          },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'فایل `hello.txt` با موفقیت ذخیره شد.',
                },
              },
            ],
          };
        },
      };
    };

    const res = await runCodingAgent({
      userRow: refreshed,
      prompt: 'فایل hello.txt را بساز',
    });

    expect(res.toolCallsExecuted).toHaveLength(1);
    expect(res.toolCallsExecuted[0].ok).toBe(true);
    const file = await readWorkspaceFile(9002, 'default', 'hello.txt');
    expect(file.content).toBe('ReAct works!');
  });

  it('supports FreeLLMAPI unified /v1 router (with X-Routed-Via header) and ApiFreeLLM.com REST endpoint', async () => {
    // Part A: Configure FreeLLMAPI router via `/freellm <url> <key> auto:smart`
    await messageHandler({
      message_id: 30,
      chat: { id: 9003 },
      from: { id: 9003, first_name: 'Saeed' },
      text: '/freellm https://freellm-router.example.com/v1 freellmapi-secret-xyz auto:smart',
    });

    expect(
      mockState.apiCalls.some(
        (c) => c.method === 'deleteMessage' && c.params.message_id === 30,
      ),
    ).toBe(true);

    let userRow = await ensureUser({ id: 9003, first_name: 'Saeed' });
    expect(userRow.provider).toBe('freellmapi');
    expect(userRow.model).toBe('auto:smart');

    mockState.fetchHandler = async (url, init) => {
      expect(url).toBe('https://freellm-router.example.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer freellmapi-secret-xyz');
      return {
        ok: true,
        status: 200,
        headers: new Map([['x-routed-via', 'groq/llama-3.3-70b-versatile']]),
        async json() {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'پاسخ از طریق روتر یکپارچه FreeLLMAPI آماده شد.',
                },
              },
            ],
          };
        },
      };
    };

    const routerRes = await runCodingAgent({
      userRow,
      prompt: 'سلام روتر FreeLLMAPI',
    });
    expect(routerRes.routedVia).toBe('groq/llama-3.3-70b-versatile');
    expect(routerRes.replyText).toContain('FreeLLMAPI');

    // Part B: Switch to ApiFreeLLM.com via `/freellm apf_live_token_777`
    await messageHandler({
      message_id: 31,
      chat: { id: 9003 },
      from: { id: 9003, first_name: 'Saeed' },
      text: '/freellm apf_live_token_777',
    });

    userRow = await ensureUser({ id: 9003, first_name: 'Saeed' });
    expect(userRow.provider).toBe('apifreellm');

    let apiFreeStep = 0;
    mockState.fetchHandler = async (url, init) => {
      apiFreeStep += 1;
      expect(url).toBe('https://apifreellm.com/api/v1/chat');
      expect(init.headers.Authorization).toBe('Bearer apf_live_token_777');
      const payload = JSON.parse(init.body);
      expect(payload.model).toBe('apifreellm');

      if (apiFreeStep === 1) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              success: true,
              response:
                '<tool_call>{"name": "write_file", "args": {"file_path": "apifree.js", "content": "export default 42;"}}</tool_call>',
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            response: 'فایل `apifree.js` از طریق سرویس رایگان ApiFreeLLM ساخته شد!',
          };
        },
      };
    };

    const apiFreeRes = await runCodingAgent({
      userRow,
      prompt: 'فایل apifree.js را بساز',
    });
    expect(apiFreeRes.toolCallsExecuted).toHaveLength(1);
    const saved = await readWorkspaceFile(9003, 'default', 'apifree.js');
    expect(saved.content).toBe('export default 42;');
  });

  it('supports keyless LLM7 with automatic zero-key failover to Pollinations and preserves cross-provider history', async () => {
    let userRow = await ensureUser({ id: 9004, first_name: 'Nima' });
    await saveUserGeminiKey(userRow, 'AIzaSyTestCrossProviderKey111');
    userRow = await ensureUser({ id: 9004, first_name: 'Nima' });

    // Turn 1 on Google Gemini
    mockState.fetchHandler = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'من پروژه را با Gemini شروع کردم.' }],
              },
            },
          ],
        };
      },
    });
    await runCodingAgent({ userRow, prompt: 'شروع پروژه' });

    // Switch same project to keyless `llm7` -> simulate LLM7 429 so it auto-fails over to `pollinations`!
    await setActiveProviderAndModel(9004, 'llm7', 'default');
    userRow = await ensureUser({ id: 9004, first_name: 'Nima' });

    const visitedUrls = [];
    mockState.fetchHandler = async (url) => {
      visitedUrls.push(url);
      if (url.includes('api.llm7.io')) {
        return {
          ok: false,
          status: 429,
          async text() {
            return 'Rate limit exceeded';
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'ادامه پروژه بدون هیچ کلید API روی سرویس جایگزین انجام شد!',
                },
              },
            ],
          };
        },
      };
    };

    const failoverRes = await runCodingAgent({
      userRow,
      prompt: 'ادامه بده',
    });

    expect(visitedUrls).toEqual([
      'https://api.llm7.io/v1/chat/completions',
      'https://text.pollinations.ai/openai',
    ]);
    expect(failoverRes.routedVia).toContain('pollinations');
    expect(failoverRes.replyText).toContain('بدون هیچ کلید API');
  });
});
