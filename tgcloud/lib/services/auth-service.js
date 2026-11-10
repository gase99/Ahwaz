import db, { eq, sql } from 'sdk/db';
import { botSettings, users } from '../../schema.js';
import { getProviderSpec, PROVIDERS } from '../agent/providers.js';

export const RECOMMENDED_MODELS = PROVIDERS.opencode.models;

export async function ensureUser(fromUser) {
  const tgId = Number(fromUser.id);
  const existing = await db.select().from(users).where(eq(users.tgId, tgId)).get();

  if (existing) {
    if (!existing.provider) existing.provider = 'opencode';
    if (!existing.model) existing.model = getProviderSpec(existing.provider).defaultModel;
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
      provider: 'opencode',
      model: 'big-pickle',
      providerConfigs: {},
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

async function getGlobalProviderConfigs() {
  const raw = await getSetting('global_provider_configs');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function setGlobalProviderConfig(providerId, patch) {
  const current = await getGlobalProviderConfigs();
  current[providerId] = {
    ...(current[providerId] || {}),
    ...patch,
  };
  await setSetting('global_provider_configs', JSON.stringify(current));
}

export async function saveProviderCredentials(userRow, providerId, { apiKey, baseUrl }) {
  const spec = getProviderSpec(providerId);
  const userConfigs =
    userRow.providerConfigs && typeof userRow.providerConfigs === 'object'
      ? { ...userRow.providerConfigs }
      : {};

  const prev = userConfigs[spec.id] || {};
  const updatedEntry = {
    ...prev,
    ...(typeof apiKey === 'string' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
  };
  userConfigs[spec.id] = updatedEntry;

  const updateFields = {
    providerConfigs: userConfigs,
  };
  if (spec.id === 'gemini' && updatedEntry.apiKey) {
    updateFields.geminiKey = updatedEntry.apiKey;
  }

  await db
    .update(users)
    .set(updateFields)
    .where(eq(users.tgId, userRow.tgId))
    .run();

  if (userRow.isAdmin) {
    await setGlobalProviderConfig(spec.id, updatedEntry);
    if (spec.id === 'gemini' && updatedEntry.apiKey) {
      await setSetting('global_gemini_key', updatedEntry.apiKey);
    }
  }
}

export async function resolveProviderAuth(userRow, overrideProviderId = null) {
  const providerId = overrideProviderId || userRow?.provider || 'opencode';
  const spec = getProviderSpec(providerId);
  const globalConfigs = await getGlobalProviderConfigs();
  const userConfigs =
    userRow?.providerConfigs && typeof userRow.providerConfigs === 'object'
      ? userRow.providerConfigs
      : {};

  const uEntry = userConfigs[spec.id] || {};
  const gEntry = globalConfigs[spec.id] || {};

  let apiKey = uEntry.apiKey || gEntry.apiKey || '';
  if (spec.id === 'gemini' && !apiKey) {
    apiKey = userRow?.geminiKey || (await getSetting('global_gemini_key')) || '';
  }

  const baseUrl = uEntry.baseUrl || gEntry.baseUrl || spec.defaultBaseUrl || '';
  const model =
    overrideProviderId && overrideProviderId !== userRow?.provider
      ? spec.defaultModel
      : userRow?.model || spec.defaultModel;

  let isReady = true;
  let missingReason = null;

  if (spec.requiresBaseUrl && !baseUrl) {
    isReady = false;
    missingReason = `آدرس سرور برای ${spec.title} تنظیم نشده است. با دستور زیر ثبت کنید:\n/freellm https://your-router-host/v1 freellmapi-your-key`;
  } else if (spec.requiresKey && !apiKey) {
    isReady = false;
    missingReason = `کلید API برای سرویس «${spec.title}» ثبت نشده است.\n💡 ${spec.signupHint}\nسپس کلید را با دستور زیر ثبت کنید:\n/setkey ${spec.id} YOUR_API_KEY\n(یا با دستور /provider یکی از سرویس‌های رایگان بدون کلید مثل LLM7 یا OpenCode را انتخاب کنید!)`;
  }

  return {
    providerId: spec.id,
    providerSpec: spec,
    apiKey,
    baseUrl,
    model,
    isReady,
    missingReason,
  };
}

export async function resolveGeminiApiKey(userRow) {
  const res = await resolveProviderAuth(userRow, 'gemini');
  return res.apiKey || null;
}

export async function resolveGithubToken(userRow) {
  if (userRow?.githubToken && userRow.githubToken.trim()) {
    return userRow.githubToken.trim();
  }
  const globalToken = await getSetting('global_github_token');
  return globalToken ? globalToken.trim() : null;
}

export async function saveUserGeminiKey(userRow, apiKey) {
  await saveProviderCredentials(userRow, 'gemini', { apiKey });
  await setActiveProviderAndModel(userRow.tgId, 'gemini', 'gemini-2.5-pro');
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
        provider: 'opencode',
        model: 'big-pickle',
        providerConfigs: {},
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

export async function setActiveProviderAndModel(tgId, providerId, model = null) {
  const spec = getProviderSpec(providerId);
  const nextModel = model && String(model).trim() ? String(model).trim() : spec.defaultModel;
  await db
    .update(users)
    .set({
      provider: spec.id,
      model: nextModel,
    })
    .where(eq(users.tgId, Number(tgId)))
    .run();
  return { provider: spec.id, model: nextModel };
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
