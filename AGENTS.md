# AGENTS.md

Orientation for AI coding assistants and developers working in **Ahwaz Telegram Serverless Coding Agent**.
For the full platform SDK reference (`db`, `api`, `fetch`, `InputFile`, `EndpointError`), see [docs/tgcloud-sdk.md](docs/tgcloud-sdk.md).

## What this project is

An autonomous **Telegram Coding Agent + Mini App Code Studio** running **100% natively on Telegram Serverless (`https://core.telegram.org/bots/serverless`)** powered by **Google Gemini**.

There is no external VPS, no Docker container, and no `node_modules` at runtime: Telegram executes `tgcloud/*.js` inside isolated **V8 sandboxes** next to the Bot API and built-in **SQLite** database (`sdk/db`), and serves `miniapp-dist/` as the hosted Mini App (`https://app<app_id>.tgcloud.ai/`).

## Layout

| Path | What it is |
| :--- | :--- |
| `tgcloud/schema.js` | SQLite database schema (`users`, `botSettings`, `projects`, `workspaceFiles`, `chatHistories`). Named exports only; **no foreign keys**. |
| `tgcloud/handlers/` | Flat Telegram Update handlers (`message.js`, `callback_query.js`). **One level deep only.** |
| `tgcloud/endpoints/` | Flat Mini App endpoints (`studio.js`, `agent.js`), invoked via `Telegram.WebApp.Serverless.call(...)` with verified `ctx.initData.user`. |
| `tgcloud/lib/services/` | Modular Telegram Services (`auth-service.js`, `workspace-service.js`, `conversation-service.js`, `zip-service.js`, `github-service.js`, `delivery-service.js`, `keyboard-service.js`, `command-service.js`, `binary-utils.js`). |
| `tgcloud/lib/agent/` | Autonomous Gemini Coding Agent Core (`coding-agent.js`, `gemini-service.js`, `tools.js`, `js-sandbox.js`, `system-prompt.js`). |
| `miniapp/` & `miniapp-dist/` | Source and built static bundle for **Ahwaz Code Studio** Mini App (`tgcloud.jsonc` → `"static": { "source": "miniapp-dist", "spa": true }`). |
| `docs/tgcloud-sdk.md` | Official Telegram Serverless SDK documentation. |
| `scripts/validate-tgcloud.mjs` | Static validator checking all `tgcloud/` modules for strict V8 isolate & import rules. |

## Strict Platform Rules (`tgcloud/`)

1. **Relative imports MUST end with `.js`** (`import { users } from '../schema.js'`). SDK imports are bare (`import { api, fetch, InputFile } from 'sdk'`, `import db, { eq } from 'sdk/db'`).
2. **No Node globals or npm packages inside `tgcloud/`**: Do not import `fs`, `path`, `Buffer`, `process.env`, or npm libraries inside `tgcloud/`. Use `Uint8Array`, `TextEncoder`, `TextDecoder`, `DataView`, and `sdk`.
3. **Every DB call is async — always `await`**. Never use `.references()` or `foreignKey()` in `tgcloud/schema.js`.
4. **Files**: Download incoming Telegram attachments with `await api.getFileContent(file_id)` (`Uint8Array`) and upload attachments with `new InputFile(bytes, filename, { type })`.

## Deploy & Migrate Commands

```bash
npx tgcloud login          # Link project using CLI Access Token from @BotFather -> Serverless
npm run deploy             # Build Mini App + push all tgcloud/ modules & static files
npx tgcloud migrate        # Apply tgcloud/schema.js tables/changes to Telegram Serverless SQLite
npx tgcloud status         # Inspect local vs deployed cloud state
npm run validate:tgcloud   # Verify V8 isolate & import rules
npm test                   # Run Vitest suite against local sdk simulator
```
