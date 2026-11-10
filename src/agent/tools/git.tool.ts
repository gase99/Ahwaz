import { Type } from '@google/genai';
import { spawn } from 'node:child_process';
import { WorkspaceService } from '../../services/workspace.service.js';
import type { AgentTool } from '../../types/agent.js';

export async function execGit(options: {
  gitArgs: string[];
  cwd: string;
  authorName: string;
  authorEmail: string;
  githubToken?: string;
  abortSignal?: AbortSignal;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const { gitArgs, cwd, authorName, authorEmail, githubToken, abortSignal } = options;

  const finalArgs: string[] = [];
  if (githubToken && githubToken.trim().length > 0) {
    const basicAuth = Buffer.from(`x-access-token:${githubToken.trim()}`).toString('base64');
    finalArgs.push(
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicAuth}`,
    );
  }
  finalArgs.push(...gitArgs);

  return new Promise((resolve, reject) => {
    const child = spawn('git', finalArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const onAbort = () => child.kill('SIGKILL');
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      abortSignal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      abortSignal?.removeEventListener('abort', onAbort);
      const redact = (text: string) =>
        githubToken && githubToken.trim()
          ? text.split(githubToken.trim()).join('***REDACTED***')
          : text;
      resolve({
        exitCode: code,
        stdout: redact(stdout.trim()).slice(0, 10_000),
        stderr: redact(stderr.trim()).slice(0, 10_000),
      });
    });
  });
}

export function createGitTools(): AgentTool[] {
  const gitOperationTool: AgentTool = {
    declaration: {
      name: 'git_operation',
      description:
        'Run structured Git operations inside the active project workspace (init, status, diff, log, clone, checkout, create_branch, commit_all, pull, push).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            enum: [
              'init',
              'status',
              'diff',
              'log',
              'clone',
              'checkout',
              'create_branch',
              'commit_all',
              'pull',
              'push',
            ],
            description: 'Git action to execute.',
          },
          repo_url: {
            type: Type.STRING,
            description: 'Repository HTTPS URL (required when action is "clone").',
          },
          branch: {
            type: Type.STRING,
            description: 'Branch name (used for checkout, create_branch, clone, pull, push).',
          },
          message: {
            type: Type.STRING,
            description: 'Commit message (required when action is "commit_all").',
          },
          sub_dir: {
            type: Type.STRING,
            description: 'Optional relative path inside workspace.',
          },
        },
        required: ['action'],
      },
    },
    formatProgress: (args) => `🌿 عملیات Git: ${String(args.action ?? '')}`,
    execute: async (args, ctx) => {
      const action = String(args.action ?? '');
      const cwd = WorkspaceService.resolveSafePath(
        ctx.projectRoot,
        typeof args.sub_dir === 'string' ? args.sub_dir : '.',
      );

      const run = (gitArgs: string[]) =>
        execGit({
          gitArgs,
          cwd,
          authorName: ctx.gitAuthorName,
          authorEmail: ctx.gitAuthorEmail,
          githubToken: ctx.githubToken,
          abortSignal: ctx.abortSignal,
        });

      switch (action) {
        case 'init': {
          const res = await run(['init', '-b', 'main']);
          return { output: res };
        }
        case 'status': {
          const res = await run(['status', '--short', '--branch']);
          return { output: res };
        }
        case 'diff': {
          const res = await run(['diff', '--stat', '-p']);
          return { output: res };
        }
        case 'log': {
          const res = await run(['log', '-n', '15', '--oneline', '--decorate']);
          return { output: res };
        }
        case 'clone': {
          const repoUrl = String(args.repo_url ?? '').trim();
          if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('http://')) {
            return { error: 'آدرس ریپوزیتوری (repo_url) باید با https:// شروع شود.' };
          }
          const cloneArgs = ['clone'];
          if (typeof args.branch === 'string' && args.branch.trim()) {
            cloneArgs.push('--branch', args.branch.trim());
          }
          cloneArgs.push(repoUrl, '.');
          const res = await run(cloneArgs);
          return { output: res };
        }
        case 'checkout': {
          const branch = String(args.branch ?? '').trim();
          if (!branch) return { error: 'پارامتر branch الزامی است.' };
          const res = await run(['checkout', branch]);
          return { output: res };
        }
        case 'create_branch': {
          const branch = String(args.branch ?? '').trim();
          if (!branch) return { error: 'پارامتر branch الزامی است.' };
          const res = await run(['checkout', '-b', branch]);
          return { output: res };
        }
        case 'commit_all': {
          const message = String(args.message ?? '').trim();
          if (!message) return { error: 'پیام کامیت (message) الزامی است.' };
          const addRes = await run(['add', '-A']);
          if (addRes.exitCode !== 0) return { output: addRes };
          const commitRes = await run(['commit', '-m', message]);
          return { output: commitRes };
        }
        case 'pull': {
          const pullArgs = ['pull'];
          if (typeof args.branch === 'string' && args.branch.trim()) {
            pullArgs.push('origin', args.branch.trim());
          }
          const res = await run(pullArgs);
          return { output: res };
        }
        case 'push': {
          const pushArgs = ['push', '-u', 'origin'];
          if (typeof args.branch === 'string' && args.branch.trim()) {
            pushArgs.push(args.branch.trim());
          } else {
            pushArgs.push('HEAD');
          }
          const res = await run(pushArgs);
          return { output: res };
        }
        default:
          return { error: `عملیات Git ناشناخته است: ${action}` };
      }
    },
  };

  return [gitOperationTool];
}
