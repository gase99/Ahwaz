import type { Content, FunctionCall, Part } from '@google/genai';
import type { AppConfig } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { SessionService } from '../services/session.service.js';
import type { WorkspaceService } from '../services/workspace.service.js';
import type {
  AgentRunInput,
  AgentRunResult,
  ArtifactDelivery,
  ToolExecutionContext,
  ToolExecutionSummary,
} from '../types/agent.js';
import type { GeminiClientLike } from './gemini-provider.js';
import { buildCodingAgentSystemPrompt } from './system-prompt.js';
import type { ToolRegistry } from './tools/index.js';

export class CodingAgent {
  constructor(
    private readonly config: AppConfig,
    private readonly gemini: GeminiClientLike,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionService: SessionService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const session = await this.sessionService.getSession(input.userId, input.username);
    const projectName = session.activeProject;
    const projectRoot = await this.workspaceService.ensureProject(input.userId, projectName);

    const workspaceFilesPreview = await this.workspaceService.listFilesRelative(projectRoot, {
      maxEntries: 60,
    });

    const systemInstruction = buildCodingAgentSystemPrompt({
      projectName,
      workspaceFilesPreview,
      shellEnabled: this.config.ENABLE_SHELL_EXECUTION,
    });

    const history: Content[] = [
      ...this.sessionService.getProjectHistory(session, projectName),
    ];

    let fullPrompt = input.prompt.trim();
    if (input.attachedFilesInfo && input.attachedFilesInfo.length > 0) {
      const notes = input.attachedFilesInfo.map((f) => `- ${f}`).join('\n');
      fullPrompt = `${fullPrompt}\n\n[فایل‌های پیوست‌شده در فضای کاری پروژه ذخیره شدند:\n${notes}]`;
    }

    history.push({
      role: 'user',
      parts: [{ text: fullPrompt }],
    });

    const artifacts: ArtifactDelivery[] = [];
    const toolCallsExecuted: ToolExecutionSummary[] = [];

    const toolContext: ToolExecutionContext = {
      userId: input.userId,
      projectName,
      projectRoot,
      abortSignal: input.abortSignal,
      enableShell: this.config.ENABLE_SHELL_EXECUTION,
      commandTimeoutMs: this.config.COMMAND_TIMEOUT_MS,
      githubToken: this.config.GITHUB_TOKEN,
      gitAuthorName: this.config.GIT_AUTHOR_NAME,
      gitAuthorEmail: this.config.GIT_AUTHOR_EMAIL,
      queueArtifact: (artifact) => {
        artifacts.push(artifact);
      },
    };

    const declarations = this.toolRegistry.getDeclarations();
    const maxSteps = this.config.AGENT_MAX_STEPS;
    let finalReplyText = '';
    let stepsUsed = 0;

    for (let step = 1; step <= maxSteps; step++) {
      if (input.abortSignal?.aborted) {
        throw new Error('عملیات توسط کاربر متوقف شد.');
      }

      stepsUsed = step;
      await input.onProgress?.({
        step,
        maxSteps,
        phase: 'thinking',
        label: `🧠 در حال تحلیل و کدنویسی با ${session.model} (گام ${step})...`,
      });

      const response = await this.gemini.generateStep({
        model: session.model,
        systemInstruction,
        contents: history,
        tools: declarations,
        abortSignal: input.abortSignal,
      });

      const candidate = response.candidates?.[0];
      const modelContent = candidate?.content;

      if (!modelContent || !modelContent.parts || modelContent.parts.length === 0) {
        finalReplyText =
          response.text?.trim() ||
          'مدل پاسخی تولید نکرد. لطفاً درخواست خود را واضح‌تر ارسال کنید یا `/reset` بزنید.';
        history.push({
          role: 'model',
          parts: [{ text: finalReplyText }],
        });
        break;
      }

      // Push exact model content to preserve thought/thoughtSignature parts for Gemini 2.5 / 3
      history.push({
        role: modelContent.role ?? 'model',
        parts: modelContent.parts,
      });

      const functionCalls: FunctionCall[] = modelContent.parts
        .map((p) => p.functionCall)
        .filter((fc): fc is FunctionCall => Boolean(fc && fc.name));

      if (functionCalls.length === 0) {
        const textParts = modelContent.parts
          .filter((p) => !p.thought && typeof p.text === 'string')
          .map((p) => p.text as string);
        finalReplyText = textParts.join('\n').trim() || response.text?.trim() || 'انجام شد.';
        break;
      }

      const responseParts: Part[] = [];

      for (const call of functionCalls) {
        const toolName = call.name ?? 'unknown';
        const args = (call.args ?? {}) as Record<string, unknown>;
        const tool = this.toolRegistry.get(toolName);

        if (!tool) {
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: toolName,
              response: { error: `ابزار ناشناخته: ${toolName}` },
            },
          });
          continue;
        }

        const progressLabel = tool.formatProgress(args);
        await input.onProgress?.({
          step,
          maxSteps,
          phase: 'tool_start',
          toolName,
          label: progressLabel,
        });

        const t0 = Date.now();
        let resultPayload: Record<string, unknown>;
        let ok = true;

        try {
          resultPayload = await tool.execute(args, toolContext);
          if ('error' in resultPayload && resultPayload.error) {
            ok = false;
          }
        } catch (err) {
          ok = false;
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ err, toolName, userId: input.userId }, 'Tool execution error');
          resultPayload = { error: message };
        }

        const durationMs = Date.now() - t0;
        toolCallsExecuted.push({
          name: toolName,
          label: progressLabel,
          ok,
          durationMs,
        });

        await input.onProgress?.({
          step,
          maxSteps,
          phase: ok ? 'tool_done' : 'tool_error',
          toolName,
          label: progressLabel,
        });

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: resultPayload,
          },
        });
      }

      history.push({
        role: 'user',
        parts: responseParts,
      });

      if (step === maxSteps) {
        finalReplyText =
          '⚠️ سقف تعداد گام‌های خودکار ایجنت در این نوبت به پایان رسید. تغییرات تا این لحظه در Workspace ذخیره شده‌اند؛ برای ادامه کافیست پیام «ادامه بده» را ارسال کنید.';
        history.push({
          role: 'model',
          parts: [{ text: finalReplyText }],
        });
      }
    }

    session.stats.totalPrompts += 1;
    session.stats.totalToolCalls += toolCallsExecuted.length;
    this.sessionService.setProjectHistory(session, projectName, history);
    await this.sessionService.saveSession(session);

    return {
      replyText: finalReplyText,
      projectName,
      modelUsed: session.model,
      stepsUsed,
      toolCallsExecuted,
      artifacts,
    };
  }
}
