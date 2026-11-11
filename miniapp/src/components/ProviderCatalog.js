/**
 * Shared UI helpers, provider icons, status badges, model tags, and relative time formatting.
 */

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

export const PROVIDER_LOGOS = {
  gemini: '✨',
  opencode: '🆓',
  openrouter: '🌐',
  groq: '⚡',
  freellmapi: '🔀',
  apifreellm: '🆓',
  llm7: '⚡',
  pollinations: '🌸',
  custom: '🔧',
};

export function getProviderLogo(spec) {
  return spec?.logo || PROVIDER_LOGOS[spec?.id] || '🔌';
}

/**
 * Computes normalized connection state for UI cards & badges:
 * - 'connected'    -> ✅ متصل
 * - 'invalid'      -> ⚠️ نامعتبر
 * - 'disconnected' -> ❌ متصل نیست
 */
export function resolveUiConnectionState(spec) {
  if (!spec) return 'disconnected';
  if (
    spec.status === 'invalid' ||
    spec.keyStatus === 'invalid' ||
    spec.connectionState === 'invalid'
  ) {
    return 'invalid';
  }
  if (spec.status === 'disconnected' || spec.connectionState === 'disconnected') {
    return 'disconnected';
  }
  if (spec.status === 'connected' || spec.connectionState === 'connected') {
    return 'connected';
  }

  if (spec.requiresBaseUrl && !spec.baseUrl) return 'disconnected';
  if (spec.requiresKey && !spec.apiKeyConfigured) return 'disconnected';
  if (spec.isReady) return 'connected';
  return 'disconnected';
}

export function renderConnectionBadgeHtml(spec) {
  const state = resolveUiConnectionState(spec);
  if (state === 'connected') {
    const sub = !spec.apiKeyConfigured && !spec.requiresKey ? ' (بدون کلید)' : '';
    return `<span class="status status-ok">✅ متصل${sub}</span>`;
  }
  if (state === 'invalid') {
    return '<span class="status status-warn">⚠️ نامعتبر</span>';
  }
  return '<span class="status status-err">❌ متصل نیست</span>';
}

export function formatConnectionLabelText(spec) {
  const state = resolveUiConnectionState(spec);
  if (state === 'connected') {
    return !spec.apiKeyConfigured && !spec.requiresKey ? '✅ آماده (بدون کلید)' : '✅ متصل';
  }
  if (state === 'invalid') return '⚠️ نامعتبر';
  return '❌ متصل نیست';
}

/**
 * Decorates a model option with clear capability/pricing icons:
 * 🆓 (رایگان), 💰 (پولی/سفارشی), ⚡ (سریع), 🧠 (قدرتمند), ⭐ (پیشنهادی)
 */
export function formatModelOptionLabel(model, providerSpec) {
  const id = String(model?.id ?? '');
  const isFree =
    model?.free !== undefined
      ? Boolean(model.free)
      : providerSpec?.id !== 'custom' || id.includes('free');
  const costIcon = isFree ? '🆓' : '💰';

  const isFast =
    model?.tier === 'fast' || /flash|fast|lightning|mini|instant/i.test(id);
  const tierIcon = isFast ? '⚡' : '🧠';
  const star = model?.recommended || id === 'big-pickle' ? ' ⭐' : '';

  return `${costIcon}${tierIcon} ${id}${star}`;
}

export function formatRelativeTimeFa(unixSeconds) {
  if (!unixSeconds || !Number.isFinite(Number(unixSeconds))) return null;
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds));
  if (diffSec < 45) return 'لحظاتی پیش';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return `${days} روز پیش`;
}

export function summarizeProviderCounts(providers = []) {
  const connected = [];
  const invalid = [];
  const disconnected = [];

  for (const p of providers) {
    const state = resolveUiConnectionState(p);
    if (state === 'connected') connected.push(p);
    else if (state === 'invalid') invalid.push(p);
    else disconnected.push(p);
  }

  return {
    total: providers.length || 9,
    connected,
    invalid,
    disconnected,
  };
}
