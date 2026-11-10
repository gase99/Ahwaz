import { Type } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceService } from '../../services/workspace.service.js';
import type { AgentTool } from '../../types/agent.js';

const IGNORED_SEARCH_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  'coverage',
]);

export function createFilesystemTools(workspaceService: WorkspaceService): AgentTool[] {
  const listFilesTool: AgentTool = {
    declaration: {
      name: 'list_files',
      description:
        'List files and directories inside the active project workspace. Call this first to understand project structure.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          sub_path: {
            type: Type.STRING,
            description: 'Optional relative subdirectory path (defaults to ".").',
          },
          include_ignored: {
            type: Type.BOOLEAN,
            description: 'Whether to include ignored folders like dist/ or .git (default false).',
          },
        },
      },
    },
    formatProgress: (args) =>
      `📂 بررسی ساختار فایل‌ها (${typeof args.sub_path === 'string' ? args.sub_path : '.'})`,
    execute: async (args, ctx) => {
      const subPath = typeof args.sub_path === 'string' ? args.sub_path : '.';
      const includeIgnored = Boolean(args.include_ignored);
      const files = await workspaceService.listFilesRelative(ctx.projectRoot, {
        subPath,
        includeIgnored,
        maxEntries: 400,
      });
      return {
        output: {
          project: ctx.projectName,
          sub_path: subPath,
          count: files.length,
          entries: files,
        },
      };
    },
  };

  const readFileTool: AgentTool = {
    declaration: {
      name: 'read_file',
      description:
        'Read the UTF-8 contents of a file inside the project workspace, optionally specifying 1-based line ranges.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Relative path to the file inside the project workspace.',
          },
          start_line: {
            type: Type.INTEGER,
            description: 'Optional 1-based start line.',
          },
          end_line: {
            type: Type.INTEGER,
            description: 'Optional 1-based inclusive end line.',
          },
        },
        required: ['file_path'],
      },
    },
    formatProgress: (args) => `📖 خواندن فایل ${String(args.file_path ?? '')}`,
    execute: async (args, ctx) => {
      const relPath = String(args.file_path ?? '');
      const fullPath = WorkspaceService.resolveSafePath(ctx.projectRoot, relPath);
      const raw = await fs.readFile(fullPath, 'utf8');
      const allLines = raw.split('\n');
      const start = Math.max(1, Number(args.start_line ?? 1));
      const end = Math.min(
        allLines.length,
        args.end_line !== undefined ? Number(args.end_line) : Math.min(allLines.length, start + 499),
      );
      const numbered = allLines
        .slice(start - 1, end)
        .map((line, idx) => `${start + idx}: ${line}`)
        .join('\n');

      return {
        output: {
          file_path: relPath,
          total_lines: allLines.length,
          shown_range: `${start}-${end}`,
          content: numbered,
        },
      };
    },
  };

  const writeFileTool: AgentTool = {
    declaration: {
      name: 'write_file',
      description:
        'Create a new file or completely overwrite an existing file inside the project workspace. Parent directories are created automatically.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Relative path to the file to create or overwrite.',
          },
          content: {
            type: Type.STRING,
            description: 'Full UTF-8 content to write to the file.',
          },
        },
        required: ['file_path', 'content'],
      },
    },
    formatProgress: (args) => `✍️ نوشتن فایل ${String(args.file_path ?? '')}`,
    execute: async (args, ctx) => {
      const relPath = String(args.file_path ?? '');
      const content = String(args.content ?? '');
      const fullPath = WorkspaceService.resolveSafePath(ctx.projectRoot, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
      return {
        output: {
          file_path: relPath,
          bytes_written: Buffer.byteLength(content, 'utf8'),
          lines: content.split('\n').length,
        },
      };
    },
  };

  const editFileTool: AgentTool = {
    declaration: {
      name: 'edit_file',
      description:
        'Surgically edit an existing file by replacing an exact snippet (`old_text`) with `new_text`.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Relative path to the file to edit.',
          },
          old_text: {
            type: Type.STRING,
            description: 'Exact existing text snippet to find in the file.',
          },
          new_text: {
            type: Type.STRING,
            description: 'Replacement text snippet.',
          },
        },
        required: ['file_path', 'old_text', 'new_text'],
      },
    },
    formatProgress: (args) => `🛠 ویرایش فایل ${String(args.file_path ?? '')}`,
    execute: async (args, ctx) => {
      const relPath = String(args.file_path ?? '');
      const oldText = String(args.old_text ?? '');
      const newText = String(args.new_text ?? '');
      const fullPath = WorkspaceService.resolveSafePath(ctx.projectRoot, relPath);

      const current = await fs.readFile(fullPath, 'utf8');
      if (!oldText || !current.includes(oldText)) {
        return {
          error: `قطعه متن مورد نظر (old_text) در فایل ${relPath} پیدا نشد. ابتدا read_file را فراخوانی کنید.`,
        };
      }

      const updated = current.replace(oldText, () => newText);
      await fs.writeFile(fullPath, updated, 'utf8');
      return {
        output: {
          file_path: relPath,
          status: 'updated',
          new_line_count: updated.split('\n').length,
        },
      };
    },
  };

  const deletePathTool: AgentTool = {
    declaration: {
      name: 'delete_path',
      description: 'Delete a file or directory inside the active project workspace.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          target_path: {
            type: Type.STRING,
            description: 'Relative path to delete (cannot be ".").',
          },
        },
        required: ['target_path'],
      },
    },
    formatProgress: (args) => `🗑 حذف مسیر ${String(args.target_path ?? '')}`,
    execute: async (args, ctx) => {
      const relPath = String(args.target_path ?? '').trim();
      if (!relPath || relPath === '.' || relPath === '/') {
        return { error: 'امکان حذف ریشه اصلی پروژه از طریق این ابزار وجود ندارد.' };
      }
      const fullPath = WorkspaceService.resolveSafePath(ctx.projectRoot, relPath);
      if (fullPath === path.resolve(ctx.projectRoot)) {
        return { error: 'امکان حذف ریشه اصلی پروژه وجود ندارد.' };
      }
      await fs.rm(fullPath, { recursive: true, force: true });
      return { output: { deleted: relPath } };
    },
  };

  const searchCodeTool: AgentTool = {
    declaration: {
      name: 'search_code',
      description:
        'Search across text/code files in the project workspace for a string or regular expression pattern.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'Search text or regex pattern.',
          },
          sub_path: {
            type: Type.STRING,
            description: 'Optional subdirectory to scope the search.',
          },
          case_sensitive: {
            type: Type.BOOLEAN,
            description: 'Case sensitive matching (default false).',
          },
        },
        required: ['query'],
      },
    },
    formatProgress: (args) => `🔍 جستجو در کدها برای «${String(args.query ?? '')}»`,
    execute: async (args, ctx) => {
      const query = String(args.query ?? '');
      const subPath = typeof args.sub_path === 'string' ? args.sub_path : '.';
      const caseSensitive = Boolean(args.case_sensitive);
      const baseDir = WorkspaceService.resolveSafePath(ctx.projectRoot, subPath);

      let regex: RegExp;
      try {
        regex = new RegExp(query, caseSensitive ? '' : 'i');
      } catch {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, caseSensitive ? '' : 'i');
      }

      const matches: Array<{ file: string; line: number; snippet: string }> = [];
      const maxMatches = 80;

      const scanDir = async (dir: string): Promise<void> => {
        if (matches.length >= maxMatches) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (matches.length >= maxMatches) break;
          if (IGNORED_SEARCH_DIRS.has(entry.name)) continue;
          const full = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await scanDir(full);
          } else if (entry.isFile()) {
            const stat = await fs.stat(full);
            if (stat.size > 1_000_000) continue; // skip >1MB binary/large files
            const buf = await fs.readFile(full);
            if (buf.includes(0)) continue; // skip binary files

            const lines = buf.toString('utf8').split('\n');
            const relFile = path.relative(ctx.projectRoot, full).split(path.sep).join('/');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push({
                  file: relFile,
                  line: i + 1,
                  snippet: lines[i].slice(0, 240),
                });
                if (matches.length >= maxMatches) break;
              }
            }
          }
        }
      };

      await scanDir(baseDir);
      return {
        output: {
          query,
          match_count: matches.length,
          truncated: matches.length >= maxMatches,
          matches,
        },
      };
    },
  };

  return [
    listFilesTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    deletePathTool,
    searchCodeTool,
  ];
}
