import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/agent/tools/index.js';
import { WorkspaceService } from '../src/services/workspace.service.js';
import type { ArtifactDelivery, ToolExecutionContext } from '../src/types/agent.js';

describe('Agent Tools (Filesystem, Executor, Git, Archive)', () => {
  let tempDir: string;
  let workspaceService: WorkspaceService;
  let registry: ToolRegistry;
  let projectRoot: string;
  let queuedArtifacts: ArtifactDelivery[];
  let ctx: ToolExecutionContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-tools-test-'));
    workspaceService = new WorkspaceService(tempDir);
    await workspaceService.init();
    registry = new ToolRegistry(workspaceService);
    projectRoot = await workspaceService.ensureProject(555, 'calc-service');
    queuedArtifacts = [];

    ctx = {
      userId: 555,
      projectName: 'calc-service',
      projectRoot,
      enableShell: true,
      commandTimeoutMs: 10_000,
      gitAuthorName: 'Test Agent',
      gitAuthorEmail: 'test@ahwaz.local',
      queueArtifact: (a) => queuedArtifacts.push(a),
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes, reads, edits, searches, and deletes files safely', async () => {
    const writeRes = await registry.get('write_file')!.execute(
      {
        file_path: 'src/sum.ts',
        content: 'export function sum(a: number, b: number) {\n  return a - b;\n}\n',
      },
      ctx,
    );
    expect(writeRes).toHaveProperty('output');

    const editRes = await registry.get('edit_file')!.execute(
      {
        file_path: 'src/sum.ts',
        old_text: 'return a - b;',
        new_text: 'return a + b;',
      },
      ctx,
    );
    expect((editRes.output as Record<string, unknown>).status).toBe('updated');

    const readRes = await registry.get('read_file')!.execute({ file_path: 'src/sum.ts' }, ctx);
    expect((readRes.output as Record<string, unknown>).content).toContain('return a + b;');

    const searchRes = await registry.get('search_code')!.execute({ query: 'function sum' }, ctx);
    expect((searchRes.output as Record<string, unknown>).match_count).toBe(1);

    await registry.get('delete_path')!.execute({ target_path: 'src/sum.ts' }, ctx);
    const listRes = await registry.get('list_files')!.execute({}, ctx);
    expect((listRes.output as Record<string, unknown>).entries).not.toContain('src/sum.ts');
  });

  it('executes shell commands, strips sensitive env vars, and blocks dangerous commands', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'secret-bot-token-xyz';
    process.env.GEMINI_API_KEY = 'secret-gemini-key-xyz';

    const runTool = registry.get('run_command')!;
    const res = await runTool.execute(
      {
        command:
          'node -e "console.log(JSON.stringify({ tok: process.env.TELEGRAM_BOT_TOKEN || null, gem: process.env.GEMINI_API_KEY || null }))"',
      },
      ctx,
    );

    const out = res.output as { exit_code: number; stdout: string };
    expect(out.exit_code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ tok: null, gem: null });

    await expect(runTool.execute({ command: 'rm -rf /' }, ctx)).rejects.toThrow();
  });

  it('runs Git init, commit_all, status, and log cleanly and exports ZIP artifacts', async () => {
    await registry.get('write_file')!.execute(
      { file_path: 'README.md', content: '# Calc Service\n' },
      ctx,
    );

    const gitTool = registry.get('git_operation')!;
    const initRes = await gitTool.execute({ action: 'init' }, ctx);
    expect((initRes.output as { exitCode: number }).exitCode).toBe(0);

    const commitRes = await gitTool.execute(
      { action: 'commit_all', message: 'feat: initial commit' },
      ctx,
    );
    expect((commitRes.output as { exitCode: number }).exitCode).toBe(0);

    const logRes = await gitTool.execute({ action: 'log' }, ctx);
    expect((logRes.output as { stdout: string }).stdout).toContain('feat: initial commit');

    const zipRes = await registry.get('export_project_zip')!.execute({}, ctx);
    expect((zipRes.output as { files_included: number }).files_included).toBe(1);
    expect(queuedArtifacts).toHaveLength(1);
    await fs.rm(path.dirname(queuedArtifacts[0].filePath), { recursive: true, force: true });
  });
});
