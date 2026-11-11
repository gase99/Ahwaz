import { fetch } from 'sdk';

/**
 * Built-in catalog of supported AI & Free LLM API Providers for Ahwaz Coding Agent.
 */
export const PROVIDERS = {
  opencode: {
    id: 'opencode',
    logo: '🆓',
    title: 'OpenCode Zen (مدل‌های رایگان OpenCode)',
    shortBadge: '🆓 OpenCode Zen',
    protocol: 'openai',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false, // Works with free opencode.ai/auth key; falls back to 'public' token if unset
    acceptsOptionalKey: true,
    defaultPlaceholderKey: 'public',
    defaultModel: 'big-pickle',
    signupUrl: 'https://opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs',
    signupHint: 'دریافت کلید رایگان بدون کارت بانکی از https://opencode.ai/auth',
    models: [
      {
        id: 'big-pickle',
        label: '🆓⭐ Big Pickle (پرچمدار رایگان کدنویسی OpenCode)',
        free: true,
        recommended: true,
        tier: 'smart',
      },
      {
        id: 'deepseek-v4.1-flash-free',
        label: '🆓⚡ DeepSeek V4.1 Flash Free',
        free: true,
        tier: 'fast',
      },
      {
        id: 'deepseek-v4-flash-free',
        label: '🆓⚡ DeepSeek V4 Flash Free',
        free: true,
        tier: 'fast',
      },
      {
        id: 'glm-5.3-flash-free',
        label: '🆓⚡ GLM 5.3 Flash Free',
        free: true,
        tier: 'fast',
      },
      {
        id: 'mimo-v2.6-flash-free',
        label: '🆓⚡ MiMo V2.6 Flash Free',
        free: true,
        tier: 'fast',
      },
      {
        id: 'nemotron-3-ultra-free',
        label: '🆓🧠 Nemotron 3 Ultra Free',
        free: true,
        tier: 'smart',
      },
      {
        id: 'nemotron-3.5-lightning-free',
        label: '🆓⚡ Nemotron 3.5 Lightning Free',
        free: true,
        tier: 'fast',
      },
      {
        id: 'minimax-m2.5-free',
        label: '🆓🧠 MiniMax M2.5 Free',
        free: true,
        tier: 'smart',
      },
    ],
  },

  gemini: {
    id: 'gemini',
    logo: '✨',
    title: 'Google Gemini (AI Studio)',
    shortBadge: '✨ Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
    defaultModel: 'gemini-2.5-pro',
    signupUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    signupHint: 'دریافت کلید رایگان از https://aistudio.google.com/apikey',
    models: [
      {
        id: 'gemini-2.5-pro',
        label: '🧠🆓 Gemini 2.5 Pro (معماری و دیباگ عمیق)',
        free: true,
        recommended: true,
        tier: 'smart',
      },
      {
        id: 'gemini-2.5-flash',
        label: '⚡🆓 Gemini 2.5 Flash (سریع و رایگان در AI Studio)',
        free: true,
        tier: 'fast',
      },
      {
        id: 'gemini-2.0-flash',
        label: '⚡🆓 Gemini 2.0 Flash',
        free: true,
        tier: 'fast',
      },
    ],
  },

  openrouter: {
    id: 'openrouter',
    logo: '🌐',
    title: 'OpenRouter Free Models (مدل‌های :free)',
    shortBadge: '🌐 OpenRouter Free',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    defaultModel: 'qwen/qwen3-coder:free',
    signupUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    signupHint: 'دریافت کلید رایگان از https://openrouter.ai/keys',
    models: [
      {
        id: 'qwen/qwen3-coder:free',
        label: '🆓🧠 Qwen3 Coder (:free)',
        free: true,
        recommended: true,
        tier: 'smart',
      },
      {
        id: 'deepseek/deepseek-chat:free',
        label: '🆓🧠 DeepSeek Chat (:free)',
        free: true,
        tier: 'smart',
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        label: '🆓⚡ Llama 3.3 70B (:free)',
        free: true,
        tier: 'fast',
      },
    ],
  },

  groq: {
    id: 'groq',
    logo: '⚡',
    title: 'Groq Free LPU API (فوق‌سریع و رایگان)',
    shortBadge: '⚡ Groq Free',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    signupUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    signupHint: 'دریافت کلید رایگان از https://console.groq.com/keys',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: '⚡🆓 Llama 3.3 70B Versatile',
        free: true,
        recommended: true,
        tier: 'fast',
      },
      {
        id: 'qwen-qwq-32b',
        label: '🧠🆓 Qwen QwQ 32B Coding',
        free: true,
        tier: 'smart',
      },
    ],
  },

  freellmapi: {
    id: 'freellmapi',
    logo: '🔀',
    title: 'FreeLLMAPI Router (تجمیع‌کننده ۳۴ سرویس رایگان)',
    shortBadge: '🔀 FreeLLMAPI',
    protocol: 'openai',
    defaultBaseUrl: '',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: true,
    requiresBaseUrl: true,
    defaultModel: 'auto',
    signupUrl: 'https://github.com/search?q=freellmapi&type=repositories',
    docsUrl: 'https://github.com/search?q=freellmapi&type=repositories',
    signupHint: 'آدرس سرور روتر FreeLLMAPI (/v1) و کلید یکپارچه freellmapi-... خود را وارد کنید',
    models: [
      {
        id: 'auto',
        label: '🆓⭐ Auto (انتخاب خودکار بهترین مدل آزاد)',
        free: true,
        recommended: true,
        tier: 'smart',
      },
      {
        id: 'auto:smart',
        label: '🧠🆓 Auto Smart (قوی‌ترین مدل کدنویسی)',
        free: true,
        tier: 'smart',
      },
      {
        id: 'auto:fast',
        label: '⚡🆓 Auto Fast (سریع‌ترین پاسخ)',
        free: true,
        tier: 'fast',
      },
    ],
  },

  apifreellm: {
    id: 'apifreellm',
    logo: '🆓',
    title: 'ApiFreeLLM.com (سرویس رایگان ApiFreeLLM)',
    shortBadge: '🆓 ApiFreeLLM',
    protocol: 'apifreellm',
    defaultBaseUrl: 'https://apifreellm.com/api/v1/chat',
    requiresKey: true,
    defaultModel: 'apifreellm',
    signupUrl: 'https://apifreellm.com/en/api-access',
    docsUrl: 'https://apifreellm.com/docs',
    signupHint: 'دریافت کلید رایگان با اکانت گوگل از https://apifreellm.com/en/api-access',
    models: [
      {
        id: 'apifreellm',
        label: '🆓 ApiFreeLLM Default (رایگان بدون محدودیت توکن)',
        free: true,
        recommended: true,
        tier: 'fast',
      },
    ],
  },

  llm7: {
    id: 'llm7',
    logo: '⚡',
    title: 'LLM7.io Free API (رایگان و بدون نیاز به کلید!)',
    shortBadge: '⚡ LLM7 (Keyless)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.llm7.io/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false,
    acceptsOptionalKey: true,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'default',
    signupUrl: 'https://dash.llm7.io',
    docsUrl: 'https://api.llm7.io',
    signupHint: 'بدون نیاز به ثبت‌نام یا کلید کار می‌کند (برای سقف بالاتر: dash.llm7.io)',
    models: [
      {
        id: 'default',
        label: '🆓⭐ LLM7 Auto Default (رایگان بدون کلید)',
        free: true,
        recommended: true,
        tier: 'smart',
      },
      {
        id: 'gpt-oss',
        label: '🆓🧠 GPT-OSS Coding (رایگان بدون کلید)',
        free: true,
        tier: 'smart',
      },
      {
        id: 'fast',
        label: '⚡🆓 LLM7 Fast (پاسخ سریع)',
        free: true,
        tier: 'fast',
      },
    ],
  },

  pollinations: {
    id: 'pollinations',
    logo: '🌸',
    title: 'Pollinations Free AI (رایگان بدون کلید)',
    shortBadge: '🌸 Pollinations',
    protocol: 'openai',
    defaultBaseUrl: 'https://text.pollinations.ai',
    chatPath: '/openai',
    requiresKey: false,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'openai',
    signupUrl: null,
    docsUrl: 'https://text.pollinations.ai',
    signupHint: 'کاملاً رایگان و بدون نیاز به کلید API',
    models: [
      {
        id: 'openai',
        label: '🆓⚡ Pollinations GPT-OSS (رایگان بدون کلید)',
        free: true,
        recommended: true,
        tier: 'fast',
      },
    ],
  },

  custom: {
    id: 'custom',
    logo: '🔧',
    title: 'Custom Free OpenAI-Compatible API',
    shortBadge: '🔧 Custom API',
    protocol: 'openai',
    defaultBaseUrl: '',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    requiresKey: false,
    acceptsOptionalKey: true,
    requiresBaseUrl: true,
    defaultPlaceholderKey: 'unused',
    defaultModel: 'auto',
    signupUrl: null,
    docsUrl: null,
    signupHint: 'اتصال به هر سرویس سازگار با OpenAI (/setcustom <baseUrl> <key> [model])',
    models: [
      {
        id: 'auto',
        label: '🔧💰 مدل پیش‌فرض سرویس اختصاصی (OpenAI-Compatible)',
        free: false,
        tier: 'smart',
      },
    ],
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

/**
 * جدول لینک‌های کاربردی هر سرویس (بخش ۱.۳ مینی‌اپ).
 */
export const PROVIDER_LINKS_TABLE = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    signupUrl: 'https://aistudio.google.com/apikey',
    signupLabel: 'aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    docsLabel: 'ai.google.dev/docs',
    requiresCard: '❌',
    freeModels: 'gemini-2.5-flash, gemini-2.0-flash',
  },
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    signupUrl: 'https://opencode.ai/auth',
    signupLabel: 'opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs',
    docsLabel: 'opencode.ai/docs',
    requiresCard: '❌',
    freeModels: 'big-pickle, deepseek-v4.1-flash-free, glm-5.3-flash-free',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    signupUrl: 'https://openrouter.ai/keys',
    signupLabel: 'openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    docsLabel: 'openrouter.ai/docs',
    requiresCard: '❌',
    freeModels: 'مدل‌های :free (مثل qwen3-coder:free)',
  },
  {
    id: 'groq',
    name: 'Groq',
    signupUrl: 'https://console.groq.com/keys',
    signupLabel: 'console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    docsLabel: 'console.groq.com/docs',
    requiresCard: '❌',
    freeModels: 'llama-3.3-70b-versatile, qwen-qwq-32b',
  },
  {
    id: 'freellmapi',
    name: 'FreeLLMAPI',
    signupUrl: 'https://github.com/search?q=freellmapi&type=repositories',
    signupLabel: 'گیت‌هاب روتر',
    docsUrl: 'https://github.com/search?q=freellmapi&type=repositories',
    docsLabel: 'مستندات روتر',
    requiresCard: '❌',
    freeModels: 'auto, auto:smart, auto:fast',
  },
  {
    id: 'apifreellm',
    name: 'ApiFreeLLM',
    signupUrl: 'https://apifreellm.com/en/api-access',
    signupLabel: 'apifreellm.com',
    docsUrl: 'https://apifreellm.com/docs',
    docsLabel: 'apifreellm.com/docs',
    requiresCard: '❌',
    freeModels: 'مدل پیش‌فرض سایت (apifreellm)',
  },
  {
    id: 'llm7',
    name: 'LLM7',
    signupUrl: null,
    signupLabel: 'بدون کلید (dash.llm7.io اختیاری)',
    docsUrl: 'https://api.llm7.io',
    docsLabel: 'api.llm7.io',
    requiresCard: '❌',
    freeModels: 'بدون کلید (default, gpt-oss, fast)',
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    signupUrl: null,
    signupLabel: 'بدون کلید',
    docsUrl: 'https://text.pollinations.ai',
    docsLabel: 'text.pollinations.ai',
    requiresCard: '❌',
    freeModels: 'بدون کلید (openai)',
  },
  {
    id: 'custom',
    name: 'Custom',
    signupUrl: null,
    signupLabel: '(دلخواه)',
    docsUrl: null,
    docsLabel: '-',
    requiresCard: '-',
    freeModels: 'هر مدل سازگار با OpenAI',
  },
];

