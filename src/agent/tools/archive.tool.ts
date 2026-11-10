import { Type } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceService } from '../../services/workspace.service.js';
import type { AgentTool } from '../../types/agent.js';

export function createArchiveTools(workspaceService: WorkspaceService): AgentTool[] {
  const sendFileTool: AgentTool = {
    declaration: {
      name: 'send_file_to_telegram',
      description:
        'Send a specific file from the project workspace directly to the user in Telegram as a document attachment.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Relative path to the file inside the project workspace.',
          },
          caption: {
            type: Type.STRING,
            description: 'Optional short caption describing the file.',
          },
        },
        required: ['file_path'],
      },
    },
    formatProgress: (args) => `📤 آماده‌سازی ارسال فایل ${String(args.file_path ?? '')}`,
    execute: async (args, ctx) => {
      const relPath = String(args.file_path ?? '');
      const fullPath = WorkspaceService.resolveSafePath(ctx.projectRoot, relPath);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        return { error: `مسیر ${relPath} یک فایل معتبر نیست.` };
      }

      ctx.queueArtifact({
        filePath: fullPath,
        fileName: path.basename(fullPath),
        caption: typeof args.caption === 'string' ? args.caption : undefined,
      });

      return {
        output: {
          queued_for_telegram: relPath,
          size_bytes: stat.size,
        },
      };
    },
  };

  const exportZipTool: AgentTool = {
    declaration: {
      name: 'export_project_zip',
      description:
        'Package the active project workspace (or a subdirectory) into a .zip archive and send it directly to the user in Telegram.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          sub_path: {
            type: Type.STRING,
            description: 'Optional subdirectory to zip (defaults to ".").',
          },
          caption: {
            type: Type.STRING,
            description: 'Optional caption for the exported ZIP archive.',
          },
        },
      },
    },
    formatProgress: () => '📦 بسته‌بندی پروژه به صورت فایل ZIP',
    execute: async (args, ctx) => {
      const subPath = typeof args.sub_path === 'string' ? args.sub_path : '.';
      const { zipPath, entryCount } = await workspaceService.createProjectZip(
        ctx.userId,
        ctx.projectName,
        subPath,
      );

      if (entryCount === 0) {
        return { error: 'پروژه خالی است و فایلی برای فشرده‌سازی وجود ندارد.' };
      }

      ctx.queueArtifact({
        filePath: zipPath,
        fileName: `${ctx.projectName}.zip`,
        caption:
          typeof args.caption === 'string'
            ? args.caption
            : `📦 خروجی پروژه «${ctx.projectName}» (${entryCount} فایل)`,
      });

      return {
        output: {
          zip_queued: `${ctx.projectName}.zip`,
          files_included: entryCount,
        },
      };
    },
  };

  return [sendFileTool, exportZipTool];
}
