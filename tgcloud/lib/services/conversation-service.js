import db, { and, eq } from 'sdk/db';
import { chatHistories } from '../../schema.js';
import { normalizeHistoryTurns } from '../agent/llm-router.js';
import { sanitizeProjectName } from './workspace-service.js';

const MAX_HISTORY_TURNS = 36;

export function trimHistorySafely(contents, maxEntries = MAX_HISTORY_TURNS) {
  const normalized = normalizeHistoryTurns(contents);
  if (normalized.length <= maxEntries) return [...normalized];

  let startIdx = normalized.length - maxEntries;
  while (startIdx < normalized.length) {
    if (normalized[startIdx]?.role === 'user') break;
    startIdx += 1;
  }
  return normalized.slice(startIdx);
}

export async function getConversationHistory(tgId, projectName) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const row = await db
    .select()
    .from(chatHistories)
    .where(and(eq(chatHistories.tgId, uid), eq(chatHistories.projectName, safeProject)))
    .get();

  if (!row || !Array.isArray(row.messages)) return [];
  return normalizeHistoryTurns(row.messages);
}

export async function saveConversationHistory(tgId, projectName, messages) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const trimmed = trimHistorySafely(messages, MAX_HISTORY_TURNS);
  const nowSec = Math.floor(Date.now() / 1000);

  const existing = await db
    .select()
    .from(chatHistories)
    .where(and(eq(chatHistories.tgId, uid), eq(chatHistories.projectName, safeProject)))
    .get();

  if (existing) {
    await db
      .update(chatHistories)
      .set({ messages: trimmed, updatedAt: nowSec })
      .where(eq(chatHistories.id, existing.id))
      .run();
  } else {
    await db
      .insert(chatHistories)
      .values({
        tgId: uid,
        projectName: safeProject,
        messages: trimmed,
        updatedAt: nowSec,
      })
      .run();
  }
}

export async function clearConversationHistory(tgId, projectName) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  await db
    .delete(chatHistories)
    .where(and(eq(chatHistories.tgId, uid), eq(chatHistories.projectName, safeProject)))
    .run();
}
