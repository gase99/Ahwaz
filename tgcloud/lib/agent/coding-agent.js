import {
  incrementStats,
  resolveGithubToken,
  resolveProviderAuth,
} from '../services/auth-service.js';
import {
  getConversationHistory,
  saveConversationHistory,
} from '../services/conversation-service.js';
import { ensureProject, listWorkspaceFiles } from '../services/workspace-service.js';
import { generateUnifiedLlmStep } from './llm-router.js';
import { buildServerlessSystemPrompt } from './system-prompt.js';
import { createAgentTools } from './tools.js';

const MAX_AGENT_ITERATIONS = 10;

export async function runCodingAgent({
  userRow,
  prompt,
  attachedNotes = [],
  onProgress,
}) {
  const auth = await resolveProviderAuth(userRow);
  if (!auth.isReady) {
    throw new Error(auth.missingReason || 'تنظیمات سرویس هوش مصنوعی کامل نیست.');
  }

  const tgId = userRow.tgId;
  const projectName = userRow.activeProject || 'default';
  await ensureProject(tgId, projectName);

  const githubToken = await resolveGithubToken(userRow);
  const fileManifest = await listWorkspaceFiles(tgId, projectName);

  const tools = createAgentTools();
  const toolMap = new Map(tools.map((t) => [t.declaration.name, t]));
  const declarations = tools.map((t) => t.declaration);

  const systemInstruction = buildServerlessSystemPrompt({
    projectName,
    providerTitle: auth.providerSpec.shortBadge,
    model: auth.model,
    fileManifest,
    githubConfigured: Boolean(githubToken),
  });

  const fullPrompt =
    attachedNotes.length > 0
      ? `${attachedNotes.join('\n')}\n\n${prompt}`
      : prompt;

  const history = await getConversationHistory(tgId, projectName);
  const workingTurns = [...history, { role: 'user', text: fullPrompt }];

  const toolLogs = [];
  const toolCallsExecuted = [];
  const artifacts = [];
  let finalAnswer = '';
  let stepsUsed = 0;
  let lastRoutedVia = null;

  for (let step = 1; step <= MAX_AGENT_ITERATIONS; step += 1) {
    stepsUsed = step;
    if (onProgress) {
      await onProgress({
        step,
        phase: 'thinking',
        providerBadge: auth.providerSpec.shortBadge,
        model: auth.model,
        toolLogs,
      });
    }

    const llmRes = await generateUnifiedLlmStep({
      providerId: auth.providerId,
      baseUrl: auth.baseUrl,
      apiKey: auth.apiKey,
      model: auth.model,
      systemInstruction,
      turns: workingTurns,
      declarations,
    });

    if (llmRes.routedVia) {
      lastRoutedVia = llmRes.routedVia;
    }

    workingTurns.push({
      role: 'assistant',
      text: llmRes.text || '',
      toolCalls: llmRes.toolCalls || [],
      ...(llmRes.rawGeminiParts ? { rawGeminiParts: llmRes.rawGeminiParts } : {}),
    });

    if (!llmRes.toolCalls || llmRes.toolCalls.length === 0) {
      finalAnswer = llmRes.text || '✅ عملیات با موفقیت انجام شد.';
      break;
    }

    const toolResults = [];
    for (const call of llmRes.toolCalls) {
      const toolDef = toolMap.get(call.name);
      const label = toolDef
        ? toolDef.formatProgress(call.args || {})
        : `⚙️ ${call.name}`;
      toolLogs.push(label);

      if (onProgress) {
        await onProgress({
          step,
          phase: 'tool',
          providerBadge: auth.providerSpec.shortBadge,
          model: auth.model,
          currentTool: label,
          toolLogs,
        });
      }

      let resultObj;
      let ok = true;
      if (!toolDef) {
        ok = false;
        resultObj = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          resultObj = await toolDef.execute(call.args || {}, {
            tgId,
            projectName,
            githubToken,
            queueArtifact: (art) => artifacts.push(art),
          });
          if (resultObj && resultObj.error) {
            ok = false;
          }
        } catch (err) {
          ok = false;
          resultObj = { error: String(err?.message ?? err) };
        }
      }

      toolCallsExecuted.push({
        name: call.name,
        args: call.args || {},
        ok,
      });

      toolResults.push({
        id: call.id,
        name: call.name,
        result: resultObj,
      });
    }

    workingTurns.push({
      role: 'tool',
      results: toolResults,
    });

    if (step === MAX_AGENT_ITERATIONS) {
      finalAnswer =
        (llmRes.text ? `${llmRes.text}\n\n` : '') +
        '⚠️ به سقف مراحل ابزار در این نوبت رسیدیم. در صورت نیاز بنویسید «ادامه بده».';
    }
  }

  if (
    lastRoutedVia &&
    lastRoutedVia.includes('set /opencode <key>') &&
    !finalAnswer.includes('/opencode')
  ) {
    finalAnswer +=
      '\n\n💡 _نکته: برای اجرای مستقیم روی سرور OpenCode Zen، کلید رایگان خود را از `opencode.ai/auth` دریافت کرده و با دستور `/opencode YOUR_KEY` ثبت کنید (این درخواست موقتاً روی سرویس رایگان بدون کلید LLM7 اجرا شد)._';
  }

  await saveConversationHistory(tgId, projectName, workingTurns);
  await incrementStats(tgId, toolCallsExecuted.length);

  return {
    replyText: finalAnswer,
    text: finalAnswer,
    stepsUsed,
    toolCallsExecuted,
    toolLogs,
    artifacts,
    projectName,
    providerId: auth.providerId,
    providerBadge: auth.providerSpec.shortBadge,
    model: auth.model,
    routedVia: lastRoutedVia,
  };
}

export const runServerlessCodingAgent = runCodingAgent;
