import { api } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  fetchLiveOpenRouterFreeModels,
  getProviderSpec,
  PROVIDER_HELP,
} from '../lib/agent/providers.js';
import {
  buildUserProvidersSnapshot,
  deleteProviderCredentials,
  ensureUser,
  getSetting,
  resolveProviderAuth,
  setActiveModel,
  setActiveProject,
  setActiveProviderAndModel,
} from '../lib/services/auth-service.js';
import {
  buildKeysDashboardReport,
  buildModelListReportText,
  deliverProjectZip,
} from '../lib/services/command-service.js';
import { clearConversationHistory } from '../lib/services/conversation-service.js';
import {
  markdownToTelegramHtml,
  sendSafeText,
} from '../lib/services/delivery-service.js';
import {
  buildGroupedModelsKeyboard,
  buildKeysManagementKeyboard,
  buildMainDashboardKeyboard,
  buildModelsKeyboard,
  buildProjectsKeyboard,
  buildProvidersKeyboard,
} from '../lib/services/keyboard-service.js';
import { testProviderConnection } from '../lib/services/key-test-service.js';
import { listProjects, listWorkspaceFiles } from '../lib/services/workspace-service.js';

export default async function handleCallbackQuery(query) {
  const data = query.data || '';
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;

  const answerToast = async (text = '') => {
    try {
      await api.answerCallbackQuery({
        callback_query_id: query.id,
        ...(text ? { text } : {}),
      });
    } catch {
      // Ignore expired callback query IDs
    }
  };

  if (!query.from || !chatId) {
    await answerToast();
    return;
  }

  const userRow = await ensureUser(query.from);
  if (!userRow.isAllowed) {
    await answerToast('⛔ حساب شما مجاز نیست.');
    return;
  }

  const activeProject = userRow.activeProject || 'default';
  const activeProvider = userRow.provider || 'opencode';
  const miniAppUrl = (await getSetting('mini_app_url')) || '';

  const safeEdit = async (text, replyMarkup) => {
    if (!messageId) {
      await sendSafeText(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
      return;
    }
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: markdownToTelegramHtml(text),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } catch (err) {
      const errMsg = String(err?.description ?? err?.message ?? '').toLowerCase();
      if (errMsg.includes('message is not modified')) {
        return;
      }
      await sendSafeText(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
    }
  };

  if (data === 'cb:home') {
    await answerToast();
    const auth = await resolveProviderAuth(userRow);
    await safeEdit(
      `🏠 داشبورد ایجنت کدنویسی اهواز (Telegram Serverless)\n🌐 سرویس فعال: ${auth.providerSpec.shortBadge}\n🧠 مدل فعال: ${auth.model}\n📁 پروژه فعال: ${activeProject}`,
      buildMainDashboardKeyboard(miniAppUrl),
    );
    return;
  }

  // `/keys` dashboard & inline Test / Delete actions
  if (data === 'cb:keys') {
    await answerToast();
    const report = await buildKeysDashboardReport(userRow);
    await safeEdit(
      report.text,
      buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
    );
    return;
  }

  if (data.startsWith('cb:ktest:')) {
    const provId = data.slice('cb:ktest:'.length);
    const spec = getProviderSpec(provId);
    const res = await testProviderConnection({ userRow, providerId: spec.id });
    await answerToast(
      res.success
        ? `✅ ${spec.shortBadge}: اتصال برقرار (${res.latency_ms}ms)`
        : `⚠️ ${spec.shortBadge}: تست ناموفق`,
    );
    const report = await buildKeysDashboardReport(userRow);
    const banner = res.success
      ? `✅ تست اتصال **${spec.shortBadge}** موفق بود (${res.latency_ms}ms)!\n\n`
      : `❌ تست اتصال **${spec.shortBadge}** ناموفق بود:\n${res.error}\n\n`;
    await safeEdit(
      `${banner}${report.text}`,
      buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
    );
    return;
  }

  if (data.startsWith('cb:kdel:')) {
    const provId = data.slice('cb:kdel:'.length);
    const spec = getProviderSpec(provId);
    await deleteProviderCredentials(userRow, spec.id);
    await answerToast(`🗑️ کلید ${spec.shortBadge} حذف شد`);
    const report = await buildKeysDashboardReport(userRow);
    await safeEdit(
      `🗑️ کلید سرویس **${spec.shortBadge}** حذف شد.\n\n${report.text}`,
      buildKeysManagementKeyboard(report.providersSnapshot, miniAppUrl),
    );
    return;
  }

  if (data === 'cb:providers') {
    await answerToast();
    const statusMap = {};
    for (const id of Object.keys(PROVIDER_HELP)) {
      const auth = await resolveProviderAuth(userRow, id);
      statusMap[id] = { isReady: auth.isReady, status: auth.status };
    }
    await safeEdit(
      `🌐 سرویس هوش مصنوعی مورد نظر خود را انتخاب کنید:\n(سرویس فعلی: ${getProviderSpec(activeProvider).title})`,
      buildProvidersKeyboard(activeProvider, statusMap),
    );
    return;
  }

  if (data.startsWith('cb:prov:')) {
    const nextProv = data.slice('cb:prov:'.length);
    const updated = await setActiveProviderAndModel(userRow.tgId, nextProv);
    const spec = getProviderSpec(updated.provider);
    await answerToast(`✅ سرویس فعال: ${spec.shortBadge}`);
    const auth = await resolveProviderAuth({
      ...userRow,
      provider: updated.provider,
      model: updated.model,
    });
    const statusHint = auth.isReady
      ? '✅ آماده دریافت دستورات کدنویسی!'
      : `⚠️ ${spec.signupHint}\nبرای ثبت کلید: /setkey ${spec.id} YOUR_KEY`;
    await safeEdit(
      `🌐 سرویس فعال: ${spec.title}\n🧠 مدل پیش‌فرض: ${updated.model}\n${statusHint}\n\nیک مدل از لیست زیر انتخاب کنید:`,
      buildModelsKeyboard(updated.provider, updated.model),
    );
    return;
  }

  // Grouped `/model` menu
  if (data === 'cb:models' || data === 'cb:models_grouped') {
    await answerToast();
    const providersSnapshot = await buildUserProvidersSnapshot(userRow);
    const auth = await resolveProviderAuth(userRow);
    await safeEdit(
      `🤖 **انتخاب مدل گروه‌بندی‌شده بر اساس سرویس**\nمدل فعال: \`${auth.model}\` (${auth.providerSpec.shortBadge})`,
      buildGroupedModelsKeyboard(providersSnapshot, activeProvider, auth.model),
    );
    return;
  }

  if (data === 'cb:model_list_text') {
    await answerToast();
    const text = await buildModelListReportText(userRow);
    await sendSafeText(chatId, text);
    return;
  }

  if (data.startsWith('cb:mprov:')) {
    const provId = data.slice('cb:mprov:'.length);
    const spec = getProviderSpec(provId);
    const auth = await resolveProviderAuth(userRow, spec.id);
    await answerToast();
    await safeEdit(
      `🤖 **مدل‌های سرویس ${spec.title}** (${auth.isReady ? '✅ آماده' : '❌ نیازمند کلید'}):\nیک مدل انتخاب کنید:`,
      buildModelsKeyboard(
        spec.id,
        spec.id === activeProvider ? userRow.model : '',
      ),
    );
    return;
  }

  if (data.startsWith('cb:pmodel:')) {
    const rest = data.slice('cb:pmodel:'.length);
    const sep = rest.indexOf(':');
    if (sep !== -1) {
      const provId = rest.slice(0, sep);
      const chosenModel = rest.slice(sep + 1);
      const updated = await setActiveProviderAndModel(userRow.tgId, provId, chosenModel);
      const spec = getProviderSpec(updated.provider);
      await answerToast(`✅ ${chosenModel}`);
      await safeEdit(
        `✅ مدل کدنویسی به \`${updated.model}\` روی سرویس **${spec.shortBadge}** تغییر یافت.`,
        buildModelsKeyboard(updated.provider, updated.model),
      );
      return;
    }
  }

  if (data.startsWith('cb:pmidx:')) {
    const parts = data.slice('cb:pmidx:'.length).split(':');
    if (parts.length >= 2) {
      const provId = parts[0];
      const idx = Number(parts[1]);
      const spec = getProviderSpec(provId);
      const modelObj = (spec.models || [])[idx];
      if (modelObj) {
        const updated = await setActiveProviderAndModel(userRow.tgId, spec.id, modelObj.id);
        await answerToast(`✅ ${updated.model}`);
        await safeEdit(
          `✅ مدل کدنویسی به \`${updated.model}\` روی سرویس **${spec.shortBadge}** تغییر یافت.`,
          buildModelsKeyboard(updated.provider, updated.model),
        );
        return;
      }
    }
  }

  if (data === 'cb:sync_opencode') {
    await answerToast('🔄 در حال دریافت لیست زنده از opencode.ai...');
    try {
      const auth = await resolveProviderAuth(userRow, 'opencode');
      const liveModels = await fetchLiveOpenCodeFreeModels(auth.apiKey);
      await safeEdit(
        `🆓 لیست زنده مدل‌های رایگان OpenCode Zen بروزرسانی شد (${liveModels.length} مدل):`,
        buildModelsKeyboard('opencode', userRow.model, liveModels),
      );
    } catch (err) {
      await safeEdit(
        `⚠️ خطا در استعلام زنده مدل‌ها (${err?.message ?? err}). نمایش لیست پیش‌فرض OpenCode:`,
        buildModelsKeyboard('opencode', userRow.model),
      );
    }
    return;
  }

  if (data === 'cb:sync_openrouter') {
    await answerToast('🔄 در حال دریافت مدل‌های رایگان OpenRouter...');
    try {
      const auth = await resolveProviderAuth(userRow, 'openrouter');
      const liveModels = await fetchLiveOpenRouterFreeModels(auth.apiKey);
      await safeEdit(
        `🌐 لیست زنده مدل‌های رایگان OpenRouter بروزرسانی شد (${liveModels.length} مدل):`,
        buildModelsKeyboard('openrouter', userRow.model, liveModels),
      );
    } catch (err) {
      await safeEdit(
        `⚠️ خطا در استعلام زنده OpenRouter (${err?.message ?? err}):`,
        buildModelsKeyboard('openrouter', userRow.model),
      );
    }
    return;
  }

  if (data.startsWith('cb:model:')) {
    const chosenModel = data.slice('cb:model:'.length);
    await setActiveModel(userRow.tgId, chosenModel);
    await answerToast(`✅ مدل فعال: ${chosenModel}`);
    await safeEdit(
      `✅ مدل کدنویسی روی سرویس ${getProviderSpec(activeProvider).shortBadge} به \`${chosenModel}\` تغییر یافت.`,
      buildModelsKeyboard(activeProvider, chosenModel),
    );
    return;
  }

  if (data === 'cb:projects') {
    await answerToast();
    const list = await listProjects(userRow.tgId);
    await safeEdit(
      `📁 پروژه‌های شما (فعال: ${activeProject}):`,
      buildProjectsKeyboard(list, activeProject),
    );
    return;
  }

  if (data.startsWith('cb:proj:')) {
    const nextProj = data.slice('cb:proj:'.length);
    await setActiveProject(userRow.tgId, nextProj);
    const list = await listProjects(userRow.tgId);
    await answerToast(`📁 پروژه فعال: ${nextProj}`);
    await safeEdit(
      `📁 پروژه فعال به ${nextProj} تغییر یافت:`,
      buildProjectsKeyboard(list, nextProj),
    );
    return;
  }

  if (data === 'cb:files') {
    await answerToast();
    const files = await listWorkspaceFiles(userRow.tgId, activeProject);
    const text =
      files.length === 0
        ? `📂 پروژه ${activeProject} فعلاً خالی است.`
        : `📂 فایل‌های پروژه ${activeProject} (${files.length}):\n\n` +
          files
            .slice(0, 50)
            .map((f) => `• ${f.path} (${f.sizeBytes} B)`)
            .join('\n');
    await sendSafeText(chatId, text);
    return;
  }

  if (data === 'cb:zip') {
    await answerToast('📦 در حال ساخت آرشیو ZIP...');
    await deliverProjectZip(chatId, userRow.tgId, activeProject);
    return;
  }

  if (data === 'cb:clear') {
    await clearConversationHistory(userRow.tgId, activeProject);
    await answerToast('🧹 حافظه چت پاک شد');
    await sendSafeText(chatId, `🧹 تاریخچه گفتگوی پروژه \`${activeProject}\` پاکسازی شد.`);
    return;
  }

  if (data === 'cb:status') {
    await answerToast();
    const files = await listWorkspaceFiles(userRow.tgId, activeProject);
    const auth = await resolveProviderAuth(userRow);
    await safeEdit(
      [
        `📊 وضعیت ایجنت Telegram Serverless`,
        `• سرویس فعال: ${auth.providerSpec.title}`,
        `• مدل فعال: ${auth.model}`,
        `• پروژه فعال: ${activeProject} (${files.length} فایل)`,
        `• پرامپت‌ها: ${userRow.promptCount || 0} | ابزارها: ${userRow.toolCallCount || 0}`,
      ].join('\n'),
      buildMainDashboardKeyboard(miniAppUrl),
    );
    return;
  }

  if (data === 'cb:guide_all') {
    await answerToast();
    const lines = [
      '📘 راهنمای اتصال همه ارائه‌دهندگان',
      '',
      'برای راهنمای کامل هر یک از دستور `/guide <provider_id>` استفاده کنید:',
      '',
    ];
    for (const [id, help] of Object.entries(PROVIDER_HELP)) {
      const auth = await resolveProviderAuth(userRow, id);
      const ready = auth.isReady ? '✅' : '❌';
      lines.push(
        `${ready} **${help.title}**${help.keyless ? ' (رایگان، بدون کلید)' : ''}`,
        `   ${help.summary}`,
        ...(help.commands || []).length ? [`   دستور: ${help.commands.join(' · ')}`] : [],
        '',
      );
    }
    lines.push('🔑 مدیریت کلیدها: `/keys` | ثبت کلید: `/setkey <provider_id> <API_KEY>`');
    await safeEdit(lines.join('\n'), buildMainDashboardKeyboard(miniAppUrl));
    return;
  }

  await answerToast();
}
