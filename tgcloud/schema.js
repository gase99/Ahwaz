import { table, integer, text, boolean, json, index, uniqueIndex, sql } from 'sdk/db';

export const users = table(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull().unique(),
    username: text('username'),
    firstName: text('first_name'),
    isAdmin: boolean('is_admin').default(false),
    isAllowed: boolean('is_allowed').default(false),
    activeProject: text('active_project').default('default'),
    model: text('model').default('gemini-2.5-pro'),
    geminiKey: text('gemini_key'),
    githubToken: text('github_token'),
    promptCount: integer('prompt_count').default(0),
    toolCallCount: integer('tool_call_count').default(0),
    createdAt: integer('created_at').default(sql`(unixepoch())`),
  },
  (t) => ({
    allowedIdx: index('idx_users_allowed').on(t.isAllowed),
  }),
);

export const botSettings = table('bot_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
});

export const projects = table(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    name: text('name').notNull(),
    description: text('description').default(''),
    githubRepo: text('github_repo'),
    githubBranch: text('github_branch').default('main'),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`),
  },
  (t) => ({
    userNameUidx: uniqueIndex('uidx_projects_user_name').on(t.tgId, t.name),
  }),
);

export const workspaceFiles = table(
  'workspace_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    projectName: text('project_name').notNull(),
    path: text('path').notNull(),
    content: text('content').notNull(),
    sizeBytes: integer('size_bytes').default(0),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`),
  },
  (t) => ({
    fileUidx: uniqueIndex('uidx_ws_file').on(t.tgId, t.projectName, t.path),
    projIdx: index('idx_ws_project').on(t.tgId, t.projectName),
  }),
);

export const chatHistories = table(
  'chat_histories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    projectName: text('project_name').notNull(),
    messages: json('messages'),
    updatedAt: integer('updated_at').default(sql`(unixepoch())`),
  },
  (t) => ({
    histUidx: uniqueIndex('uidx_chat_hist').on(t.tgId, t.projectName),
  }),
);
