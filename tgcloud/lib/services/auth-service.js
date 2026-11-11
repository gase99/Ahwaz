import db, { and, eq, sql } from 'sdk/db';
import { apiKeys, botSettings, users } from '../../schema.js';
import { getProviderSpec, PROVIDER_LIST, PROVIDERS } from '../agent/providers.js';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes,
} from './binary-utils.js';

export const RECOMMENDED_MODELS = PROVIDERS.opencode.models;

const ENC_PREFIX = 'enc1:';

function deriveStreamBytes(tgId, providerId) {
  return utf8ToBytes(`Ahwaz::tgcloud::v2.1::${Number(tgId)}::${String(providerId)}`);
}

/**
 * Pure V8-Isolate symmetric key obfuscation/encryption for SQLite at-rest storage
 * (zero Node.js `crypto` or `Buffer` imports).
 */
export function encryptStoredKey(plainKey, tgId, providerId) {
  const clean = String(plainKey ?? '').trim();
  if (!clean) return '';
  const src = utf8ToBytes(clean);
  const mask = deriveStreamBytes(tgId, providerId);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 1) {
    out[i] = src[i] ^ mask[i % mask.length] ^ ((i * 31 + 17) & 0xff);
  }
  return `${ENC_PREFIX}${bytesToBase64(out)}`;
}

export function decryptStoredKey(stored, tgId, providerId) {
  const raw = String(stored ?? '');
  if (!raw) return '';
  if (!raw.startsWith(ENC_PREFIX)) return raw;
  const cipher = base64ToBytes(raw.slice(ENC_PREFIX.length));
  const mask = deriveStreamBytes(tgId, providerId);
  const out = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i += 1) {
    out[i] = cipher[i] ^ mask[i % mask.length] ^ ((i * 31 + 17) & 0xff);
  }
  return bytesToUtf8(out);
}

/**
 * Masks an API key for UI display (never exposes raw secret).
 */
