import { fetch } from 'sdk';
import { getProviderSpec } from './providers.js';

function lowercaseSchemaTypes(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const copy = { ...schema };
  if (typeof copy.type === 'string') {
    copy.type = copy.type.toLowerCase();
  }
  if (copy.properties && typeof copy.properties === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(copy.properties)) {
      props[k] = lowercaseSchemaTypes(v);
    }
    copy.properties = props;
  }
  if (copy.items && typeof copy.items === 'object') {
    copy.items = lowercaseSchemaTypes(copy.items);
  }
  return copy;
}

export function toOpenAiTools(declarations) {
  return declarations.map((decl) => ({
    type: 'function',
    function: {
      name: decl.name,
      description: decl.description || '',
      parameters: lowercaseSchemaTypes(
        decl.parameters || { type: 'object', properties: {} },
      ),
    },
  }));
}

export function buildReActToolsPromptBlock(declarations) {
  const specs = declarations.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: lowercaseSchemaTypes(d.parameters || { type: 'object', properties: {} }),
  }));

  return `
## Tool-Calling Protocol
When you need to inspect, create, edit, test, or export workspace files, emit one or more XML tool blocks in this EXACT format (valid JSON inside <tool_call>):
<tool_call>
{"name": "write_file", "args": {"file_path": "index.js", "content": "console.log('hi');"}}
</tool_call>
Wait for the <tool_result> response before giving your final explanation. When no more tools are needed, write your final answer directly WITHOUT <tool_call> tags.

Available Tools:
${JSON.stringify(specs)}
`.trim();
}

export function parseInlineToolCalls(rawText) {
  const text = String(rawText ?? '');
  const toolCalls = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;

  let idx = 0;
  const stripped = text.replace(regex, (_full, inner) => {
    const cleanedJson = String(inner)
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      const parsed = JSON.parse(cleanedJson);
      if (parsed && typeof parsed.name === 'string') {
        let resolvedArgs = {};
        if (parsed.args && typeof parsed.args === 'object') {
          resolvedArgs = parsed.args;
        } else if (parsed.arguments && typeof parsed.arguments === 'object') {
          resolvedArgs = parsed.arguments;
        } else if (typeof parsed.arguments === 'string') {
          try {
            const innerArgs = JSON.parse(parsed.arguments);
            if (innerArgs && typeof innerArgs === 'object') resolvedArgs = innerArgs;
          } catch {
            resolvedArgs = {};
          }
        }
        toolCalls.push({
          id: `react_call_${Date.now()}_${idx++}`,
          name: parsed.name,
          args: resolvedArgs,
        });
      }
    } catch {
      // Ignore malformed block
    }
    return '';
  });

  return {
    cleanText: stripped.trim(),
    toolCalls,
  };
}

/**
 * Upgrades any legacy Gemini `parts`-based history entries into the unified normalized format.
 */
export function normalizeHistoryTurns(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];

  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;

    // Already normalized
    if (
      (item.role === 'user' && typeof item.text === 'string') ||
      item.role === 'assistant' ||
      item.role === 'tool'
    ) {
      out.push(item);
      continue;
    }

    // Legacy Gemini `{ role: 'user' | 'model', parts: [...] }`
    if (Array.isArray(item.parts)) {
      const fnResponses = item.parts.filter((p) => p.functionResponse);
      if (fnResponses.length > 0) {
        out.push({
          role: 'tool',
          results: fnResponses.map((p, i) => ({
            id: p.functionResponse.id || `legacy_${i}`,
            name: p.functionResponse.name,
            result: p.functionResponse.response,
          })),
        });
        continue;
      }

      if (item.role === 'user') {
        const text = item.parts
          .map((p) => p.text)
          .filter(Boolean)
          .join('\n');
        out.push({ role: 'user', text });
        continue;
      }

      if (item.role === 'model') {
        const text = item.parts
          .filter((p) => !p.thought && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n');
        const toolCalls = item.parts
          .filter((p) => p.functionCall?.name)
          .map((p, i) => ({
            id: p.functionCall.id || `legacy_fc_${i}`,
            name: p.functionCall.name,
            args: p.functionCall.args || {},
          }));
        out.push({
          role: 'assistant',
          text,
          toolCalls,
          rawGeminiParts: item.parts,
        });
      }
    }
  }

  return out;
}

function toGeminiContents(turns) {
  return turns.map((turn) => {
    if (turn.role === 'user') {
      return { role: 'user', parts: [{ text: turn.text || '' }] };
    }
    if (turn.role === 'assistant') {
      if (Array.isArray(turn.rawGeminiParts) && turn.rawGeminiParts.length > 0) {
        return { role: 'model', parts: turn.rawGeminiParts };
      }
      const parts = [];
      if (turn.text) parts.push({ text: turn.text });
      for (const tc of turn.toolCalls || []) {
        parts.push({
          functionCall: {
            ...(tc.id ? { id: tc.id } : {}),
            name: tc.name,
            args: tc.args || {},
          },
        });
      }
      return { role: 'model', parts: parts.length ? parts : [{ text: '...' }] };
    }
    // role === 'tool'
    return {
      role: 'user',
      parts: (turn.results || []).map((r) => ({
        functionResponse: {
          ...(r.id ? { id: r.id } : {}),
          name: r.name,
          response: r.result,
        },
      })),
    };
  });
}

