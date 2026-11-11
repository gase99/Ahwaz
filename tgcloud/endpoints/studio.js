import { EndpointError } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  fetchLiveOpenRouterFreeModels,
  getProviderSpec,
  PROVIDER_HELP,
  PROVIDER_LINKS_TABLE,
} from '../lib/agent/providers.js';
import {
  buildUserProvidersSnapshot,
  deleteProviderCredentials,
  ensureUser,
  maskApiKey,
  resolveProviderAuth,
  saveProviderCredentials,
  saveUserGeminiKey,
  setActiveModel,
  setActiveProject,
  setActiveProviderAndModel,
} from '../lib/services/auth-service.js';
import { deliverProjectZip } from '../lib/services/command-service.js';
import { sendSafeText } from '../lib/services/delivery-service.js';
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
      const [projects, files, auth, providers] = await Promise.all([
        listProjects(userRow.tgId),
        listWorkspaceFiles(userRow.tgId, activeProject),
        resolveProviderAuth(userRow),
        buildUserProvidersSnapshot(userRow),
      ]);

      return {
        ok: true,
        user: {
          tgId: userRow.tgId,
          firstName: userRow.firstName,
          isAdmin: Boolean(userRow.isAdmin),
          provider: auth.providerId,
          providerBadge: auth.providerSpec.shortBadge,
          model: auth.model,
          providerReady: auth.isReady,
          isProviderReady: auth.isReady,
          providerMissingReason: auth.missingReason,
          missingReason: auth.missingReason,
          providerKeyConfigured: Boolean(auth.apiKey),
          baseUrl: auth.baseUrl,
          promptCount: userRow.promptCount,
          toolCallCount: userRow.toolCallCount,
        },
        providers,
        providerHelp: Object.entries(PROVIDER_HELP).map(([id, help]) => ({
          id,
          ...help,
        })),
        linksTable: PROVIDER_LINKS_TABLE,
        activeProject,
        projects,
        files,
      };
    }

    case 'setProvider':
    case 'save_settings': {
      if (input?.geminiKey) {
        await saveUserGeminiKey(userRow, input.geminiKey);
        const chosenModel = input?.model ? String(input.model).trim() : 'gemini-2.5-pro';
        if (input?.model) {
          await setActiveModel(userRow.tgId, chosenModel);
          userRow.model = chosenModel;
        }
        const providers = await buildUserProvidersSnapshot(userRow);
        return { ok: true, provider: 'gemini', model: chosenModel, providers };
      }

      const providerId = String(input?.providerId || userRow.provider || 'opencode');
      const spec = getProviderSpec(providerId);
      const hasNewKey =
        typeof input?.apiKey === 'string' && input.apiKey.trim().length > 0;
      const hasNewUrl =
        typeof input?.baseUrl === 'string' && input.baseUrl.trim().length > 0;

      if (hasNewKey || hasNewUrl) {
        await saveProviderCredentials(userRow, spec.id, {
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
        });
      }

      const updated = await setActiveProviderAndModel(
        userRow.tgId,
        spec.id,
        input?.model ? String(input.model) : null,
      );
      userRow.provider = updated.provider;
      userRow.model = updated.model;

      const [auth, providers] = await Promise.all([
        resolveProviderAuth(userRow),
        buildUserProvidersSnapshot(userRow),
      ]);

      if (input?.notifyChat && (hasNewKey || hasNewUrl)) {
        const masked = hasNewKey ? maskApiKey(input.apiKey) : '';
        await sendSafeText(
          userRow.tgId,
          [
            `🔐 تنظیمات سرویس **${spec.shortBadge}** از طریق **Mini App** ذخیره و همگام شد!`,
            ...(masked ? [`• کلید ثبت‌شده: \`${masked}\``] : []),
            ...(hasNewUrl ? [`• آدرس سرور: \`${input.baseUrl.trim()}\``] : []),
            `• مدل فعال فعلی: \`${updated.model}\``,
          ].join('\n'),
        ).catch(() => undefined);
      }

      return {
        ok: true,
        ...updated,
        isReady: auth.isReady,
        missingReason: auth.missingReason,
        providers,
      };
    }

    case 'deleteKey':
    case 'delete_key': {
      const providerId = String(input?.providerId || '').trim();
      const spec = getProviderSpec(providerId);
      await deleteProviderCredentials(userRow, spec.id);

      const [auth, providers] = await Promise.all([
        resolveProviderAuth(userRow),
        buildUserProvidersSnapshot(userRow),
      ]);

      if (input?.notifyChat) {
        await sendSafeText(
          userRow.tgId,
          `🗑️ کلید ذخیره‌شده سرویس **${spec.shortBadge}** از طریق **Mini App** حذف شد.\n🌐 سرویس فعال فعلی: **${auth.providerSpec.shortBadge}** (\`${auth.model}\`)`,
        ).catch(() => undefined);
      }

      return {
        ok: true,
        provider: auth.providerId,
        model: auth.model,
        isReady: auth.isReady,
        providers,
      };
    }

    case 'syncOpenCodeModels': {
      const auth = await resolveProviderAuth(userRow, 'opencode');
      const models = await fetchLiveOpenCodeFreeModels(auth.apiKey);
      return { ok: true, models };
    }

    case 'syncOpenRouterModels': {
      const auth = await resolveProviderAuth(userRow, 'openrouter');
      const models = await fetchLiveOpenRouterFreeModels(auth.apiKey);
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
      return { ok: true, saved: true, path: saved.path, files };
    }

    case 'deleteFile':
    case 'delete_file': {
      const deleted = await deleteWorkspacePath(
        userRow.tgId,
        activeProject,
        input?.path || '',
      );
      const files = await listWorkspaceFiles(userRow.tgId, activeProject);
      return { ok: true, deleted, files };
    }

    case 'switchProject':
    case 'switch_project': {
      const name = sanitizeProjectName(input?.projectName || 'default');
      await ensureProject(userRow.tgId, name);
      await setActiveProject(userRow.tgId, name);
      const [projects, files] = await Promise.all([
        listProjects(userRow.tgId),
        listWorkspaceFiles(userRow.tgId, name),
      ]);
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
