import type { GenerateContentResponse } from '@google/genai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodingAgent } from '../src/agent/coding-agent.js';
import type { GeminiClientLike, GenerateStepParams } from '../src/agent/gemini-provider.js';
import { ToolRegistry } from '../src/agent/tools/index.js';
import { loadConfig } from '../src/config/env.js';
import { SessionService } from '../src/services/session.service.js';
import { WorkspaceService } from '../src/services/workspace.service.js';

describe('CodingAgent Multi-Turn Function-Calling Loop', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-agent-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('executes multi-step tool calls, preserves Gemini thought signatures, and delivers artifacts', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_TOKEN: '123456789:TEST_TOKEN_VALUE',
      GEMINI_API_KEY: 'test-gemini-key',
      WORKSPACES_ROOT: path.join(tempDir, 'workspaces'),
      DATA_DIR: path.join(tempDir, 'data'),
    });

    const workspaceService = new WorkspaceService(config.WORKSPACES_ROOT);
    await workspaceService.init();

    const sessionService = new SessionService(config.DATA_DIR, config.GEMINI_DEFAULT_MODEL);
    await sessionService.init();

    const toolRegistry = new ToolRegistry(workspaceService);

    let callIndex = 0;
    const capturedHistories: GenerateStepParams[] = [];

    const mockGemini: GeminiClientLike = {
      async generateStep(params: GenerateStepParams): Promise<GenerateContentResponse> {
        capturedHistories.push(structuredClone(params));
        callIndex += 1;

        if (callIndex === 1) {
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      thought: true,
                      text: 'Let us write fib.js and test it.',
                      thoughtSignature: 'sig-turn-1',
                    },
                    {
                      functionCall: {
                        id: 'fc-1',
                        name: 'write_file',
                        args: {
                          file_path: 'fib.js',
                          content:
                            'const fib = (n) => (n <= 1 ? n : fib(n - 1) + fib(n - 2));\nconsole.log(fib(7));\n',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse;
        }

        if (callIndex === 2) {
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        id: 'fc-2',
                        name: 'run_command',
                        args: { command: 'node fib.js' },
                      },
                    },
                    {
                      functionCall: {
                        id: 'fc-3',
                        name: 'export_project_zip',
                        args: {},
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
                parts: [
                  {
                    text: 'برنامه دنباله فیبوناچی در فایل `fib.js` ساخته و تست شد (خروجی برای ۷ برابر `13` است) و فایل ZIP ارسال گردید.',
                  },
                ],
              },
            },
          ],
        } as unknown as GenerateContentResponse;
      },
    };

    const agent = new CodingAgent(
      config,
      mockGemini,
      workspaceService,
      sessionService,
      toolRegistry,
    );

    const events: string[] = [];
    const result = await agent.run({
      userId: 9001,
      username: 'dev_user',
      prompt: 'یک برنامه فیبوناچی با جاوااسکریپت بساز، تست کن و زیپش را بفرست',
      onProgress: (ev) => {
        events.push(`${ev.phase}:${ev.toolName ?? 'llm'}`);
      },
    });

    expect(result.stepsUsed).toBe(3);
    expect(result.toolCallsExecuted).toHaveLength(3);
    expect(result.replyText).toContain('fib.js');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].fileName).toBe('default.zip');

    // Verify thoughtSignature was preserved on Turn 2 input contents!
    const secondCallModelTurn = capturedHistories[1].contents.find((c) => c.role === 'model');
    expect(secondCallModelTurn?.parts?.[0]?.thoughtSignature).toBe('sig-turn-1');

    // Clean up temp zip artifact
    await fs.rm(path.dirname(result.artifacts[0].filePath), { recursive: true, force: true });
  });

  it('trims conversation history without leaving orphaned functionResponse turns', () => {
    const trimmed = SessionService.trimHistorySafely(
      [
        { role: 'user', parts: [{ text: 'first prompt' }] },
        { role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'list_files', response: { output: [] } } }],
        },
        { role: 'model', parts: [{ text: 'done 1' }] },
        { role: 'user', parts: [{ text: 'second prompt' }] },
        { role: 'model', parts: [{ text: 'done 2' }] },
      ],
      4,
    );

    // Slicing last 4 naively would start at functionResponse; trimHistorySafely advances to 'second prompt'
    expect(trimmed[0].role).toBe('user');
    expect(trimmed[0].parts?.[0]?.text).toBe('second prompt');
  });
});