export function maskApiKey(rawKey) {
  const clean = String(rawKey ?? '').trim();
  if (!clean || clean === 'unused') return '';
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}••••••${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 4)}••••••••••${clean.slice(-4)}`;
}

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
      const nextUsername = fromUser.username ?? existing.username;
      const nextFirstName = fromUser.first_name ?? existing.firstName;
      await db
        .update(users)
        .set({
          username: nextUsername,
          firstName: nextFirstName,
        })
        .where(eq(users.tgId, tgId))
        .run();
      existing.username = nextUsername;
      existing.firstName = nextFirstName;
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
  if (patch === null) {
    delete current[providerId];
  } else {
    current[providerId] = {
      ...(current[providerId] || {}),
      ...patch,
    };
  }
  await setSetting('global_provider_configs', JSON.stringify(current));
}

async function getApiKeyRow(tgId, providerId) {
  return await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tgId, Number(tgId)), eq(apiKeys.provider, providerId)))
    .get();
}

export async function listUserApiKeyRecords(tgId) {
  const uid = Number(tgId);
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.tgId, uid)).all();
  return rows.map((row) => {
    const plainKey = decryptStoredKey(row.keyEncrypted, uid, row.provider);
    return {
      ...row,
      plainKey,
      maskedKey: maskApiKey(plainKey),
    };
  });
}

export async function countStoredUserKeys(tgId) {
  const records = await listUserApiKeyRecords(tgId);
  return records.filter(
    (r) => (r.plainKey && r.plainKey !== 'unused') || Boolean(r.baseUrl),
  ).length;
}

export async function saveProviderCredentials(userRow, providerId, { apiKey, baseUrl }) {
  const spec = getProviderSpec(providerId);
  const uid = Number(userRow.tgId);

  const cleanKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
  const cleanUrl = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null;

  const existingRow = await getApiKeyRow(uid, spec.id);
  const prevPlainKey = existingRow
    ? decryptStoredKey(existingRow.keyEncrypted, uid, spec.id)
    : '';
  const finalPlainKey = cleanKey ?? prevPlainKey;
  const finalBaseUrl = cleanUrl ?? existingRow?.baseUrl ?? null;

  if (finalPlainKey || finalBaseUrl) {
    const encrypted = finalPlainKey ? encryptStoredKey(finalPlainKey, uid, spec.id) : '';
    if (existingRow) {
      await db
        .update(apiKeys)
        .set({
          keyEncrypted: encrypted,
          baseUrl: finalBaseUrl,
          status: 'connected',
          lastError: null,
        })
        .where(eq(apiKeys.id, existingRow.id))
        .run();
    } else {
      await db
        .insert(apiKeys)
        .values({
          tgId: uid,
          provider: spec.id,
          keyEncrypted: encrypted,
          baseUrl: finalBaseUrl,
          status: 'connected',
          lastLatencyMs: null,
          lastTestedAt: null,
          lastError: null,
          createdAt: Math.floor(Date.now() / 1000),
        })
        .run();
    }
  }

  // Keep users.providerConfigs synchronized for fast backward-compatible resolution
  const userConfigs =
    userRow.providerConfigs && typeof userRow.providerConfigs === 'object'
      ? { ...userRow.providerConfigs }
      : {};

  const prev = userConfigs[spec.id] || {};
  const updatedEntry = {
    ...prev,
    ...(cleanKey ? { apiKey: cleanKey } : {}),
    ...(cleanUrl ? { baseUrl: cleanUrl } : {}),
  };
  userConfigs[spec.id] = updatedEntry;

  const updateFields = {
    providerConfigs: userConfigs,
  };
  if (spec.id === 'gemini' && updatedEntry.apiKey) {
    updateFields.geminiKey = updatedEntry.apiKey;
  }

  await db.update(users).set(updateFields).where(eq(users.tgId, uid)).run();

  userRow.providerConfigs = userConfigs;
  if (spec.id === 'gemini' && updatedEntry.apiKey) {
    userRow.geminiKey = updatedEntry.apiKey;
  }

  if (userRow.isAdmin) {
    await setGlobalProviderConfig(spec.id, updatedEntry);
    if (spec.id === 'gemini' && updatedEntry.apiKey) {
      await setSetting('global_gemini_key', updatedEntry.apiKey);
    }
  }
}

export async function deleteProviderCredentials(userRow, providerId) {
  const spec = getProviderSpec(providerId);
  const uid = Number(userRow.tgId);

  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.tgId, uid), eq(apiKeys.provider, spec.id)))
    .run();

  const userConfigs =
    userRow.providerConfigs && typeof userRow.providerConfigs === 'object'
      ? { ...userRow.providerConfigs }
      : {};
  delete userConfigs[spec.id];

  const updateFields = {
    providerConfigs: userConfigs,
  };
  if (spec.id === 'gemini') {
    updateFields.geminiKey = null;
    userRow.geminiKey = null;
  }

  await db.update(users).set(updateFields).where(eq(users.tgId, uid)).run();
  userRow.providerConfigs = userConfigs;

  if (userRow.isAdmin) {
    await setGlobalProviderConfig(spec.id, null);
    if (spec.id === 'gemini') {
      await setSetting('global_gemini_key', '');
    }
  }

  // If the deleted provider was active and requires credentials, fall back to keyless OpenCode
  if (userRow.provider === spec.id && (spec.requiresKey || spec.requiresBaseUrl)) {
    const fallback = await setActiveProviderAndModel(uid, 'opencode', 'big-pickle');
    userRow.provider = fallback.provider;
    userRow.model = fallback.model;
  }
}

export async function recordProviderTestResult(
  tgId,
  providerId,
  { success, latencyMs = null, error = null, baseUrl = null },
) {
  const spec = getProviderSpec(providerId);
  const uid = Number(tgId);
  const nowSec = Math.floor(Date.now() / 1000);
  const status = success ? 'connected' : 'invalid';
  const existing = await getApiKeyRow(uid, spec.id);

  if (existing) {
    await db
      .update(apiKeys)
      .set({
        status,
        lastLatencyMs: latencyMs,
        lastTestedAt: nowSec,
        lastError: success ? null : String(error || 'خطای اتصال'),
        ...(baseUrl ? { baseUrl } : {}),
      })
      .where(eq(apiKeys.id, existing.id))
      .run();
  } else {
    await db
      .insert(apiKeys)
      .values({
        tgId: uid,
        provider: spec.id,
        keyEncrypted: '',
        baseUrl: baseUrl || null,
        status,
        lastLatencyMs: latencyMs,
        lastTestedAt: nowSec,
        lastError: success ? null : String(error || 'خطای اتصال'),
        createdAt: nowSec,
      })
      .run();
  }
}

export async function resolveProviderAuth(userRow, overrideProviderId = null) {
  const providerId = overrideProviderId || userRow?.provider || 'opencode';
  const spec = getProviderSpec(providerId);
  const uid = Number(userRow?.tgId || 0);

  const keyRow = uid ? await getApiKeyRow(uid, spec.id) : null;
  const dbPlainKey = keyRow ? decryptStoredKey(keyRow.keyEncrypted, uid, spec.id) : '';

  const globalConfigs = await getGlobalProviderConfigs();
  const userConfigs =
    userRow?.providerConfigs && typeof userRow.providerConfigs === 'object'
      ? userRow.providerConfigs
      : {};

  const uEntry = userConfigs[spec.id] || {};
  const gEntry = globalConfigs[spec.id] || {};

  let apiKey = dbPlainKey || uEntry.apiKey || gEntry.apiKey || '';
  if (spec.id === 'gemini' && !apiKey) {
    apiKey = userRow?.geminiKey || (await getSetting('global_gemini_key')) || '';
  }

  const baseUrl =
    keyRow?.baseUrl || uEntry.baseUrl || gEntry.baseUrl || spec.defaultBaseUrl || '';
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

  const hasExplicitKey = Boolean(apiKey && apiKey !== 'unused');
  let status = 'disconnected';
  if (keyRow?.status === 'invalid') {
    status = 'invalid';
  } else if (isReady) {
    status = 'connected';
  }

  return {
    providerId: spec.id,
    providerSpec: spec,
    apiKey,
    maskedKey: maskApiKey(apiKey),
    hasExplicitKey,
    baseUrl,
    model,
    isReady,
    status,
    lastLatencyMs: keyRow?.lastLatencyMs ?? null,
    lastTestedAt: keyRow?.lastTestedAt ?? null,
    lastError: keyRow?.lastError ?? null,
    missingReason,
  };
}

export async function buildUserProvidersSnapshot(userRow) {
  const out = [];
  for (const p of PROVIDER_LIST) {
    const auth = await resolveProviderAuth(userRow, p.id);
    out.push({
      id: p.id,
      title: p.title,
      shortBadge: p.shortBadge,
      logo: p.logo,
      protocol: p.protocol,
      defaultBaseUrl: p.defaultBaseUrl,
      acceptsOptionalKey: Boolean(p.acceptsOptionalKey),
      requiresKey: p.requiresKey,
      requiresBaseUrl: Boolean(p.requiresBaseUrl),
      keyPlaceholder: p.keyPlaceholder,
      signupHint: p.signupHint,
      signupUrl: p.signupUrl,
      docsUrl: p.docsUrl,
      freeNote: p.freeNote,
      defaultModel: p.defaultModel,
      models: p.models,
      isReady: auth.isReady,
      missingReason: auth.missingReason,
      status: auth.status,
      apiKeyConfigured: auth.hasExplicitKey,
      maskedKey: auth.maskedKey,
      baseUrl: auth.baseUrl,
      lastLatencyMs: auth.lastLatencyMs,
      lastTestedAt: auth.lastTestedAt,
      lastError: auth.lastError,
    });
  }
  return out;
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
  const updated = await setActiveProviderAndModel(userRow.tgId, 'gemini', 'gemini-2.5-pro');
  userRow.provider = updated.provider;
  userRow.model = updated.model;
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
