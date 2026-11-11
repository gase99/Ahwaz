import { EndpointError } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  PROVIDER_LIST,
  PROVIDER_HELP,
} from '../lib/agent/providers.js';
import {
  ensureUser,
  resolveProviderAuth,
  saveProviderCredentials,
  saveUserGeminiKey,
  setActiveModel,
  setActiveProject,
  setActiveProviderAndModel,
} from '../lib/services/auth-service.js';
import { deliverProjectZip } from '../lib/services/command-service.js';
import {
  deleteWorkspacePath,
  ensureProject,
  listProjects,
  listWorkspaceFiles,
  readWorkspaceFile,
  sanitizeProjectName,
  writeWorkspaceFile,
} from '../lib/services/workspace-service.js';

export default async function studioEndpoint(input, ctx) {
  const caller = ctx?.initData?.user;
  if (!caller || !caller.id) {
    throw new EndpointError('لطفاً استودیو کدنویسی را از داخل تلگرام باز کنید.', {
      code: 'UNAUTHORIZED',
    });
  }

  const userRow = await ensureUser(caller);
  if (!userRow.isAdmin && !userRow.isAllowed) {
    throw new EndpointError('حساب کاربری شما توسط ادمین تایید نشده است.', {
      code: 'FORBIDDEN',
    });
  }

  const action = input?.action || 'state';
  const activeProject = userRow.activeProject || 'default';

  switch (action) {
    case 'state':
    case 'bootstrap': {
      await ensureProject(userRow.tgId, activeProject);
      const projects = await listProjects(userRow.tgId);
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      const auth = await resolveProviderAuth(userRow);

      // وضعیت آمادگی هر سرویس (بدون نمایش کلید خود — فقط Boolean)
      const providerStatuses = await Promise.all(
        PROVIDER_LIST.map((spec) => resolveProviderAuth(userRow, spec.id)),
      );

      return {
        ok: true,
        user: {
          tgId: userRow.tgId,
          firstName: userRow.firstName,
          isAdmin: Boolean(userRow.isAdmin),
          provider: auth.providerId,
          model: auth.model,
          providerReady: auth.isReady,
          providerMissingReason: auth.missingReason,
          providerKeyConfigured: Boolean(auth.apiKey),
          baseUrl: auth.baseUrl,
        },
        providers: PROVIDER_LIST.map((spec, idx) => {
          const status = providerStatuses[idx];
          return {
            id: spec.id,
            title: spec.title,
            shortBadge: spec.shortBadge,
            protocol: spec.protocol,
            defaultBaseUrl: spec.defaultBaseUrl,
            defaultModel: spec.defaultModel,
            requiresKey: spec.requiresKey,
            requiresBaseUrl: spec.requiresBaseUrl,
            signupHint: spec.signupHint,
            models: spec.models,
            isReady: status.isReady,
            missingReason: status.missingReason,
            apiKeyConfigured: Boolean(status.apiKey),
          };
        }),
        providerHelp: Object.entries(PROVIDER_HELP).map(([id, help]) => ({
          id,
          ...help,
        })),
        activeProject,
        projects,
        files,
      };
    }

    case 'setProvider':
    case 'save_settings': {
      if (input?.geminiKey) {
        await saveUserGeminiKey(userRow, input.geminiKey);
        if (input?.model) {
          await setActiveModel(userRow.tgId, input.model);
        }
        return { ok: true, provider: 'gemini', model: input?.model || 'gemini-2.5-pro' };
      }

      const providerId = String(input?.providerId || userRow.provider || 'opencode');
      const model = input?.model ? String(input.model) : null;
      if (input?.apiKey || input?.baseUrl) {
        await saveProviderCredentials(userRow, providerId, {
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
        });
      }
      const updated = await setActiveProviderAndModel(userRow.tgId, providerId, model);
      return { ok: true, ...updated };
    }

    case 'syncOpenCodeModels': {
      const auth = await resolveProviderAuth(userRow, 'opencode');
      const models = await fetchLiveOpenCodeFreeModels(auth.apiKey);
      return { ok: true, models };
    }

    case 'readFile':
    case 'read_file': {
      const file = await readWorkspaceFile(userRow.tgId, activeProject, input?.path || '');
      if (!file) {
        throw new EndpointError('فایل مورد نظر یافت نشد.', { code: 'NOT_FOUND' });
      }
      return { ok: true, file };
    }

    case 'saveFile':
    case 'save_file': {
      const saved = await writeWorkspaceFile(
        userRow.tgId,
        activeProject,
        input?.path || '',
        input?.content ?? '',
      );
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      return { ok: true, path: saved.path, files };
    }

    case 'deleteFile':
    case 'delete_file': {
      await deleteWorkspacePath(userRow.tgId, activeProject, input?.path || '');
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      return { ok: true, files };
    }

    case 'switchProject':
    case 'switch_project': {
      const name = sanitizeProjectName(input?.projectName || 'default');
      await ensureProject(userRow.tgId, name);
      await setActiveProject(userRow.tgId, name);
      const projects = await listProjects(userRow.tgId);
      const files = await listWorkspaceFiles(userRow.tgId, name);
      return { ok: true, activeProject: name, projects, files };
    }

    case 'setModel':
    case 'set_model': {
      const model = String(input?.model || 'big-pickle');
      await setActiveModel(userRow.tgId, model);
      return { ok: true, model };
    }

    case 'exportZipToChat':
    case 'export_zip': {
      const res = await deliverProjectZip(userRow.tgId, userRow.tgId, activeProject);
      return { ok: true, ...res };
    }

    default:
      throw new EndpointError(`اکشن ناشناخته: ${action}`, { code: 'UNKNOWN_ACTION' });
  }
}
