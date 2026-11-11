import { utf8ToBytes } from '../services/binary-utils.js';
import {
  importGithubRepoToWorkspace,
  pushWorkspaceToGithub,
} from '../services/github-service.js';
import {
  deleteWorkspacePath,
  editWorkspaceFile,
  exportProjectZipBytes,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspaceCode,
  writeWorkspaceFile,
} from '../services/workspace-service.js';
import { verifyJavaScriptSnippet } from './js-sandbox.js';

export function createAgentTools() {
  return [
    {
      declaration: {
        name: 'list_files',
        description: 'List all files inside the active project workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sub_path: {
              type: 'STRING',
              description: 'Optional relative folder filter (e.g. "src").',
            },
          },
        },
      },
      formatProgress: (args) =>
        `📂 بررسی فایل‌های پروژه (${args.sub_path ? String(args.sub_path) : '.'})`,
      execute: async (args, ctx) => {
        const files = await listWorkspaceFiles(ctx.tgId, ctx.projectName, args.sub_path || '');
        return {
          output: {
            project: ctx.projectName,
            count: files.length,
            files,
          },
        };
      },
    },

    {
      declaration: {
        name: 'read_file',
        description: 'Read a file from the active project workspace with 1-based line numbers.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: {
              type: 'STRING',
              description: 'Relative file path inside the workspace.',
            },
            start_line: { type: 'INTEGER', description: 'Optional 1-based start line.' },
            end_line: { type: 'INTEGER', description: 'Optional 1-based inclusive end line.' },
          },
          required: ['file_path'],
        },
      },
      formatProgress: (args) => `📖 خواندن فایل ${String(args.file_path ?? '')}`,
      execute: async (args, ctx) => {
        const row = await readWorkspaceFile(ctx.tgId, ctx.projectName, args.file_path);
        if (!row) {
          return { error: `فایل ${args.file_path} در پروژه ${ctx.projectName} پیدا نشد.` };
        }
        const allLines = row.content.split('\n');
        const parsedStart = Number(args.start_line);
        const start = Number.isFinite(parsedStart)
          ? Math.min(allLines.length, Math.max(1, Math.floor(parsedStart)))
          : 1;
        const parsedEnd = Number(args.end_line);
        const end = Number.isFinite(parsedEnd) && parsedEnd > 0
          ? Math.min(allLines.length, Math.max(start, Math.floor(parsedEnd)))
          : Math.min(allLines.length, start + 499);
        const numbered = allLines
          .slice(start - 1, end)
          .map((line, i) => `${start + i}: ${line}`)
          .join('\n');

        return {
          output: {
            file_path: row.path,
            total_lines: allLines.length,
            shown_range: `${start}-${end}`,
            content: numbered,
          },
        };
      },
    },

    {
      declaration: {
        name: 'write_file',
        description: 'Create or overwrite a file in the active project workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: { type: 'STRING', description: 'Relative path of the file.' },
            content: { type: 'STRING', description: 'Full UTF-8 text content of the file.' },
          },
          required: ['file_path', 'content'],
        },
      },
      formatProgress: (args) => `✍️ نوشتن فایل ${String(args.file_path ?? '')}`,
      execute: async (args, ctx) => {
        const res = await writeWorkspaceFile(
          ctx.tgId,
          ctx.projectName,
          args.file_path,
          args.content,
        );
        return { output: res };
      },
    },

    {
      declaration: {
        name: 'edit_file',
        description:
          'Surgically edit an existing file by replacing `old_text` with `new_text`.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: { type: 'STRING', description: 'Relative path of the file.' },
            old_text: { type: 'STRING', description: 'Exact existing snippet to replace.' },
            new_text: { type: 'STRING', description: 'New replacement snippet.' },
          },
          required: ['file_path', 'old_text', 'new_text'],
        },
      },
      formatProgress: (args) => `🛠 ویرایش فایل ${String(args.file_path ?? '')}`,
      execute: async (args, ctx) => {
        const res = await editWorkspaceFile(
          ctx.tgId,
          ctx.projectName,
          args.file_path,
          args.old_text,
          args.new_text,
        );
        return { output: res };
      },
    },

    {
      declaration: {
        name: 'delete_path',
        description: 'Delete a file or directory prefix from the active project workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            target_path: { type: 'STRING', description: 'File path or directory prefix.' },
          },
          required: ['target_path'],
        },
      },
      formatProgress: (args) => `🗑 حذف مسیر ${String(args.target_path ?? '')}`,
      execute: async (args, ctx) => {
        const deleted = await deleteWorkspacePath(ctx.tgId, ctx.projectName, args.target_path);
        return { output: { deleted_count: deleted.length, deleted } };
      },
    },

    {
      declaration: {
        name: 'search_code',
        description: 'Search across all files in the active project workspace by text or regex.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search text or regex pattern.' },
            case_sensitive: { type: 'BOOLEAN', description: 'Case sensitive search.' },
          },
          required: ['query'],
        },
      },
      formatProgress: (args) => `🔍 جستجو در کدها برای «${String(args.query ?? '')}»`,
      execute: async (args, ctx) => {
        const matches = await searchWorkspaceCode(
          ctx.tgId,
          ctx.projectName,
          args.query,
          Boolean(args.case_sensitive),
        );
        return { output: { count: matches.length, matches } };
      },
    },

    {
      declaration: {
        name: 'verify_javascript',
        description:
          'Execute pure JavaScript code or unit assertions (`assert(cond, msg)` and `console.log(...)`) inside an isolated V8 sandbox to verify logic and algorithms.',
        parameters: {
          type: 'OBJECT',
          properties: {
            code: {
              type: 'STRING',
              description: 'Self-contained JS snippet or unit test assertions to execute.',
            },
          },
          required: ['code'],
        },
      },
      formatProgress: () => '⚡ تست و راستی‌آزمایی منطق JavaScript در سندباکس V8',
      execute: async (args) => {
        const res = await verifyJavaScriptSnippet(String(args.code ?? ''));
        return res.ok ? { output: res } : { error: res.error, output: res };
      },
    },

    {
      declaration: {
        name: 'send_file_to_chat',
        description:
          'Send a single file from the workspace directly to the user in Telegram chat.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: { type: 'STRING', description: 'Relative path of the file to send.' },
            caption: { type: 'STRING', description: 'Optional caption.' },
          },
          required: ['file_path'],
        },
      },
      formatProgress: (args) => `📤 آماده‌سازی ارسال فایل ${String(args.file_path ?? '')}`,
      execute: async (args, ctx) => {
        const row = await readWorkspaceFile(ctx.tgId, ctx.projectName, args.file_path);
        if (!row) return { error: `فایل ${args.file_path} یافت نشد.` };
        const fileName = row.path.split('/').pop() || 'file.txt';
        ctx.queueArtifact({
          bytes: utf8ToBytes(row.content),
          fileName,
          mimeType: 'text/plain; charset=utf-8',
          caption: args.caption ? String(args.caption) : `📄 ${row.path}`,
        });
        return { output: { queued: row.path, bytes: row.sizeBytes } };
      },
    },

    {
      declaration: {
        name: 'export_project_zip',
        description:
          'Package all files in the active project workspace into a .zip archive and send it directly to the user in Telegram.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caption: { type: 'STRING', description: 'Optional caption for the ZIP archive.' },
          },
        },
      },
      formatProgress: () => '📦 بسته‌بندی پروژه به صورت آرشیو ZIP',
      execute: async (args, ctx) => {
        const { zipBytes, count } = await exportProjectZipBytes(ctx.tgId, ctx.projectName);
        if (!zipBytes || count === 0) {
          return { error: 'پروژه خالی است و فایلی برای ساخت ZIP وجود ندارد.' };
        }
        ctx.queueArtifact({
          bytes: zipBytes,
          fileName: `${ctx.projectName}.zip`,
          mimeType: 'application/zip',
          caption: args.caption
            ? String(args.caption)
            : `📦 خروجی پروژه «${ctx.projectName}» شامل ${count} فایل`,
        });
        return { output: { zip_queued: `${ctx.projectName}.zip`, files_included: count } };
      },
    },

    {
      declaration: {
        name: 'github_import_repo',
        description:
          'Import source files from a GitHub repository (`owner/repo` or URL) directly into the active workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            repo: { type: 'STRING', description: 'GitHub repo (e.g. "owner/repo").' },
            branch: { type: 'STRING', description: 'Optional branch name.' },
          },
          required: ['repo'],
        },
      },
      formatProgress: (args) => `🌿 دریافت ریپوزیتوری GitHub (${String(args.repo ?? '')})`,
      execute: async (args, ctx) => {
        const res = await importGithubRepoToWorkspace({
          tgId: ctx.tgId,
          projectName: ctx.projectName,
          repoSpec: args.repo,
          branch: args.branch,
          githubToken: ctx.githubToken,
        });
        return { output: res };
      },
    },

    {
      declaration: {
        name: 'github_push_project',
        description:
          'Commit and push all files in the active project workspace to a GitHub repository branch using the configured GitHub token.',
        parameters: {
          type: 'OBJECT',
          properties: {
            repo: { type: 'STRING', description: 'GitHub repo (e.g. "owner/repo").' },
            branch: { type: 'STRING', description: 'Target branch (defaults to "main").' },
            commit_message: { type: 'STRING', description: 'Git commit message.' },
          },
          required: ['repo', 'commit_message'],
        },
      },
      formatProgress: (args) => `🚀 ارسال کامیت به GitHub (${String(args.repo ?? '')})`,
      execute: async (args, ctx) => {
        const res = await pushWorkspaceToGithub({
          tgId: ctx.tgId,
          projectName: ctx.projectName,
          repoSpec: args.repo,
          branch: args.branch || 'main',
          commitMessage: args.commit_message,
          githubToken: ctx.githubToken,
        });
        return { output: res };
      },
    },
  ];
}
