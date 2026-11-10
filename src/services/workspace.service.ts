import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'coverage',
]);

export interface ProjectInfo {
  name: string;
  rootPath: string;
  fileCount: number;
  updatedAt: Date;
}

export class WorkspaceService {
  constructor(private readonly workspacesRoot: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.workspacesRoot, { recursive: true });
  }

  sanitizeProjectName(name: string): string {
    const trimmed = name.trim();
    if (!PROJECT_NAME_REGEX.test(trimmed)) {
      throw new Error(
        `نام پروژه «${name}» معتبر نیست. فقط حروف انگلیسی، اعداد و کاراکترهای - _ . مجاز هستند (۱ تا ۶۳ کاراکتر).`,
      );
    }
    return trimmed;
  }

  getUserRoot(userId: number): string {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error(`شناسه کاربر نامعتبر است: ${userId}`);
    }
    return path.resolve(this.workspacesRoot, String(userId));
  }

  getProjectRoot(userId: number, projectName: string): string {
    const safeName = this.sanitizeProjectName(projectName);
    const userRoot = this.getUserRoot(userId);
    const projectRoot = path.resolve(userRoot, safeName);
    if (!projectRoot.startsWith(userRoot + path.sep)) {
      throw new Error('مسیر پروژه خارج از محدوده مجاز است.');
    }
    return projectRoot;
  }

  async ensureProject(userId: number, projectName: string): Promise<string> {
    const projectRoot = this.getProjectRoot(userId, projectName);
    await fs.mkdir(projectRoot, { recursive: true });
    return projectRoot;
  }

  /**
   * Resolves a user/agent-supplied relative path safely inside projectRoot.
   * Blocks `..` path traversal and symlink escapes.
   */
  static resolveSafePath(projectRoot: string, targetPath = '.'): string {
    const normalizedRoot = path.resolve(projectRoot);
    const cleanedTarget = targetPath.trim() === '' ? '.' : targetPath;
    const candidate = path.resolve(normalizedRoot, cleanedTarget);

    if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) {
      throw new Error(`دسترسی غیرمجاز خارج از فضای پروژه مسدود شد: ${targetPath}`);
    }

    // Verify realpath of closest existing ancestor to prevent symlink escapes
    let probe = candidate;
    while (!fsSync.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }

    if (fsSync.existsSync(probe) && fsSync.existsSync(normalizedRoot)) {
      const realRoot = fsSync.realpathSync(normalizedRoot);
      const realProbe = fsSync.realpathSync(probe);
      if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
        throw new Error(`دسترسی از طریق Symlink خارج از فضای پروژه مسدود شد: ${targetPath}`);
      }
    }

    return candidate;
  }

  async listProjects(userId: number): Promise<ProjectInfo[]> {
    const userRoot = this.getUserRoot(userId);
    await fs.mkdir(userRoot, { recursive: true });
    const entries = await fs.readdir(userRoot, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_NAME_REGEX.test(entry.name)) continue;
      const rootPath = path.join(userRoot, entry.name);
      const stat = await fs.stat(rootPath);
      const files = await this.listFilesRelative(rootPath, { maxEntries: 500 });
      projects.push({
        name: entry.name,
        rootPath,
        fileCount: files.length,
        updatedAt: stat.mtime,
      });
    }

    projects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return projects;
  }

  async deleteProject(userId: number, projectName: string): Promise<void> {
    const projectRoot = this.getProjectRoot(userId, projectName);
    await fs.rm(projectRoot, { recursive: true, force: true });
  }

  async listFilesRelative(
    projectRoot: string,
    options?: { subPath?: string; includeIgnored?: boolean; maxEntries?: number },
  ): Promise<string[]> {
    const baseDir = WorkspaceService.resolveSafePath(projectRoot, options?.subPath ?? '.');
    const includeIgnored = options?.includeIgnored ?? false;
    const maxEntries = options?.maxEntries ?? 300;
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxEntries) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (results.length >= maxEntries) break;
        if (!includeIgnored && DEFAULT_IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(projectRoot, fullPath).split(path.sep).join('/');

        if (entry.isDirectory()) {
          results.push(`${rel}/`);
          await walk(fullPath);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    };

    await walk(baseDir);
    return results;
  }

  /**
   * Packages the project workspace into a clean .zip archive (excluding heavy build/dependency folders).
   */
  async createProjectZip(
    userId: number,
    projectName: string,
    subPath = '.',
  ): Promise<{ zipPath: string; entryCount: number }> {
    const projectRoot = await this.ensureProject(userId, projectName);
    const targetDir = WorkspaceService.resolveSafePath(projectRoot, subPath);

    const zip = new AdmZip();
    let entryCount = 0;

    const addRecursively = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(currentDir, entry.name);
        const relDir = path.relative(targetDir, currentDir).split(path.sep).join('/');

        if (entry.isDirectory()) {
          await addRecursively(fullPath);
        } else if (entry.isFile()) {
          const content = await fs.readFile(fullPath);
          const zipEntryPath = relDir ? `${relDir}/${entry.name}` : entry.name;
          zip.addFile(zipEntryPath, content);
          entryCount += 1;
        }
      }
    };

    await addRecursively(targetDir);

    const tmpOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-zip-'));
    const safeName = this.sanitizeProjectName(projectName);
    const zipPath = path.join(tmpOutDir, `${safeName}.zip`);
    await zip.writeZipPromise(zipPath);

    return { zipPath, entryCount };
  }

  /**
   * Safely extracts an uploaded .zip archive into the project workspace with Zip-Slip protection.
   */
  async extractZipIntoProject(
    projectRoot: string,
    zipFilePath: string,
    targetSubDir = '.',
  ): Promise<string[]> {
    const destRoot = WorkspaceService.resolveSafePath(projectRoot, targetSubDir);
    await fs.mkdir(destRoot, { recursive: true });

    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();
    const extractedFiles: string[] = [];

    for (const entry of entries) {
      const rawName = entry.rawEntryName
        ? entry.rawEntryName.toString('utf8').replace(/\\/g, '/')
        : entry.entryName.replace(/\\/g, '/');
      if (!rawName || rawName.startsWith('__MACOSX/')) continue;

      const resolvedDest = WorkspaceService.resolveSafePath(destRoot, rawName);
      if (entry.isDirectory) {
        await fs.mkdir(resolvedDest, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
        await fs.writeFile(resolvedDest, entry.getData());
        extractedFiles.push(path.relative(projectRoot, resolvedDest).split(path.sep).join('/'));
      }
    }

    return extractedFiles;
  }
}