function toOpenAiMessages(systemInstruction, turns, usePromptToolsMode = false, declarations = []) {
  const sysContent = usePromptToolsMode
    ? `${systemInstruction}\n\n${buildReActToolsPromptBlock(declarations)}`
    : systemInstruction;

  const messages = [{ role: 'system', content: sysContent }];

  for (const turn of turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.text || '' });
    } else if (turn.role === 'assistant') {
      const tcs = turn.toolCalls || [];
      if (!usePromptToolsMode && tcs.length > 0) {
        messages.push({
          role: 'assistant',
          content: turn.text || null,
          tool_calls: tcs.map((tc, i) => ({
            id: tc.id || `call_${i}`,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args || {}),
            },
          })),
        });
      } else if (usePromptToolsMode && tcs.length > 0) {
        const serializedCalls = tcs
          .map((tc) => `<tool_call>${JSON.stringify({ name: tc.name, args: tc.args || {} })}</tool_call>`)
          .join('\n');
        messages.push({
          role: 'assistant',
          content: [turn.text, serializedCalls].filter(Boolean).join('\n'),
        });
      } else {
        messages.push({ role: 'assistant', content: turn.text || '' });
      }
    } else if (turn.role === 'tool') {
      if (!usePromptToolsMode) {
        for (const r of turn.results || []) {
          messages.push({
            role: 'tool',
            tool_call_id: r.id || r.name,
            name: r.name,
            content: JSON.stringify(r.result),
          });
        }
      } else {
        const summary = (turn.results || [])
          .map((r) => `<tool_result name="${r.name}">${JSON.stringify(r.result)}</tool_result>`)
          .join('\n');
        messages.push({ role: 'user', content: summary });
      }
    }
  }

  return messages;
}

async function callGeminiNative({ apiKey, model, systemInstruction, turns, declarations }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: toGeminiContents(turns),
    generationConfig: { temperature: 0.2 },
  };
  if (declarations.length > 0) {
    body.tools = [{ functionDeclarations: declarations }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`خطای Google Gemini (${res.status}): ${errTxt.slice(0, 240)}`);
  }

  const json = await res.json();
  if (!json?.candidates?.length && json?.promptFeedback?.blockReason) {
    throw new Error(
      `پاسخ Google Gemini به دلیل محدودیت ایمنی مسدود شد (${json.promptFeedback.blockReason}).`,
    );
  }
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();

  const toolCalls = parts
    .filter((p) => p.functionCall?.name)
    .map((p, idx) => ({
      id: p.functionCall.id || `gem_call_${Date.now()}_${idx}`,
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));

  return {
    text,
    toolCalls,
    rawGeminiParts: parts,
  };
}

async function callOpenAiCompatible({
  providerSpec,
  baseUrl,
  apiKey,
  model,
  systemInstruction,
  turns,
  declarations,
  forcePromptTools = false,
}) {
  const cleanBase = String(baseUrl || providerSpec.defaultBaseUrl || '').replace(/\/+$/, '');
  if (!cleanBase) {
    throw new Error(`آدرس Base URL برای سرویس ${providerSpec.title} تنظیم نشده است.`);
  }

  const chatPath = providerSpec.chatPath || '/chat/completions';
  const endpointUrl = cleanBase.endsWith(chatPath) ? cleanBase : `${cleanBase}${chatPath}`;

  const effectiveKey =
    (apiKey && apiKey.trim()) || providerSpec.defaultPlaceholderKey || '';

  const headers = {
    'Content-Type': 'application/json',
  };
  if (effectiveKey) {
    headers.Authorization = `Bearer ${effectiveKey}`;
  }
  if (providerSpec.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://core.telegram.org/bots/serverless';
    headers['X-Title'] = 'Ahwaz Telegram Coding Agent';
  }

  const sendPayload = async (usePromptMode) => {
    const payload = {
      model,
      messages: toOpenAiMessages(systemInstruction, turns, usePromptMode, declarations),
      temperature: 0.2,
    };
    if (!usePromptMode && declarations.length > 0) {
      payload.tools = toOpenAiTools(declarations);
      payload.tool_choice = 'auto';
    }
    return await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  };

  let usedPromptMode = forcePromptTools;
  let res = await sendPayload(usedPromptMode);

  // Automatic fallback: if a free model rejects native `tools` (HTTP 400/404/422), retry with ReAct XML tool protocol!
  if (!res.ok && !usedPromptMode && [400, 404, 422, 501].includes(res.status)) {
    const firstErrText = await res.text();
    const looksLikeToolUnsupported =
      /tool|function|schema|unsupported|unrecognized|not support/i.test(firstErrText);
    if (looksLikeToolUnsupported) {
      usedPromptMode = true;
      res = await sendPayload(true);
    } else {
      throw new Error(
        `خطای سرویس ${providerSpec.shortBadge} (${res.status}): ${firstErrText.slice(0, 240)}`,
      );
    }
  }

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(
      `خطای سرویس ${providerSpec.shortBadge} (${res.status}): ${errTxt.slice(0, 240)}`,
    );
  }

  const routedVia = res.headers?.get?.('x-routed-via') || undefined;
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};

  // Extract native OpenAI tool_calls if returned
  const nativeCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls
        .filter((tc) => tc?.function?.name)
        .map((tc, i) => {
          let parsedArgs = {};
          try {
            parsedArgs =
              typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments || '{}')
                : tc.function.arguments || {};
          } catch {
            parsedArgs = {};
          }
          return {
            id: tc.id || `oai_call_${Date.now()}_${i}`,
            name: tc.function.name,
            args: parsedArgs,
          };
        })
    : [];

  const rawContent =
    typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((part) => part && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
        : '';
  if (nativeCalls.length > 0) {
    return {
      text: rawContent.trim(),
      toolCalls: nativeCalls,
      routedVia,
    };
  }

  // Also check for ReAct `<tool_call>` blocks in text content
  const { cleanText, toolCalls: inlineCalls } = parseInlineToolCalls(rawContent);
  return {
    text: cleanText,
    toolCalls: inlineCalls,
    routedVia,
  };
}

