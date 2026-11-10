import type { Bot, Context } from 'grammy';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { WorkspaceService } from '../workspace.service.js';

export interface IngestedFileSummary {
  originalName: string;
  isZipExtracted: boolean;
  savedPaths: string[];
  sourceMode: 'local_volume' | 'http_download';
}

export function buildTelegramFileDownloadUrl(params: {
  filePath: string;
  apiRoot: string;
  botToken: string;
}): string {
  const cleanRoot = params.apiRoot.replace(/\/+$/, '');
  let relPath = params.filePath;

  // If Local Bot API Server returned an absolute path like /var/lib/telegram-bot-api/<token>/documents/file_1.zip,
  // extract the portion after `<token>/` for HTTP fallback when volumes aren't shared.
  const tokenSegment = `/${params.botToken}/`;
  const tokenIdx = relPath.indexOf(tokenSegment);
  if (tokenIdx !== -1) {
    relPath = relPath.slice(tokenIdx + tokenSegment.length);
  } else {
    relPath = relPath.replace(/^\/+/, '');
  }

  return `${cleanRoot}/file/bot${params.botToken}/${relPath}`;
}

export class TelegramFileIngestService {
  constructor(
    private readonly config: AppConfig,
    private readonly bot: Bot<Context>,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async ingestDocument(params: {
    userId: number;
    projectName: string;
    fileId: string;
    fileName?: string;
  }): Promise<IngestedFileSummary> {
    const projectRoot = await this.workspaceService.ensureProject(
      params.userId,
      params.projectName,
    );
    const tgFile = await this.bot.api.getFile(params.fileId);

    if (!tgFile.file_path) {
      throw new Error('مسیر فایل از سرور تلگرام دریافت نشد.');
    }

    const safeFileName = path.basename(params.fileName || path.basename(tgFile.file_path));
    let localTempFile: string | null = null;
    let effectiveSourcePath: string;
    let sourceMode: 'local_volume' | 'http_download' = 'http_download';

    try {
      // 1. Check direct zero-copy access on shared Local Telegram Bot API Server volume
      const candidatePaths = [tgFile.file_path];
      if (!path.isAbsolute(tgFile.file_path) && this.config.TELEGRAM_LOCAL_MODE) {
        candidatePaths.push(
          path.join(
            this.config.TELEGRAM_LOCAL_FILES_DIR,
            this.config.TELEGRAM_BOT_TOKEN,
            tgFile.file_path,
          ),
        );
      }

      let foundLocalPath: string | null = null;
      for (const candidate of candidatePaths) {
        if (path.isAbsolute(candidate)) {
          try {
            await fs.access(candidate);
            foundLocalPath = candidate;
            break;
          } catch {
            // Not accessible locally; fall back to HTTP download
          }
        }
      }

      if (foundLocalPath) {
        effectiveSourcePath = foundLocalPath;
        sourceMode = 'local_volume';
        logger.debug(
          { foundLocalPath, safeFileName },
          'خواندن مستقیم فایل از دیسک Local Telegram Bot API Server',
        );
      } else {
        const url = buildTelegramFileDownloadUrl({
          filePath: tgFile.file_path,
          apiRoot: this.config.TELEGRAM_API_ROOT,
          botToken: this.config.TELEGRAM_BOT_TOKEN,
        });
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`خطا در دانلود فایل از سرور Bot API (${response.status})`);
        }
        const arrayBuf = await response.arrayBuffer();
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwaz-dl-'));
        localTempFile = path.join(tmpDir, safeFileName);
        await fs.writeFile(localTempFile, Buffer.from(arrayBuf));
        effectiveSourcePath = localTempFile;
      }

      // 2. If .zip archive -> extract safely into project workspace
      if (safeFileName.toLowerCase().endsWith('.zip')) {
        const extracted = await this.workspaceService.extractZipIntoProject(
          projectRoot,
          effectiveSourcePath,
        );
        return {
          originalName: safeFileName,
          isZipExtracted: true,
          savedPaths: extracted,
          sourceMode,
        };
      }

      // 3. Regular code/text/binary file -> copy safely into active workspace root
      const destPath = WorkspaceService.resolveSafePath(projectRoot, safeFileName);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(effectiveSourcePath, destPath);

      return {
        originalName: safeFileName,
        isZipExtracted: false,
        savedPaths: [safeFileName],
        sourceMode,
      };
    } finally {
      if (localTempFile) {
        await fs.rm(path.dirname(localTempFile), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
