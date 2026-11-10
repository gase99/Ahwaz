import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/services/workspace.service.js';

describe('WorkspaceService', () => {
  let tempDir: string;
  let service: WorkspaceService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-ws-test-'));
    service = new WorkspaceService(tempDir);
    await service.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('validates project names strictly and prevents traversal', () => {
    expect(service.sanitizeProjectName('my-app_v1.0')).toBe('my-app_v1.0');
    expect(() => service.sanitizeProjectName('../outside')).toThrow();
    expect(() => service.sanitizeProjectName('bad/name')).toThrow();
    expect(() => service.sanitizeProjectName('')).toThrow();
  });

  it('jails paths inside project root and blocks .. and symlink escapes', async () => {
    const projectRoot = await service.ensureProject(101, 'demo');
    const valid = WorkspaceService.resolveSafePath(projectRoot, 'src/index.ts');
    expect(valid).toBe(path.join(projectRoot, 'src/index.ts'));

    expect(() => WorkspaceService.resolveSafePath(projectRoot, '../../etc/passwd')).toThrow();

    // Symlink escape test
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-outside-'));
    try {
      const linkPath = path.join(projectRoot, 'evil-link');
      await fs.symlink(outsideDir, linkPath);
      expect(() => WorkspaceService.resolveSafePath(projectRoot, 'evil-link/secret.txt')).toThrow();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('creates clean project ZIPs excluding node_modules and blocks Zip-Slip on extract', async () => {
    const projectRoot = await service.ensureProject(202, 'webapp');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'node_modules/pkg'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src/app.ts'), 'export const x = 42;\n');
    await fs.writeFile(path.join(projectRoot, 'node_modules/pkg/index.js'), 'ignored');

    const { zipPath, entryCount } = await service.createProjectZip(202, 'webapp');
    expect(entryCount).toBe(1);

    const destProject = await service.ensureProject(202, 'imported');
    const extracted = await service.extractZipIntoProject(destProject, zipPath);
    expect(extracted).toEqual(['src/app.ts']);
    await fs.rm(path.dirname(zipPath), { recursive: true, force: true });

    // Malicious Zip-Slip archive check (crafting raw ZIP header with ../../)
    const evilZip = new AdmZip();
    evilZip.addFile('placeholder.txt', Buffer.from('nope'));
    evilZip.getEntries()[0].entryName = '../../pwned.txt';
    const evilZipPath = path.join(tempDir, 'evil.zip');
    await evilZip.writeZipPromise(evilZipPath);

    await expect(service.extractZipIntoProject(destProject, evilZipPath)).rejects.toThrow();
  });
});
