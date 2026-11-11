import { beforeEach, describe, expect, it } from 'vitest';
import { runCodingAgent } from '../tgcloud/lib/agent/coding-agent.js';
import { buildServerlessSystemPrompt } from '../tgcloud/lib/agent/system-prompt.js';
import { createAgentTools } from '../tgcloud/lib/agent/tools.js';
import {
  ensureUser,
  saveUserGeminiKey,
} from '../tgcloud/lib/services/auth-service.js';
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../tgcloud/lib/services/workspace-service.js';
import { extractZipBytes } from '../tgcloud/lib/services/zip-service.js';
import { mockState, resetMockSdk } from './helpers/mock-sdk.js';
import { resetMockDatabase } from './helpers/mock-sdk-db.js';

describe('Telegram Serverless CodingAgent (Gemini REST + SQLite Workspace + V8 Sandbox)', () => {
  beforeEach(() => {
    resetMockDatabase();
    resetMockSdk();
  });

  it('runs multi-step tool calls, preserves thoughtSignature, verifies JS, and exports ZIP', async () => {
    const user = await ensureUser({ id: 7001, first_name: 'Ali', username: 'ali_dev' });
    await saveUserGeminiKey(user, 'AIzaSyFakeServerlessGeminiKey12345');
    const updatedUser = await ensureUser({ id: 7001, first_name: 'Ali', username: 'ali_dev' });

    const geminiRequests = [];
    let step = 0;

    mockState.fetchHandler = async (url, init) => {
      geminiRequests.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      step += 1;

      let responseObj;
      if (step === 1) {
        responseObj = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    thought: true,
                    text: 'Write fib.js first.',
                    thoughtSignature: 'sig-serverless-1',
                  },
                  {
                    functionCall: {
                      id: 'call-1',
                      name: 'write_file',
                      args: {
                        file_path: 'src/fib.js',
                        content:
                          'export function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }\n',
                      },
                    },
                  },
                ],
              },
            },
          ],
        };
      } else if (step === 2) {
        responseObj = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      id: 'call-2',
                      name: 'verify_javascript',
                      args: {
                        code: 'const fib = (n) => (n <= 1 ? n : fib(n - 1) + fib(n - 2)); assert(fib(8) === 21, "fib(8) must be 21"); console.log("PASS:", fib(8));',
                      },
                    },
                  },
                  {
                    functionCall: {
                      id: 'call-3',
                      name: 'export_project_zip',
                      args: {},
                    },
                  },
                ],
              },
            },
          ],
        };
      } else {
        responseObj = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: 'فایل `src/fib.js` ساخته شد، در سندباکس V8 تست شد (`fib(8) === 21`) و فایل ZIP آماده ارسال گردید.',
                  },
                ],
              },
            },
          ],
        };
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return responseObj;
        },
        async text() {
          return JSON.stringify(responseObj);
        },
      };
    };

    const result = await runCodingAgent({
      userRow: updatedUser,
      prompt: 'تابع فیبوناچی بساز، تست کن و خروجی زیپ بده',
    });

    expect(result.stepsUsed).toBe(3);
    expect(result.toolCallsExecuted).toHaveLength(3);
    expect(result.toolCallsExecuted.every((t) => t.ok)).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].fileName).toBe('default.zip');

    // Verify API key was sent via header, NOT leaked in URL
    expect(geminiRequests[0].url).not.toContain('AIzaSy');
    expect(geminiRequests[0].headers['x-goog-api-key']).toBe(
      'AIzaSyFakeServerlessGeminiKey12345',
    );

    // Verify thoughtSignature was preserved on Turn 2
    const turn2ModelMsg = geminiRequests[1].body.contents.find((c) => c.role === 'model');
    expect(turn2ModelMsg.parts[0].thoughtSignature).toBe('sig-serverless-1');

    // Verify file stored in SQLite workspace AND inside exported ZIP
    const dbFile = await readWorkspaceFile(7001, 'default', 'src/fib.js');
    expect(dbFile.content).toContain('export function fib');

    const unzipped = await extractZipBytes(result.artifacts[0].bytes);
    expect(unzipped).toEqual([
      {
        path: 'src/fib.js',
        content: 'export function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }\n',
      },
    ]);
  });

  it('aligns system prompt tool names with declared tools and handles invalid read_file line numbers safely', async () => {
    const tools = createAgentTools();
    const declaredNames = new Set(tools.map((t) => t.declaration.name));
    const sysPrompt = buildServerlessSystemPrompt({
      projectName: 'default',
      providerTitle: '🆓 OpenCode Zen',
      model: 'big-pickle',
      fileManifest: [],
      githubConfigured: false,
    });

    expect(declaredNames.has('search_code')).toBe(true);
    expect(declaredNames.has('send_file_to_chat')).toBe(true);
    expect(sysPrompt).toContain('search_code');
    expect(sysPrompt).toContain('send_file_to_chat');
    expect(sysPrompt).not.toContain('search_files');
    expect(sysPrompt).not.toContain('send_workspace_file');

    await writeWorkspaceFile(7002, 'default', 'demo.js', 'line1\nline2\nline3');
    const readTool = tools.find((t) => t.declaration.name === 'read_file');
    const res = await readTool.execute(
      { file_path: 'demo.js', start_line: 'not-a-number', end_line: -5 },
      { tgId: 7002, projectName: 'default' },
    );
    expect(res.output.shown_range).toBe('1-3');
    expect(res.output.content).toContain('1: line1');
  });
});
