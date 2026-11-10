import { EndpointError } from 'sdk';
import {
  ensureUser,
  resolveGeminiApiKey,
  resolveGithubToken,
  saveUserGeminiKey,
  saveUserGithubToken,
  setActiveModel,
  setActiveProject,
} from '../lib/services/auth-service.js';
import {
  deleteWorkspacePath,
  ensureProject,
  listProjects,
  listWorkspaceFiles,
  readWorkspaceFile,
  sanitizeProjectName,
  writeWorkspaceFile,
} from '../lib/services/workspace-service.js';

/**
 * Serverless Endpoint for the hosted Telegram Mini App Code Studio (`POST /api/studio`).
 * `ctx.initData.user` is cryptographically verified by the Telegram Serverless platform.
 */
export default async function (input, ctx) {
  const caller = ctx?.initData?.user;
  if (!caller || !caller.id) {
    throw new EndpointError('کاربر تلگرام احراز هویت نشد.', { code: 'UNAUTHORIZED' });
  }

  const userRow = await ensureUser(caller);
  if (!userRow.isAdmin && !userRow.isAllowed) {
    throw new EndpointError(`دسترسی شما مجاز نیست (ID: ${userRow.tgId}).`, {
      code: 'FORBIDDEN',
    });
  }

  const action = String(input?.action || 'bootstrap');

  switch (action) {
    case 'bootstrap': {
      const projectList = await listProjects(userRow.tgId);
      const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject);
      const hasGeminiKey = Boolean(await resolveGeminiApiKey(userRow));
      const hasGithubToken = Boolean(await resolveGithubToken(userRow));

      return {
        user: {
          tgId: userRow.tgId,
          firstName: userRow.firstName,
          isAdmin: userRow.isAdmin,
          activeProject: userRow.activeProject,
          model: userRow.model,
        },
        hasGeminiKey,
        hasGithubToken,
        projects: projectList,
        files,
      };
    }

    case 'switch_project': {
      const name = sanitizeProjectName(input?.projectName);
      await ensureProject(userRow.tgId, name);
      await setActiveProject(userRow.tgId, name);
      const files = await listWorkspaceFiles(userRow.tgId, name);
      const projectList = await listProjects(userRow.tgId);
      return { activeProject: name, projects: projectList, files };
    }

    case 'read_file': {
      const row = await readWorkspaceFile(
        userRow.tgId,
        userRow.activeProject,
        input?.path,
      );
      if (!row) {
        throw new EndpointError('فایل مورد نظر یافت نشد.', { code: 'NOT_FOUND' });
      }
      return { path: row.path, content: row.content, sizeBytes: row.sizeBytes };
    }

    case 'save_file': {
      const res = await writeWorkspaceFile(
        userRow.tgId,
        userRow.activeProject,
        input?.path,
        input?.content ?? '',
      );
      const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject);
      return { saved: res, files };
    }

    case 'delete_file': {
      const deleted = await deleteWorkspacePath(
        userRow.tgId,
        userRow.activeProject,
        input?.path,
      );
      const files = await listWorkspaceFiles(userRow.tgId, userRow.activeProject);
      return { deleted, files };
    }

    case 'save_settings': {
      if (typeof input?.geminiKey === 'string' && input.geminiKey.trim()) {
        await saveUserGeminiKey(userRow, input.geminiKey.trim());
      }
      if (typeof input?.githubToken === 'string' && input.githubToken.trim()) {
        await saveUserGithubToken(userRow, input.githubToken.trim());
      }
      if (typeof input?.model === 'string' && input.model.trim()) {
        await setActiveModel(userRow.tgId, input.model.trim());
      }
      return { ok: true };
    }

    default:
      throw new EndpointError(`عملیات نامعتبر: ${action}`, { code: 'BAD_ACTION' });
  }
}
