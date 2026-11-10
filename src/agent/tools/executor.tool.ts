import { Type } from '@google/genai';
import { spawn } from 'node:child_process';
import { WorkspaceService } from '../../services/workspace.service.js';
import type { AgentTool } from '../../types/agent.js';

const MAX_OUTPUT_CHARS = 12_000;

const BLOCKED_PATTERNS: RegExp[] = [
  /(?:^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i,
  /\bmkfs\b/i,
  /\b(?:shutdown|reboot|poweroff|halt)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

function sanitizeChildEnv(): NodeJS.ProcessEnv {
  const clone: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  delete clone.TELEGRAM_BOT_TOKEN;
  delete clone.TELEGRAM_API_ID;
  delete clone.TELEGRAM_API_HASH;
  delete clone.TELEGRAM_WEBHOOK_SECRET;
  delete clone.GEMINI_API_KEY;
  delete clone.GITHUB_TOKEN;
  return clone;
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return `${text.slice(0, half)}\n\n... [${text.length - MAX_OUTPUT_CHARS} کاراکتر خلاصه شد] ...\n\n${text.slice(-half)}`;
}

export async function runShellCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  extraEnv?: Record<string, string>;
}): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}> {
  const { command, cwd, timeoutMs, abortSignal, extraEnv } = options;

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.test(command)) {
      throw new Error('این دستور به دلایل امنیتی سیستم مسدود شده است.');
    }
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const isPosix = process.platform !== 'win32';
    const child = spawn('bash', ['-c', command], {
      cwd,
      env: { ...sanitizeChildEnv(), ...extraEnv },
      detached: isPosix,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let finished = false;

    const killTree = () => {
      if (!child.pid) return;
      try {
        if (isPosix) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // Process already exited
      }
    };

    const timer = setTimeout(() => {
      if (!finished) {
        timedOut = true;
        killTree();
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!finished) {
        aborted = true;
        killTree();
      }
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        killTree();
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout: '',
          stderr: 'اجرای دستور توسط کاربر لغو شد.',
          timedOut: false,
          aborted: true,
          durationMs: Date.now() - startTime,
        });
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      finished = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      finished = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code,
        stdout: truncateOutput(stdout.trim()),
        stderr: truncateOutput(stderr.trim()),
        timedOut,
        aborted,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

export function createExecutorTools(): AgentTool[] {
  const runCommandTool: AgentTool = {
    declaration: {
      name: 'run_command',
      description:
        'Execute a shell command (build, test, lint, python, node, npm, pytest, etc.) inside the active project workspace and return stdout/stderr/exitCode.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: {
            type: Type.STRING,
            description: 'Bash command to execute (non-interactive; do not start infinite servers).',
          },
          sub_dir: {
            type: Type.STRING,
            description: 'Optional relative working directory inside the project.',
          },
          timeout_seconds: {
            type: Type.INTEGER,
            description: 'Optional timeout in seconds (1 to 180).',
          },
        },
        required: ['command'],
      },
    },
    formatProgress: (args) => {
      const cmd = String(args.command ?? '').replace(/\s+/g, ' ').slice(0, 60);
      return `⚡ اجرای دستور: ${cmd}`;
    },
    execute: async (args, ctx) => {
      if (!ctx.enableShell) {
        return {
          error:
            'اجرای دستورات شل (ENABLE_SHELL_EXECUTION) در تنظیمات سرور غیرفعال شده است.',
        };
      }

      const command = String(args.command ?? '').trim();
      if (!command) {
        return { error: 'دستور خالی ارسال شده است.' };
      }

      const cwd = WorkspaceService.resolveSafePath(
        ctx.projectRoot,
        typeof args.sub_dir === 'string' ? args.sub_dir : '.',
      );

      const requestedTimeoutMs =
        typeof args.timeout_seconds === 'number' && args.timeout_seconds > 0
          ? Math.min(args.timeout_seconds * 1000, ctx.commandTimeoutMs)
          : ctx.commandTimeoutMs;

      const result = await runShellCommand({
        command,
        cwd,
        timeoutMs: requestedTimeoutMs,
        abortSignal: ctx.abortSignal,
      });

      return {
        output: {
          command,
          exit_code: result.exitCode,
          timed_out: result.timedOut,
          aborted: result.aborted,
          duration_ms: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    },
  };

  return [runCommandTool];
}
