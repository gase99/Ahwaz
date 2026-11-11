import { boolean, index, integer, json, sql, table, text, uniqueIndex } from 'sdk/db';

/**
 * Authorized Telegram developers & per-user Multi-Provider AI configuration.
 * Supports free keyless/community providers (OpenCode Zen, LLM7, FreeLLMAPI, ApiFreeLLM, OpenRouter, Groq) + Gemini!
 */
export const users = table('users', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  isAdmin: boolean('is_admin').default(false).notNull(),
  isAllowed: boolean('is_allowed').default(false).notNull(),
  activeProject: text('active_project').default('default').notNull(),
  provider: text('provider').default('opencode').notNull(),
  model: text('model').default('big-pickle').notNull(),
  providerConfigs: json('provider_configs').default({}),
  geminiKey: text('gemini_key'),
  githubToken: text('github_token'),
  promptCount: integer('prompt_count').default(0).notNull(),
  toolCallCount: integer('tool_call_count').default(0).notNull(),
  createdAt: integer('created_at').default(sql`(unixepoch())`).notNull(),
});

/**
 * Dedicated SQLite storage for per-user encrypted API keys & connection test diagnostics.
 * Zero foreign keys as required by Telegram Serverless (@tgcloud/cli).
 */
export const apiKeys = table(
  'api_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    provider: text('provider').notNull(),
    keyEncrypted: text('key_encrypted').default('').notNull(),
    baseUrl: text('base_url'),
    status: text('status').default('untested').notNull(),
    lastLatencyMs: integer('last_latency_ms'),
    lastTestedAt: integer('last_tested_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').default(sql`(unixepoch())`).notNull(),
  },
  (t) => ({
    userProviderUniq: uniqueIndex('idx_api_keys_user_provider').on(t.tgId, t.provider),
    userIdx: index('idx_api_keys_user').on(t.tgId),
  }),
);

/**
 * Global bot configuration (Mini App public URL, global provider keys, etc.)
 * Stored inside SQLite for Telegram Serverless V8 isolates.
 */
export const botSettings = table('bot_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`).notNull(),
});

/**
 * Per-user coding projects (each user can maintain multiple isolated apps/repos).
 */
export const projects = table(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    name: text('name').notNull(),
    description: text('description').default(''),
    githubRepo: text('github_repo'),
    githubBranch: text('github_branch').default('main'),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`).notNull(),
  },
  (t) => ({
    ownerNameUniq: uniqueIndex('idx_projects_owner_name').on(t.tgId, t.name),
  }),
);

/**
 * Virtual Cloud Filesystem persisted in SQLite (replaces local disk workspace).
 */
export const workspaceFiles = table(
  'workspace_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    projectName: text('project_name').notNull(),
    path: text('path').notNull(),
    content: text('content').notNull(),
    encoding: text('encoding').default('utf8').notNull(),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`).notNull(),
  },
  (t) => ({
    fileUniq: uniqueIndex('idx_files_project_path').on(t.tgId, t.projectName, t.path),
    projLookup: index('idx_files_owner_proj').on(t.tgId, t.projectName),
  }),
);

/**
 * Multi-turn Normalized LLM conversation history per user & project.
 */
export const chatHistories = table(
  'chat_histories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    projectName: text('project_name').notNull(),
    entries: json('entries').notNull(),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`).notNull(),
  },
  (t) => ({
    histUniq: uniqueIndex('idx_history_owner_proj').on(t.tgId, t.projectName),
  }),
);
