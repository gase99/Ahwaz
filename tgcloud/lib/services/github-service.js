import { fetch } from 'sdk';
import { base64ToBytes, bytesToUtf8 } from './binary-utils.js';
import {
  ensureProject,
  getAllProjectFilesWithContent,
  writeWorkspaceFile,
} from './workspace-service.js';

const SKIP_IMPORT_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  'vendor/',
];

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp3',
  '.mp4',
]);

export function parseGithubRepoSpec(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = cleaned.split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      'فرمت ریپوزیتوری معتبر نیست. به صورت owner/repo یا https://github.com/owner/repo وارد کنید.',
    );
  }
  return `${parts[0]}/${parts[1]}`;
}

function buildHeaders(githubToken) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Ahwaz-Telegram-Serverless-Agent',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken && githubToken.trim()) {
    headers.Authorization = `Bearer ${githubToken.trim()}`;
  }
  return headers;
}

export async function importGithubRepoToWorkspace({
  tgId,
  projectName,
  repoSpec,
  branch,
  githubToken,
}) {
  const ownerRepo = parseGithubRepoSpec(repoSpec);
  const headers = buildHeaders(githubToken);

  let targetBranch = branch ? String(branch).trim() : '';
  if (!targetBranch) {
    const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`, { headers });
    if (!repoRes.ok) {
      throw new Error(`خطا در خواندن اطلاعات ریپو ${ownerRepo} (کد ${repoRes.status})`);
    }
    const repoInfo = await repoRes.json();
    targetBranch = repoInfo.default_branch || 'main';
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) {
    throw new Error(`خطا در دریافت درخت فایل‌های شاخه ${targetBranch} (کد ${treeRes.status})`);
  }

  const treeData = await treeRes.json();
  const candidates = (treeData.tree || []).filter((entry) => {
    if (entry.type !== 'blob' || !entry.path) return false;
    if (entry.size > 300_000) return false;
    if (SKIP_IMPORT_PREFIXES.some((p) => entry.path.startsWith(p))) return false;
    const dotIdx = entry.path.lastIndexOf('.');
    const ext = dotIdx !== -1 ? entry.path.slice(dotIdx).toLowerCase() : '';
    if (BINARY_EXTENSIONS.has(ext)) return false;
    return true;
  });

  const limited = candidates.slice(0, 65);
  await ensureProject(tgId, projectName, {
    githubRepo: ownerRepo,
    githubBranch: targetBranch,
  });

  const importedPaths = [];
  for (const blobEntry of limited) {
    const blobRes = await fetch(blobEntry.url, { headers });
    if (!blobRes.ok) continue;
    const blobJson = await blobRes.json();
    if (blobJson.encoding !== 'base64' || typeof blobJson.content !== 'string') continue;

    const rawBytes = base64ToBytes(blobJson.content);
    // Skip binary files containing NUL
    let hasNull = false;
    for (let i = 0; i < Math.min(rawBytes.length, 2048); i++) {
      if (rawBytes[i] === 0) {
        hasNull = true;
        break;
      }
    }
    if (hasNull) continue;

    const content = bytesToUtf8(rawBytes);
    await writeWorkspaceFile(tgId, projectName, blobEntry.path, content);
    importedPaths.push(blobEntry.path);
  }

  return {
    repo: ownerRepo,
    branch: targetBranch,
    importedCount: importedPaths.length,
    truncated: candidates.length > limited.length,
    files: importedPaths,
  };
}

export async function pushWorkspaceToGithub({
  tgId,
  projectName,
  repoSpec,
  branch = 'main',
  commitMessage = 'feat: update from Ahwaz Telegram Serverless Agent',
  githubToken,
}) {
  if (!githubToken || !githubToken.trim()) {
    throw new Error(
      'برای Push به GitHub ابتدا توکن خود را با دستور `/setgithub ghp_...` ثبت کنید.',
    );
  }

  const ownerRepo = parseGithubRepoSpec(repoSpec);
  const files = await getAllProjectFilesWithContent(tgId, projectName);
  if (files.length === 0) {
    throw new Error('پروژه فعلی خالی است و فایلی برای ارسال به GitHub وجود ندارد.');
  }

  const headers = {
    ...buildHeaders(githubToken),
    'Content-Type': 'application/json',
  };

  // 1. Resolve current branch HEAD commit SHA
  const refRes = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers },
  );
  if (!refRes.ok) {
    throw new Error(
      `شاخه «${branch}» در ریپوزیتوری ${ownerRepo} پیدا نشد یا دسترسی ندارید (کد ${refRes.status}).`,
    );
  }
  const refJson = await refRes.json();
  const latestCommitSha = refJson.object.sha;

  // 2. Get base tree SHA of current HEAD commit
  const commitRes = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/commits/${latestCommitSha}`,
    { headers },
  );
  if (!commitRes.ok) {
    throw new Error(`خطا در خواندن کامیت پایه در GitHub (کد ${commitRes.status}).`);
  }
  const commitJson = await commitRes.json();
  const baseTreeSha = commitJson.tree.sha;

  // 3. Create new tree with workspace files
  const newTreeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        content: f.content,
      })),
    }),
  });
  if (!newTreeRes.ok) {
    const errTxt = await newTreeRes.text();
    throw new Error(`خطا در ساخت درخت Git روی GitHub: ${errTxt.slice(0, 200)}`);
  }
  const newTreeJson = await newTreeRes.json();

  // 4. Create commit
  const createCommitRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeJson.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!createCommitRes.ok) {
    throw new Error(`خطا در ثبت کامیت روی GitHub (کد ${createCommitRes.status}).`);
  }
  const createdCommit = await createCommitRes.json();

  // 5. Advance branch reference
  const updateRefRes = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: createdCommit.sha,
        force: false,
      }),
    },
  );
  if (!updateRefRes.ok) {
    throw new Error(`خطا در به‌روزرسانی شاخه ${branch} روی GitHub (کد ${updateRefRes.status}).`);
  }

  await ensureProject(tgId, projectName, {
    githubRepo: ownerRepo,
    githubBranch: branch,
  });

  return {
    repo: ownerRepo,
    branch,
    commitSha: createdCommit.sha.slice(0, 7),
    commitUrl: createdCommit.html_url || `https://github.com/${ownerRepo}/commit/${createdCommit.sha}`,
    filesPushed: files.length,
  };
}
