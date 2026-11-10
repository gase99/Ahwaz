import { fetch } from 'sdk';

/**
 * Built-in catalog of supported AI & Free LLM API Providers for Ahwaz Coding Agent.
 */
export const PROVIDERS = {
  opencode: {
    id: 'opencode',
    title: 'OpenCode Zen (مدل‌های رایگان OpenCode)',
    shortBadge: '🆓 OpenCode Zen',
    protocol: 'openai',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false, // Works with free opencode.ai/auth key; falls back to 'public' token if unset
    defaultPlaceholderKey: 'public',
    defaultModel: 'big-pickle',
    signupHint: 'دریافت کلید رایگان بدون کارت بانکی از https://opencode.ai/auth',
    models: [
      { id: 'big-pickle', label: '🆓 Big Pickle (پرچمدار رایگان کدنویسی OpenCode)' },
      { id: 'deepseek-v4.1-flash-free', label: '🆓 DeepSeek V4.1 Flash Free' },
      { id: 'deepseek-v4-flash-free', label: '🆓 DeepSeek V4 Flash Free' },
      { id: 'glm-5.3-flash-free', label: '🆓 GLM 5.3 Flash Free' },
      { id: 'mimo-v2.6-flash-free', label: '🆓 MiMo V2.6 Flash Free' },
      { id: 'nemotron-3-ultra-free', label: '🆓 Nemotron 3 Ultra Free' },
      { id: 'nemotron-3.5-lightning-free', label: '🆓 Nemotron 3.5 Lightning Free' },
      { id: 'minimax-m2.5-free', label: '🆓 MiniMax M2.5 Free' },
    ],
  },

  freellmapi: {
    id: 'freellmapi',
    title: 'FreeLLMAPI Router (تجمیع‌کننده ۳۴ سرویس رایگان)',
    shortBadge: '🔀 FreeLLMAPI',
    protocol: 'openai',
    defaultBaseUrl: '',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    requiresBaseUrl: true,
    defaultModel: 'auto',
    signupHint: 'آدرس سرور روتر FreeLLMAPI (/v1) و کلید یکپارچه freellmapi-... خود را وارد کنید',
    models: [
      { id: 'auto', label: '🔀 Auto (انتخاب خودکار بهترین مدل آزاد)' },
      { id: 'auto:smart', label: '🧠 Auto Smart (قوی‌ترین مدل کدنویسی)' },
      { id: 'auto:fast', label: '⚡ Auto Fast (سریع‌ترین پاسخ)' },
    ],
  },

  apifreellm: {
    id: 'apifreellm',
    title: 'ApiFreeLLM.com (سرویس رایگان ApiFreeLLM)',
    shortBadge: '🆓 ApiFreeLLM',
    protocol: 'apifreellm',
    defaultBaseUrl: 'https://apifreellm.com/api/v1/chat',
    requiresKey: true,
    defaultModel: 'apifreellm',
    signupHint: 'دریافت کلید رایگان با اکانت گوگل از https://apifreellm.com/en/api-access',
    models: [{ id: 'apifreellm', label: '🆓 ApiFreeLLM Default (رایگان بدون محدودیت توکن)' }],
  },

  llm7: {
    id: 'llm7',
    title: 'LLM7.io Free API (رایگان و بدون نیاز به کلید!)',
    shortBadge: '⚡ LLM7 (Keyless)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.llm7.io/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'default',
    signupHint: 'بدون نیاز به ثبت‌نام یا کلید کار می‌کند (برای سقف بالاتر: dash.llm7.io)',
    models: [
      { id: 'default', label: '⚡ LLM7 Auto Default (رایگان بدون کلید)' },
      { id: 'gpt-oss', label: '🆓 GPT-OSS Coding (رایگان بدون کلید)' },
      { id: 'fast', label: '🚀 LLM7 Fast (پاسخ سریع)' },
    ],
  },

  pollinations: {
    id: 'pollinations',
    title: 'Pollinations Free AI (رایگان بدون کلید)',
    shortBadge: '🌸 Pollinations',
    protocol: 'openai',
    defaultBaseUrl: 'https://text.pollinations.ai',
    chatPath: '/openai',
    requiresKey: false,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'openai',
    signupHint: 'کاملاً رایگان و بدون نیاز به کلید API',
    models: [{ id: 'openai', label: '🆓 Pollinations GPT-OSS (رایگان بدون کلید)' }],
  },

  openrouter: {
    id: 'openrouter',
    title: 'OpenRouter Free Models (مدل‌های :free)',
    shortBadge: '🌐 OpenRouter Free',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    defaultModel: 'qwen/qwen3-coder:free',
    signupHint: 'دریافت کلید رایگان از https://openrouter.ai/keys',
    models: [
      { id: 'qwen/qwen3-coder:free', label: '🆓 Qwen3 Coder (:free)' },
      { id: 'deepseek/deepseek-chat:free', label: '🆓 DeepSeek Chat (:free)' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: '🆓 Llama 3.3 70B (:free)' },
    ],
  },

  groq: {
    id: 'groq',
    title: 'Groq Free LPU API (فوق‌سریع و رایگان)',
    shortBadge: '⚡ Groq Free',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    signupHint: 'دریافت کلید رایگان از https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile', label: '⚡ Llama 3.3 70B Versatile' },
      { id: 'qwen-qwq-32b', label: '🧠 Qwen QwQ 32B Coding' },
    ],
  },

  gemini: {
    id: 'gemini',
    title: 'Google Gemini (AI Studio)',
    shortBadge: '✨ Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
    defaultModel: 'gemini-2.5-pro',
    signupHint: 'دریافت کلید رایگان از https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-pro', label: '✨ Gemini 2.5 Pro (معماری و دیباگ عمیق)' },
      { id: 'gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash (سریع و رایگان در AI Studio)' },
      { id: 'gemini-2.0-flash', label: '🚀 Gemini 2.0 Flash' },
    ],
  },

  custom: {
    id: 'custom',
    title: 'Custom Free OpenAI-Compatible API',
    shortBadge: '🔧 Custom API',
    protocol: 'openai',
    defaultBaseUrl: '',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false,
    requiresBaseUrl: true,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'auto',
    signupHint: 'اتصال به هر سرویس سازگار با OpenAI (/setcustom <baseUrl> <key> [model])',
    models: [{ id: 'auto', label: '🔧 مدل پیش‌فرض سرویس اختصاصی' }],
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export function getProviderSpec(providerId) {
  return PROVIDERS[providerId] || PROVIDERS.opencode;
}

/**
 * Detects provider automatically from common API key prefixes when user runs `/setkey <key>`.
 */
export function inferProviderFromApiKey(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('freellmapi-')) return 'freellmapi';
  if (key.startsWith('apf_') || key.startsWith('apifreellm')) return 'apifreellm';
  return 'opencode';
}

/**
 * Dynamically fetches currently active free models from OpenCode Zen's live catalog
 * (`GET https://opencode.ai/zen/v1/models`).
 */
export async function fetchLiveOpenCodeFreeModels(apiKey = '') {
  const headers = { Accept: 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch('https://opencode.ai/zen/v1/models', { headers });
  if (!res.ok) {
    throw new Error(`عدم دریافت لیست زنده مدل‌های OpenCode (کد ${res.status})`);
  }

  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];

  const freeModels = list
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
    .filter(
      (id) =>
        id === 'big-pickle' ||
        id.endsWith('-free') ||
        id.includes(':free') ||
        id === 'gpt-5-nano' ||
        id === 'grok-code',
    );

  // Merge with built-in defaults if catalog omits labels
  const uniqueIds = Array.from(
    new Set([...freeModels, ...PROVIDERS.opencode.models.map((m) => m.id)]),
  );

  return uniqueIds.slice(0, 18).map((id) => ({
    id,
    label: `🆓 ${id}`,
  }));
}
