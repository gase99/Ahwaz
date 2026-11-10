import { api } from 'sdk';
import {
  fetchLiveOpenCodeFreeModels,
  getProviderSpec,
} from '../lib/agent/providers.js';
import {
  ensureUser,
  getSetting,
  resolveProviderAuth,
  setActiveModel,
  setActiveProject,
  setActiveProviderAndModel,
} from '../lib/services/auth-service.js';
import { deliverProjectZip } from '../lib/services/command-service.js';
import { clearConversationHistory } from '../lib/services/conversation-service.js';
import { sendSafeText } from '../lib/services/delivery-service.js';
import {
  buildMainDashboardKeyboard,
  buildModelsKeyboard,
  buildProjectsKeyboard,
  buildProvidersKeyboard,
} from '../lib/services/keyboard-service.js';
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
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } catch {
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

  if (data === 'cb:providers') {
    await answerToast();
    await safeEdit(
      `🌐 سرویس هوش مصنوعی مورد نظر خود را انتخاب کنید:\n(سرویس فعلی: ${getProviderSpec(activeProvider).title})`,
      buildProvidersKeyboard(activeProvider),
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

  if (data === 'cb:models') {
    await answerToast();
    await safeEdit(
      `🤖 انتخاب مدل روی سرویس ${getProviderSpec(activeProvider).shortBadge} (فعلی: ${userRow.model}):`,
      buildModelsKeyboard(activeProvider, userRow.model),
    );
    return;
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

  if (data.startsWith('cb:model:')) {
    const chosenModel = data.slice('cb:model:'.length);
    await setActiveModel(userRow.tgId, chosenModel);
    await answerToast(`✅ مدل فعال: ${chosenModel}`);
    await safeEdit(
      `✅ مدل کدنویسی روی سرویس ${getProviderSpec(activeProvider).shortBadge} به ${chosenModel} تغییر یافت.`,
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

  await answerToast();
}
