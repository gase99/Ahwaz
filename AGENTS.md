# AGENTS.md — Ahwaz Telegram Serverless Coding Agent (`v2.1.0`)

## Platform & Runtime Constraints (`@tgcloud/cli`)
This repository targets **Telegram Serverless** (`https://core.telegram.org/bots/serverless`). Every runtime module inside `tgcloud/` runs in Telegram's isolated V8 runtime (`sdk`, `sdk/db`):
1. **No Node.js built-ins or npm packages inside `tgcloud/`**: Do not import `fs`, `path`, `Buffer`, `crypto`, `zlib`, or npm packages in `tgcloud/**/*.js`. Use Web/V8 globals (`Uint8Array`, `DataView`, `TextEncoder`, `TextDecoder`, `DecompressionStream`) and `'sdk'` / `'sdk/db'`.
2. **Relative imports require `.js`**: Every relative import inside `tgcloud/` must include the explicit `.js` extension.
3. **Flat handlers & endpoints**: `tgcloud/handlers/*.js` and `tgcloud/endpoints/*.js` must stay flat (`nested: false`).
   - Handlers export `default async function (payload, ctx)` (`handlers/message.js` receives `Message`, `handlers/callback_query.js` receives `CallbackQuery`).
   - Endpoints export `default async function (input, ctx)` where `ctx.initData.user` is verified by Telegram Serverless and errors throw `new EndpointError(description, { code })`.
4. **SQLite Schema (`tgcloud/schema.js`)**:
   - Named table exports only.
   - **Never declare foreign keys** (`.references()` / `foreignKey()` throw on deploy).
   - Additive columns (`provider`, `providerConfigs`) are migrated via `npx tgcloud migrate`. Never delete columns without `.deprecated('reason')`.

## Multi-Provider LLM Architecture (`tgcloud/lib/agent/`)
- `providers.js`: Defines all 9 provider specs (`opencode`, `freellmapi`, `apifreellm`, `llm7`, `pollinations`, `openrouter`, `groq`, `gemini`, `custom`) plus `fetchLiveOpenCodeFreeModels()` (`GET https://opencode.ai/zen/v1/models`).
- `llm-router.js`:
  - Normalizes conversation history into provider-agnostic `{ role: 'user' | 'assistant' | 'tool' }` turns while preserving Gemini `rawGeminiParts` (`thoughtSignature`) and upgrading legacy history rows seamlessly.
  - Supports 3 wire protocols: `gemini` (`v1beta`), `openai` (`/chat/completions` with lowercased JSON Schema types), and `apifreellm` (`POST https://apifreellm.com/api/v1/chat`).
  - Implements **Dual-Mode Tool Calling**: sends native `tools` first, and automatically retries with structured `<tool_call>{...}</tool_call>` ReAct XML/JSON blocks if a free model returns HTTP `400/422` (`tools unsupported`) or uses `apifreellm`.
  - Includes keyless resilience (`llm7` -> `pollinations` failover and keyless `opencode` -> `llm7` fallback with user hint).

## Validation Commands
Always run all three checks before committing:
```bash
npm run build
npm run validate:tgcloud
npm test
```