/**
 * راهنمای کامل و ساختاریافته اتصال هر سرویس (برای آکاردئون کارت‌ها، تب راهنما و دستور /guide).
 */
export const PROVIDER_HELP = {
  opencode: {
    id: 'opencode',
    title: 'OpenCode Zen — مدل‌های رایگان کدنویسی',
    summary: 'مدل‌های رایگان کدنویسی OpenCode Zen (مثل big-pickle) بدون نیاز به کارت بانکی.',
    keyless: true,
    steps: [
      'به https://opencode.ai/auth بروید.',
      'با حساب GitHub یا Google وارد شوید (نیازی به کارت بانکی نیست).',
      'در داشبورد، دکمه "Create API Key" را بزنید.',
      'کلید را کپی کنید و در فیلد کلید بالا Paste کنید (یا در چت `/opencode KEY` بزنید).',
      'دکمه «تست اتصال» و سپس «ذخیره» را بزنید.',
    ],
    freeModels: [
      'big-pickle (پیشنهادی برای کدنویسی)',
      'deepseek-v4.1-flash-free',
      'glm-5.3-flash-free',
      'mimo-v2.6-flash-free',
      'nemotron-3-ultra-free',
      'minimax-m2.5-free',
    ],
    commands: ['`/provider opencode`', '`/opencode [KEY]`'],
    links: [
      { label: 'دریافت کلید رایگان', url: 'https://opencode.ai/auth' },
      { label: 'مستندات', url: 'https://opencode.ai/docs' },
      { label: 'لیست زنده مدل‌ها', url: 'https://opencode.ai/zen/v1/models' },
      { label: 'صفحه وضعیت', url: 'https://status.opencode.ai' },
    ],
    note: 'این سرویس مدل‌های رایگان را به‌روز می‌کند؛ با دکمه 🔄 لیست مدل‌های زنده را بروزرسانی کنید.',
  },

  gemini: {
    id: 'gemini',
    title: 'Google Gemini (AI Studio)',
    summary: 'مدل‌های قدرتمند Gemini 2.5 Pro و Gemini 2.5 Flash با سطح رایگان Google AI Studio.',
    keyless: false,
    steps: [
      'به https://aistudio.google.com/apikey بروید و با اکانت Google وارد شوید.',
      'روی دکمه "Create API key" کلیک کنید (نیازی به کارت بانکی برای Tier رایگان نیست).',
      'کلید ساخته‌شده (با پیشوند `AIza...`) را کپی کنید.',
      'کلید را در کادر بالا وارد کنید یا دستور `/setkey gemini YOUR_KEY` را در چت بفرستید.',
      'دکمه «تست اتصال» و سپس «ذخیره» را بزنید.',
    ],
    freeModels: [
      'gemini-2.5-pro (تحلیل معماری و دیباگ عمیق)',
      'gemini-2.5-flash (سریع و پیشنهادی روزمره)',
      'gemini-2.0-flash',
    ],
    commands: ['`/setkey gemini <KEY>`', '`/provider gemini`'],
    links: [
      { label: 'دریافت کلید AI Studio', url: 'https://aistudio.google.com/apikey' },
      { label: 'مستندات رسمی Gemini API', url: 'https://ai.google.dev/gemini-api/docs' },
    ],
    note: 'کلید امنیتی شما منحصراً در هدر `x-goog-api-key` ارسال می‌شود و هرگز در آدرس URL قرار نمی‌گیرد.',
  },

  openrouter: {
    id: 'openrouter',
    title: 'OpenRouter — مدل‌های رایگان (:free)',
    summary: 'دسترسی یکپارچه به ده‌ها مدل کدنویسی رایگان با پسوند `:free` بدون نیاز به کارت بانکی.',
    keyless: false,
    steps: [
      'به https://openrouter.ai/keys بروید و با Google یا GitHub وارد شوید.',
      'روی دکمه "Create Key" کلیک کرده و یک نام دلخواه وارد کنید.',
      'کلید تولیدشده (`sk-or-v1-...`) را کپی کنید.',
      'کلید را در فیلد بالا Paste کنید (یا در چت `/setkey openrouter KEY` بزنید).',
      'دکمه «تست اتصال» را بزنید و یکی از مدل‌های `:free` را انتخاب کنید.',
    ],
    freeModels: [
      'qwen/qwen3-coder:free (پیشنهادی کدنویسی)',
      'deepseek/deepseek-chat:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ],
    commands: ['`/setkey openrouter <KEY>`', '`/provider openrouter`'],
    links: [
      { label: 'دریافت کلید OpenRouter', url: 'https://openrouter.ai/keys' },
      { label: 'مستندات OpenRouter', url: 'https://openrouter.ai/docs' },
    ],
    note: 'فقط مدل‌هایی که پسوند `:free` دارند کاملاً رایگان هستند؛ لیست پویا با دکمه 🔄 قابل دریافت است.',
  },

  groq: {
    id: 'groq',
    title: 'Groq — اجرای فوق‌سریع LPU (رایگان)',
    summary: 'پاسخ‌دهی فوق‌سریع روی پردازنده‌های LPU با کلید رایگان کنسول Groq.',
    keyless: false,
    steps: [
      'به https://console.groq.com/keys بروید و با حساب Google یا GitHub وارد شوید.',
      'روی "Create API Key" کلیک کنید (بدون نیاز به کارت بانکی).',
      'کلید با پیشوند `gsk_...` را کپی کرده و در فیلد بالا قرار دهید.',
      'روی «تست اتصال» کلیک کنید تا سرعت پاسخگویی بررسی شود.',
      'دکمه «ذخیره» را بزنید.',
    ],
    freeModels: [
      'llama-3.3-70b-versatile (پیشنهادی سریع)',
      'qwen-qwq-32b (مناسب استدلال و کدنویسی)',
    ],
    commands: ['`/setkey groq <KEY>`', '`/provider groq`'],
    links: [
      { label: 'کنسول کلید Groq', url: 'https://console.groq.com/keys' },
      { label: 'مستندات Groq', url: 'https://console.groq.com/docs' },
    ],
    note: 'سرویس Groq کمترین تأخیر (Latency) را برای تولید سریع کد فراهم می‌کند.',
  },

  freellmapi: {
    id: 'freellmapi',
    title: 'FreeLLMAPI — روتر ۳۴ سرویس رایگان',
    summary: 'تجمیع‌کننده (روتر) ۳۴ سرویس هوش مصنوعی رایگان در یک اندپوینت سازگار با OpenAI (`/v1`).',
    keyless: false,
    requiresBaseUrl: true,
    steps: [
      'یک نمونه روتر FreeLLMAPI را روی سرور HTTPS عمومی مستقر کنید یا از روتر آماده استفاده نمایید.',
      'آدرس پایه سرور (مثلاً `https://router.example.com/v1`) را در فیلد آدرس وارد کنید.',
      'کلید یکپارچه (`freellmapi-...`) را در فیلد کلید قرار دهید.',
      'دکمه «تست اتصال» را بزنید تا ارتباط با روتر بررسی شود.',
      'دکمه «ذخیره» را بزنید (یا در چت `/freellm <URL> <KEY> auto` ارسال کنید).',
    ],
    freeModels: [
      'auto (انتخاب خودکار بهترین مدل آزاد)',
      'auto:smart (قوی‌ترین مدل کدنویسی)',
      'auto:fast (سریع‌ترین پاسخ)',
    ],
    commands: ['`/freellm <URL> <KEY> [MODEL]`'],
    links: [
      {
        label: 'مخازن و مستندات FreeLLMAPI',
        url: 'https://github.com/search?q=freellmapi&type=repositories',
      },
    ],
    note: 'از آنجا که ایجنت در فضای ابری Telegram Serverless اجرا می‌شود، آدرس روتر باید HTTPS عمومی باشد (نه localhost).',
  },

  apifreellm: {
    id: 'apifreellm',
    title: 'ApiFreeLLM.com — سرویس رایگان',
    summary: 'اتصال بومی به اندپوینت رایگان ApiFreeLLM.com بدون نیاز به کارت اعتباری.',
    keyless: false,
    steps: [
      'به https://apifreellm.com/en/api-access بروید.',
      'با اکانت Google وارد شوید تا کلید API رایگان نمایش داده شود.',
      'کلید دریافت‌شده را کپی کرده و در فیلد بالا Paste کنید.',
      'دکمه «تست اتصال» و سپس «ذخیره» را بزنید.',
    ],
    freeModels: ['apifreellm (مدل پیش‌فرض رایگان سایت)'],
    commands: ['`/freellm <API_KEY>`', '`/setkey apifreellm <KEY>`'],
    links: [
      { label: 'دریافت کلید ApiFreeLLM', url: 'https://apifreellm.com/en/api-access' },
      { label: 'مستندات ApiFreeLLM', url: 'https://apifreellm.com/docs' },
    ],
    note: 'ابزارهای کدنویسی روی این سرویس به‌صورت خودکار با پروتکل هوشمند `<tool_call>` اجرا می‌شوند.',
  },

  llm7: {
    id: 'llm7',
    title: 'LLM7.io — رایگان و بدون کلید',
    summary: 'اجرای فوری کدنویسی بدون ثبت‌نام و بدون نیاز به کلید API (با قابلیت ثبت کلید اختیاری).',
    keyless: true,
    steps: [
      'بدون هیچ کلیدی آماده استفاده است! کافی است سرویس LLM7 را انتخاب کنید.',
      'برای اطمینان می‌توانید همین حالا دکمه «تست اتصال» را بزنید.',
      'اختیاری: برای سقف درخواست بالاتر از https://dash.llm7.io کلید رایگان بگیرید و ذخیره کنید.',
    ],
    freeModels: [
      'default (پیشنهادی بدون کلید)',
      'gpt-oss (مناسب کدنویسی)',
      'fast (پاسخ سریع)',
    ],
    commands: ['`/provider llm7`'],
    links: [
      { label: 'مستندات API', url: 'https://api.llm7.io' },
      { label: 'داشبورد سقف بالاتر (اختیاری)', url: 'https://dash.llm7.io' },
    ],
    note: 'در صورت محدودیت موقت نرخ درخواست در حالت بدون کلید، روتر به‌طور خودکار به Pollinations سوییچ می‌کند.',
  },

  pollinations: {
    id: 'pollinations',
    title: 'Pollinations — رایگان و بدون کلید',
    summary: 'سرویس متن‌باز و رایگان Pollinations بدون نیاز به ثبت‌نام یا کلید API.',
    keyless: true,
    steps: [
      'نیازی به دریافت یا وارد کردن هیچ کلیدی نیست.',
      'کافی است دکمه «تست اتصال» یا «ذخیره / فعال‌سازی» را بزنید.',
    ],
    freeModels: ['openai (مدل رایگان پیش‌فرض Pollinations)'],
    commands: ['`/provider pollinations`'],
    links: [{ label: 'وب‌سایت و مستندات Pollinations', url: 'https://text.pollinations.ai' }],
    note: 'گزینه عالی برای تست سریع بدون ثبت‌نام و پشتیبان خودکار حالت بدون کلید.',
  },

  custom: {
    id: 'custom',
    title: 'Custom — سرویس سفارشی سازگار با OpenAI',
    summary: 'اتصال به هر درگاه سازگار با استاندارد OpenAI (`/v1/chat/completions`).',
    keyless: false,
    requiresBaseUrl: true,
    steps: [
      'آدرس پایه سرور سازگار با OpenAI (مثلاً `https://api.example.com/v1`) را در فیلد آدرس وارد کنید.',
      'در صورت نیاز سرور به احراز هویت، کلید API را در فیلد کلید قرار دهید.',
      'شناسه مدل مورد نظر را انتخاب یا با دستور `/model <id>` تنظیم نمایید.',
      'دکمه «تست اتصال» و سپس «ذخیره» را بزنید.',
    ],
    freeModels: ['هر مدل سازگار با OpenAI که روی سرور مقصد تعریف شده باشد'],
    commands: ['`/setcustom <URL> [KEY] [MODEL]`'],
    links: [],
    note: 'آدرس سرور الزامی است و باید از اینترنت عمومی با HTTPS در دسترس باشد.',
  },
};

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
    label: id === 'big-pickle' ? `🆓⭐ ${id}` : `🆓 ${id}`,
    free: true,
    recommended: id === 'big-pickle',
    tier: id.includes('flash') || id.includes('lightning') ? 'fast' : 'smart',
  }));
}

/**
 * Dynamically fetches active `:free` models from OpenRouter (`GET https://openrouter.ai/api/v1/models`).
 */
export async function fetchLiveOpenRouterFreeModels(apiKey = '') {
  const headers = { Accept: 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!res.ok) {
    throw new Error(`عدم دریافت لیست مدل‌های رایگان OpenRouter (کد ${res.status})`);
  }

  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];

  const freeIds = list
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id.endsWith(':free'));

  const prioritized = [
    ...PROVIDERS.openrouter.models.map((m) => m.id),
    ...freeIds.filter((id) => /coder|deepseek|qwen|llama|gemini|mistral/i.test(id)),
    ...freeIds,
  ];
  const uniqueIds = Array.from(new Set(prioritized)).slice(0, 20);

  return uniqueIds.map((id, idx) => ({
    id,
    label: `🆓${idx === 0 ? '⭐' : ''} ${id}`,
    free: true,
    recommended: idx === 0,
    tier: /flash|mini|8b/i.test(id) ? 'fast' : 'smart',
  }));
}
