import { fetch } from 'sdk';
import { getProviderSpec } from '../agent/providers.js';
import { recordProviderTestResult, resolveProviderAuth } from './auth-service.js';

function formatPersianHttpError(spec, status, rawBody = '') {
  const snippet = String(rawBody ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (status === 401 || status === 403) {
    return `کلید API نامعتبر یا فاقد دسترسی است (HTTP ${status}). لطفاً کلید سرویس ${spec.shortBadge} را بررسی کنید.`;
  }
  if (status === 404) {
    return `آدرس اندپوینت یا مدل یافت نشد (HTTP 404). آدرس سرور یا نام مدل پیش‌فرض را بررسی کنید.`;
  }
  if (status === 429) {
    return `سقف لحظه‌ای درخواست‌ها پر شده است (HTTP 429 — Rate Limit). کلید معتبر است اما چند ثانیه دیگر تلاش کنید.`;
  }
  if (status >= 500) {
    return `سرور ${spec.shortBadge} موقتاً پاسخگو نیست (HTTP ${status}).`;
  }
  return `خطای سرویس ${spec.shortBadge} (HTTP ${status})${snippet ? `: ${snippet}` : ''}`;
}

/**
 * Sends a lightweight ping request to verify API key / base URL health and measure latency.
 */
export async function testProviderConnection({
  userRow,
  providerId,
  apiKey: draftKey = '',
  baseUrl: draftBaseUrl = '',
  persistResult = true,
}) {
  const spec = getProviderSpec(providerId);
  const storedAuth = await resolveProviderAuth(userRow, spec.id);

  const effectiveKey =
    (typeof draftKey === 'string' && draftKey.trim()) || storedAuth.apiKey || '';
  const effectiveBaseUrl =
    (typeof draftBaseUrl === 'string' && draftBaseUrl.trim()) ||
    storedAuth.baseUrl ||
    spec.defaultBaseUrl ||
    '';

  if (spec.requiresBaseUrl && !effectiveBaseUrl) {
    return {
      success: false,
      latency_ms: 0,
      error: `ابتدا آدرس Base URL سرویس ${spec.shortBadge} را وارد کنید.`,
      providerId: spec.id,
      status: 'disconnected',
    };
  }

  if (spec.requiresKey && !effectiveKey) {
    return {
      success: false,
      latency_ms: 0,
      error: `کلید API برای سرویس ${spec.shortBadge} ثبت نشده است.`,
      providerId: spec.id,
      status: 'disconnected',
    };
  }

  const startedAt = Date.now();
  let success = false;
  let errorMessage = null;

  try {
    if (spec.protocol === 'gemini') {
      const model = spec.defaultModel || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': effectiveKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 4, temperature: 0 },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        errorMessage = formatPersianHttpError(spec, res.status, errBody);
      } else {
        success = true;
      }
    } else if (spec.protocol === 'apifreellm') {
      const res = await fetch('https://apifreellm.com/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          model: spec.defaultModel || 'apifreellm',
          message: 'ping',
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        errorMessage = formatPersianHttpError(spec, res.status, errBody);
      } else {
        success = true;
      }
    } else {
      // OpenAI-compatible providers (OpenCode Zen, FreeLLMAPI, LLM7, Pollinations, OpenRouter, Groq, Custom)
      const cleanBase = effectiveBaseUrl.replace(/\/+$/, '');
      const chatPath = spec.chatPath || '/chat/completions';
      const endpointUrl = cleanBase.endsWith(chatPath)
        ? cleanBase
        : `${cleanBase}${chatPath}`;
      const authHeaderKey = effectiveKey || spec.defaultPlaceholderKey || '';

      const headers = {
        'Content-Type': 'application/json',
      };
      if (authHeaderKey) {
        headers.Authorization = `Bearer ${authHeaderKey}`;
      }
      if (spec.id === 'openrouter') {
        headers['HTTP-Referer'] = 'https://core.telegram.org/bots/serverless';
        headers['X-Title'] = 'Ahwaz Telegram Coding Agent';
      }

      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: spec.defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
          temperature: 0,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        errorMessage = formatPersianHttpError(spec, res.status, errBody);
      } else {
        success = true;
      }
    }
  } catch (err) {
    errorMessage = `عدم برقراری ارتباط شبکه‌ای با ${spec.shortBadge}: ${String(err?.message ?? err).slice(0, 120)}`;
  }

  const latencyMs = Math.max(1, Date.now() - startedAt);

  // Persist test diagnostics when testing saved/keyless credentials
  const isDraftOnly =
    Boolean(draftKey && draftKey.trim() && draftKey.trim() !== storedAuth.apiKey) ||
    Boolean(draftBaseUrl && draftBaseUrl.trim() && draftBaseUrl.trim() !== storedAuth.baseUrl);

  if (persistResult && !isDraftOnly && userRow?.tgId) {
    await recordProviderTestResult(userRow.tgId, spec.id, {
      success,
      latencyMs,
      error: errorMessage,
      baseUrl: effectiveBaseUrl || null,
    });
  }

  return {
    success,
    latency_ms: latencyMs,
    error: errorMessage,
    providerId: spec.id,
    status: success ? 'connected' : 'invalid',
  };
}
