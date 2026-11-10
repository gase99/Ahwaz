import db, { and, asc, desc, eq } from 'sdk/db';
import { projects, workspaceFiles } from '../../schema.js';
import { utf8ByteLength } from './binary-utils.js';
import { createZipBytes, extractZipBytes } from './zip-service.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export function sanitizeProjectName(name) {
  const trimmed = String(name ?? '').trim();
  if (!PROJECT_NAME_RE.test(trimmed)) {
    throw new Error(
      `نام پروژه «${name}» معتبر نیست. فقط حروف انگلیسی، اعداد و - _ . مجاز است (۱ تا ۶۳ کاراکتر).`,
    );
  }
  return trimmed;
}

export function sanitizeFilePath(rawPath) {
  const normalized = String(rawPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!normalized || normalized === '.') {
    throw new Error('مسیر فایل نمی‌تواند خالی باشد.');
  }

  const segments = normalized.split('/');
  if (segments.length > 16) {
    throw new Error('عمق پوشه‌های مسیر بیش از حد مجاز است.');
  }

  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || /[\x00-\x1f\x7f]/.test(seg)) {
      throw new Error(`مسیر فایل نامعتبر یا غیرمجاز است: ${rawPath}`);
    }
  }

  return normalized;
}

export async function ensureProject(tgId, projectName, meta = {}) {
  const uid = Number(tgId);
  const safeName = sanitizeProjectName(projectName);
  const nowSec = Math.floor(Date.now() / 1000);

  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.tgId, uid), eq(projects.name, safeName)))
    .get();

  if (existing) {
    if (meta.githubRepo) {
      await db
        .update(projects)
        .set({
          githubRepo: meta.githubRepo,
          githubBranch: meta.githubBranch || existing.githubBranch || 'main',
          updatedAt: nowSec,
        })
        .where(eq(projects.id, existing.id))
        .run();
    }
    return existing;
  }

  await db
    .insert(projects)
    .values({
      tgId: uid,
      name: safeName,
      description: meta.description || '',
      githubRepo: meta.githubRepo || null,
      githubBranch: meta.githubBranch || 'main',
      updatedAt: nowSec,
    })
    .run();

  return await db
    .select()
    .from(projects)
    .where(and(eq(projects.tgId, uid), eq(projects.name, safeName)))
    .get();
}

export async function listProjects(tgId) {
  const uid = Number(tgId);
  await ensureProject(uid, 'default');
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.tgId, uid))
    .orderBy(desc(projects.updatedAt))
    .all();

  const out = [];
  for (const row of rows) {
    const fileCount = await db.$count(
      workspaceFiles,
      and(eq(workspaceFiles.tgId, uid), eq(workspaceFiles.projectName, row.name)),
    );
    out.push({
      ...row,
      fileCount,
    });
  }
  return out;
}

export async function listWorkspaceFiles(tgId, projectName, subPath = '') {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const rows = await db
    .select({
      path: workspaceFiles.path,
      sizeBytes: workspaceFiles.sizeBytes,
      updatedAt: workspaceFiles.updatedAt,
    })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.tgId, uid), eq(workspaceFiles.projectName, safeProject)))
    .orderBy(asc(workspaceFiles.path))
    .all();

  const prefix = String(subPath ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!prefix || prefix === '.') {
    return rows;
  }
  return rows.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`));
}

export async function readWorkspaceFile(tgId, projectName, filePath) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const safePath = sanitizeFilePath(filePath);

  return await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.tgId, uid),
        eq(workspaceFiles.projectName, safeProject),
        eq(workspaceFiles.path, safePath),
      ),
    )
    .get();
}

export async function writeWorkspaceFile(tgId, projectName, filePath, content) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const safePath = sanitizeFilePath(filePath);
  const strContent = String(content ?? '');
  const sizeBytes = utf8ByteLength(strContent);
  const nowSec = Math.floor(Date.now() / 1000);

  await ensureProject(uid, safeProject);

  const existing = await readWorkspaceFile(uid, safeProject, safePath);
  if (existing) {
    await db
      .update(workspaceFiles)
      .set({
        content: strContent,
        sizeBytes,
        updatedAt: nowSec,
      })
      .where(eq(workspaceFiles.id, existing.id))
      .run();
  } else {
    await db
      .insert(workspaceFiles)
      .values({
        tgId: uid,
        projectName: safeProject,
        path: safePath,
        content: strContent,
        sizeBytes,
        updatedAt: nowSec,
      })
      .run();
  }

  await db
    .update(projects)
    .set({ updatedAt: nowSec })
    .where(and(eq(projects.tgId, uid), eq(projects.name, safeProject)))
    .run();

  return { path: safePath, sizeBytes, lines: strContent.split('\n').length };
}

export async function editWorkspaceFile(tgId, projectName, filePath, oldText, newText) {
  const row = await readWorkspaceFile(tgId, projectName, filePath);
  if (!row) {
    throw new Error(`فایل ${filePath} در پروژه ${projectName} یافت نشد.`);
  }
  const needle = String(oldText ?? '');
  if (!needle || !row.content.includes(needle)) {
    throw new Error(`قطعه کد مورد نظر (old_text) در فایل ${filePath} پیدا نشد.`);
  }
  const updated = row.content.replace(needle, () => String(newText ?? ''));
  return await writeWorkspaceFile(tgId, projectName, filePath, updated);
}

export async function deleteWorkspacePath(tgId, projectName, targetPath) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const safePath = sanitizeFilePath(targetPath);

  const allFiles = await db
    .select({ id: workspaceFiles.id, path: workspaceFiles.path })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.tgId, uid), eq(workspaceFiles.projectName, safeProject)))
    .all();

  const toDelete = allFiles.filter(
    (f) => f.path === safePath || f.path.startsWith(`${safePath}/`),
  );

  for (const item of toDelete) {
    await db.delete(workspaceFiles).where(eq(workspaceFiles.id, item.id)).run();
  }

  return toDelete.map((d) => d.path);
}

export async function searchWorkspaceCode(tgId, projectName, query, caseSensitive = false) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  const rows = await db
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.tgId, uid), eq(workspaceFiles.projectName, safeProject)))
    .orderBy(asc(workspaceFiles.path))
    .all();

  let regex;
  try {
    regex = new RegExp(String(query), caseSensitive ? '' : 'i');
  } catch {
    const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, caseSensitive ? '' : 'i');
  }

  const matches = [];
  for (const file of rows) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({
          file: file.path,
          line: i + 1,
          snippet: lines[i].slice(0, 220),
        });
        if (matches.length >= 80) return matches;
      }
    }
  }
  return matches;
}

export async function getAllProjectFilesWithContent(tgId, projectName) {
  const uid = Number(tgId);
  const safeProject = sanitizeProjectName(projectName);
  return await db
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.tgId, uid), eq(workspaceFiles.projectName, safeProject)))
    .orderBy(asc(workspaceFiles.path))
    .all();
}

export async function exportProjectZipBytes(tgId, projectName) {
  const files = await getAllProjectFilesWithContent(tgId, projectName);
  if (files.length === 0) {
    return { zipBytes: null, count: 0 };
  }
  const zipBytes = createZipBytes(
    files.map((f) => ({ path: f.path, content: f.content })),
  );
  return { zipBytes, count: files.length };
}

export async function importZipIntoWorkspace(tgId, projectName, zipBytes) {
  const extracted = await extractZipBytes(zipBytes);
  const savedPaths = [];
  for (const item of extracted) {
    await writeWorkspaceFile(tgId, projectName, item.path, item.content);
    savedPaths.push(item.path);
  }
  return savedPaths;
}