async function callApiFreeLlmRest({ apiKey, model, systemInstruction, turns, declarations }) {
  const transcriptLines = [
    systemInstruction,
    '',
    buildReActToolsPromptBlock(declarations),
    '',
    '=== Conversation Transcript ===',
  ];

  for (const turn of turns.slice(-14)) {
    if (turn.role === 'user') {
      transcriptLines.push(`USER:\n${turn.text}`);
    } else if (turn.role === 'assistant') {
      const tcText = (turn.toolCalls || [])
        .map((tc) => `<tool_call>${JSON.stringify({ name: tc.name, args: tc.args || {} })}</tool_call>`)
        .join('\n');
      transcriptLines.push(`ASSISTANT:\n${[turn.text, tcText].filter(Boolean).join('\n')}`);
    } else if (turn.role === 'tool') {
      const trText = (turn.results || [])
        .map((r) => `<tool_result name="${r.name}">${JSON.stringify(r.result)}</tool_result>`)
        .join('\n');
      transcriptLines.push(`TOOL_RESULTS:\n${trText}`);
    }
  }

  transcriptLines.push('\nRespond as ASSISTANT now:');

  const res = await fetch('https://apifreellm.com/api/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'apifreellm',
      message: transcriptLines.join('\n\n'),
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`خطای ApiFreeLLM (${res.status}): ${errTxt.slice(0, 220)}`);
  }

  const data = await res.json();
  const replyRaw = String(data?.response ?? data?.message ?? '');
  const { cleanText, toolCalls } = parseInlineToolCalls(replyRaw);

  return {
    text: cleanText,
    toolCalls,
  };
}

/**
 * Unified multi-provider entry point with automatic keyless fallback on rate-limit if using keyless free providers.
 */
export async function generateUnifiedLlmStep({
  providerId,
  baseUrl,
  apiKey,
  model,
  systemInstruction,
  turns,
  declarations,
}) {
  const providerSpec = getProviderSpec(providerId);

  if (providerSpec.protocol === 'gemini') {
    return await callGeminiNative({
      apiKey,
      model,
      systemInstruction,
      turns,
      declarations,
    });
  }

  if (providerSpec.protocol === 'apifreellm') {
    return await callApiFreeLlmRest({
      apiKey,
      model,
      systemInstruction,
      turns,
      declarations,
    });
  }

  try {
    return await callOpenAiCompatible({
      providerSpec,
      baseUrl,
      apiKey,
      model,
      systemInstruction,
      turns,
      declarations,
    });
  } catch (err) {
    const msg = String(err?.message ?? err);
    // If OpenCode Zen is invoked before user sets their free opencode.ai/auth key and returns 401/403,
    // seamlessly run on keyless LLM7 so first-time users never hit a dead end!
    if (providerSpec.id === 'opencode' && !apiKey && /\b(401|403)\b|auth/i.test(msg)) {
      const llm7Spec = getProviderSpec('llm7');
      const fb = await callOpenAiCompatible({
        providerSpec: llm7Spec,
        baseUrl: llm7Spec.defaultBaseUrl,
        apiKey: '',
        model: llm7Spec.defaultModel,
        systemInstruction,
        turns,
        declarations,
      });
      return { ...fb, routedVia: 'llm7 (fallback - set /opencode <key> for direct Zen)' };
    }

    // Keyless resilience: if anonymous `llm7` hits temporary 429/5xx, fail over to keyless `pollinations`!
    if (providerSpec.id === 'llm7' && (!apiKey || apiKey === 'unused')) {
      const fallbackSpec = getProviderSpec('pollinations');
      const fb = await callOpenAiCompatible({
        providerSpec: fallbackSpec,
        baseUrl: fallbackSpec.defaultBaseUrl,
        apiKey: '',
        model: fallbackSpec.defaultModel,
        systemInstruction,
        turns,
        declarations,
      });
      return { ...fb, routedVia: 'pollinations (keyless failover)' };
    }
    throw err;
  }
}
