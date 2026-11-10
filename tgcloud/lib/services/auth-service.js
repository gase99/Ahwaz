import db, { eq, sql } from 'sdk/db';
import { botSettings, users } from '../../schema.js';

export const RECOMMENDED_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (پیشرفته - معماری و دیباگ)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (سریع - کدنویسی روزمره)' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (فوق سریع)' },
];

export async function ensureUser(fromUser) {
  const tgId = Number(fromUser.id);
  const existing = await db.select().from(users).where(eq(users.tgId, tgId)).get();

  if (existing) {
    if (
      (fromUser.username && fromUser.username !== existing.username) ||
      (fromUser.first_name && fromUser.first_name !== existing.firstName)
    ) {
      await db
        .update(users)
        .set({
          username: fromUser.username ?? existing.username,
          firstName: fromUser.first_name ?? existing.firstName,
        })
        .where(eq(users.tgId, tgId))
        .run();
    }
    return existing;
  }

  // First user ever interacting with this Telegram Serverless bot becomes Admin automatically!
  const totalUsers = await db.$count(users);
  const isFirstOwner = totalUsers === 0;

  await db
    .insert(users)
    .values({
      tgId,
      username: fromUser.username ?? null,
      firstName: fromUser.first_name ?? 'User',
      isAdmin: isFirstOwner,
      isAllowed: isFirstOwner,
      activeProject: 'default',
      model: 'gemini-2.5-pro',
    })
    .onConflictDoNothing({ target: users.tgId })
    .run();

  return await db.select().from(users).where(eq(users.tgId, tgId)).get();
}

export async function getSetting(key) {
  const row = await db.select().from(botSettings).where(eq(botSettings.key, key)).get();
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  const nowSec = Math.floor(Date.now() / 1000);
  await db
    .insert(botSettings)
    .values({ key, value: String(value), updatedAt: nowSec })
    .onConflictDoUpdate({
      target: botSettings.key,
      set: { value: String(value), updatedAt: nowSec },
    })
    .run();
}

export async function resolveGeminiApiKey(userRow) {
  if (userRow?.geminiKey && userRow.geminiKey.trim()) {
    return userRow.geminiKey.trim();
  }
  const globalKey = await getSetting('global_gemini_key');
  return globalKey ? globalKey.trim() : null;
}

export async function resolveGithubToken(userRow) {
  if (userRow?.githubToken && userRow.githubToken.trim()) {
    return userRow.githubToken.trim();
  }
  const globalToken = await getSetting('global_github_token');
  return globalToken ? globalToken.trim() : null;
}

export async function saveUserGeminiKey(userRow, apiKey) {
  const clean = String(apiKey ?? '').trim();
  await db
    .update(users)
    .set({ geminiKey: clean })
    .where(eq(users.tgId, userRow.tgId))
    .run();
  if (userRow.isAdmin) {
    await setSetting('global_gemini_key', clean);
  }
}

export async function saveUserGithubToken(userRow, token) {
  const clean = String(token ?? '').trim();
  await db
    .update(users)
    .set({ githubToken: clean })
    .where(eq(users.tgId, userRow.tgId))
    .run();
  if (userRow.isAdmin) {
    await setSetting('global_github_token', clean);
  }
}

export async function setUserAccess(targetTgId, allowed) {
  const idNum = Number(targetTgId);
  const existing = await db.select().from(users).where(eq(users.tgId, idNum)).get();
  if (existing) {
    await db.update(users).set({ isAllowed: Boolean(allowed) }).where(eq(users.tgId, idNum)).run();
  } else {
    await db
      .insert(users)
      .values({
        tgId: idNum,
        firstName: 'Allowed User',
        isAdmin: false,
        isAllowed: Boolean(allowed),
        activeProject: 'default',
        model: 'gemini-2.5-pro',
      })
      .run();
  }
}

export async function setActiveProject(tgId, projectName) {
  await db
    .update(users)
    .set({ activeProject: projectName })
    .where(eq(users.tgId, Number(tgId)))
    .run();
}

export async function setActiveModel(tgId, model) {
  await db
    .update(users)
    .set({ model: String(model).trim() })
    .where(eq(users.tgId, Number(tgId)))
    .run();
}

export async function incrementStats(tgId, toolCallsCount) {
  await db
    .update(users)
    .set({
      promptCount: sql`${users.promptCount} + 1`,
      toolCallCount: sql`${users.toolCallCount} + ${Number(toolCallsCount || 0)}`,
    })
    .where(eq(users.tgId, Number(tgId)))
    .run();
}
