import {
  incrementStats,
  resolveGeminiApiKey,
  resolveGithubToken,
} from '../services/auth-service.js';
import {
  getConversationHistory,
  saveConversationHistory,
} from '../services/conversation-service.js';
import { ensureProject, listWorkspaceFiles } from '../services/workspace-service.js';
import { generateGeminiStep } from './gemini-service.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createAgentTools } from './tools.js';

const MAX_AGENT_STEPS = 16;

export async function runCodingAgent({
  userRow,
  prompt,
  attachedNotes = [],
  onProgress,
}) {
  const geminiKey = await resolveGeminiApiKey(userRow);
  if (!geminiKey) {
    throw new Error(
      'کلید Google Gemini هنوز ثبت نشده است. ابتدا با دستور زیر کلید خود را ثبت کنید:\n`/setkey AIzaSy...`',
    );
  }

  const githubToken = await resolveGithubToken(userRow);
  const projectName = userRow.activeProject || 'default';
  const model = userRow.model || 'gemini-2.5-pro';

  await ensureProject(userRow.tgId, projectName);
  const filesPreview = await listWorkspaceFiles(userRow.tgId, projectName);

  const systemInstruction = buildSystemPrompt({
    projectName,
    filesPreview: filesPreview.slice(0, 60),
    hasGithubToken: Boolean(githubToken),
  });

  const history = [...(await getConversationHistory(userRow.tgId, projectName))];

  let fullPrompt = String(prompt ?? '').trim();
  if (attachedNotes.length > 0) {
    fullPrompt = `${fullPrompt}\n\n[فایل‌های بارگذاری‌شده در Workspace پروژه:\n${attachedNotes.map((n) => `- ${n}`).join('\n')}]`;
  }

  history.push({
    role: 'user',
    parts: [{ text: fullPrompt }],
  });

  const tools = createAgentTools();
  const toolMap = new Map(tools.map((t) => [t.declaration.name, t]));
  const functionDeclarations = tools.map((t) => t.declaration);

  const artifacts = [];
  const toolCallsExecuted = [];
  const toolContext = {
    tgId: userRow.tgId,
    projectName,
    githubToken,
    queueArtifact: (item) => artifacts.push(item),
  };

  let finalReplyText = '';
  let stepsUsed = 0;

  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    stepsUsed = step;
    if (onProgress) {
      await onProgress({
        step,
        phase: 'thinking',
        label: `تحلیل و کدنویسی با ${model} (گام ${step})...`,
      });
    }

    const response = await generateGeminiStep({
      apiKey: geminiKey,
      model,
      systemInstruction,
      contents: history,
      functionDeclarations,
    });

    const candidate = response?.candidates?.[0];
    const modelContent = candidate?.content;

    if (!modelContent || !Array.isArray(modelContent.parts) || modelContent.parts.length === 0) {
      finalReplyText =
        'مدل پاسخی تولید نکرد. لطفاً درخواست خود را واضح‌تر بفرستید یا `/reset` بزنید.';
      history.push({ role: 'model', parts: [{ text: finalReplyText }] });
      break;
    }

    // Preserve exact modelContent.parts (retains thought & thoughtSignature for Gemini 2.5 / 3)
    history.push({
      role: modelContent.role || 'model',
      parts: modelContent.parts,
    });

    const functionCalls = modelContent.parts
      .map((p) => p.functionCall)
      .filter((fc) => Boolean(fc && fc.name));

    if (functionCalls.length === 0) {
      const textChunks = modelContent.parts
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text);
      finalReplyText = textChunks.join('\n').trim() || 'انجام شد.';
      break;
    }

    const functionResponseParts = [];

    for (const fc of functionCalls) {
      const tool = toolMap.get(fc.name);
      const args = fc.args && typeof fc.args === 'object' ? fc.args : {};

      if (!tool) {
        functionResponseParts.push({
          functionResponse: {
            ...(fc.id ? { id: fc.id } : {}),
            name: fc.name,
            response: { error: `ابزار ناشناخته: ${fc.name}` },
          },
        });
        continue;
      }

      const label = tool.formatProgress(args);
      if (onProgress) {
        await onProgress({ step, phase: 'tool_start', toolName: fc.name, label });
      }

      let payload;
      let ok = true;
      try {
        payload = await tool.execute(args, toolContext);
        if (payload && payload.error) ok = false;
      } catch (err) {
        ok = false;
        payload = { error: err instanceof Error ? err.message : String(err) };
      }

      toolCallsExecuted.push({ name: fc.name, label, ok });

      if (onProgress) {
        await onProgress({
          step,
          phase: ok ? 'tool_done' : 'tool_error',
          toolName: fc.name,
          label,
        });
      }

      functionResponseParts.push({
        functionResponse: {
          ...(fc.id ? { id: fc.id } : {}),
          name: fc.name,
          response: payload,
        },
      });
    }

    history.push({
      role: 'user',
      parts: functionResponseParts,
    });

    if (step === MAX_AGENT_STEPS) {
      finalReplyText =
        '⚠️ سقف گام‌های خودکار این نوبت کامل شد و تمام فایل‌ها در دیتابیس ذخیره شدند. برای ادامه بنویسید: «ادامه بده».';
      history.push({ role: 'model', parts: [{ text: finalReplyText }] });
    }
  }

  await saveConversationHistory(userRow.tgId, projectName, history);
  await incrementStats(userRow.tgId, toolCallsExecuted.length);

  return {
    replyText: finalReplyText,
    projectName,
    modelUsed: model,
    stepsUsed,
    toolCallsExecuted,
    artifacts,
  };
}
