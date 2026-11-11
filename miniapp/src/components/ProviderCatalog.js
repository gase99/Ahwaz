/**
 * Shared UI helpers, provider icons, status models, model tags, and relative time formatting.
 * Pure functions only — safe to import in Node (no DOM requirement).
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
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
 * Normalized raw connection state (kept backward compatible with earlier releases):
 * - 'connected'    -> credentials present / keyless-ready
 * - 'invalid'      -> last test failed
 * - 'disconnected' -> no credentials yet
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

/** Detects rate-limit style failures so the UI can show an amber "standby" state. */
export function isRateLimitError(rawError) {
  return /429|rate[\s-]?limit|too many requests|سقف|محدودیت/i.test(String(rawError ?? ''));
}

/** Extracts an HTTP status code from a raw provider error, if present. */
export function extractHttpStatus(rawError) {
  const match = String(rawError ?? '').match(/\b(?:HTTP\s*)?([45]\d{2})\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Rich, presentation-ready provider status used by cards and badges.
 * kind: 'connected' | 'limited' | 'error' | 'standby'
 */
export function resolveProviderStatus(spec) {
  const uiState = resolveUiConnectionState(spec);

  if (uiState === 'connected') {
    const keyless = !spec?.requiresKey && !spec?.apiKeyConfigured;
    return {
      kind: 'connected',
      label: keyless ? 'متصل · بدون کلید' : 'متصل',
      shortLabel: 'متصل',
      tone: 'ok',
      dotClass: 'dot-ok',
    };
  }

  if (uiState === 'invalid') {
    if (isRateLimitError(spec?.lastError)) {
      return {
        kind: 'limited',
        label: 'محدودیت موقت',
        shortLabel: 'محدود',
        tone: 'warn',
        dotClass: 'dot-warn',
      };
    }
    return {
      kind: 'error',
      label: 'خطا در اتصال',
      shortLabel: 'خطا',
      tone: 'err',
      dotClass: 'dot-err',
    };
  }

  if (spec?.lastError) {
    return {
      kind: 'error',
      label: 'تنظیم ناقص',
      shortLabel: 'ناقص',
      tone: 'err',
      dotClass: 'dot-err',
    };
  }

  return {
    kind: 'standby',
    label: spec?.requiresKey ? 'بدون کلید' : 'در آماده‌به‌کار',
    shortLabel: 'غیرفعال',
    tone: 'muted',
    dotClass: 'dot-muted',
  };
}

/** Label helper kept for the grouped <select> and legacy callers. */
export function formatConnectionLabelText(spec) {
  const { kind, label } = resolveProviderStatus(spec);
  if (kind === 'connected') return `✅ ${label}`;
  if (kind === 'limited') return '⏳ محدودیت موقت';
  if (kind === 'error') return '⚠️ خطا در اتصال';
  return '⚪ غیرفعال';
}

export function renderConnectionBadgeHtml(spec) {
  const status = resolveProviderStatus(spec);
  return `<span class="badge badge-${status.tone}"><span class="dot ${status.dotClass}"></span>${escapeHtml(
    status.label,
  )}</span>`;
}

/**
 * Decorates a model option with capability/pricing icons:
 * 🆓 (free), 💰 (paid/custom), ⚡ (fast), 🧠 (powerful), ⭐ (recommended)
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

/** Counts grouped by the richer card status (adds the amber "limited" bucket). */
export function summarizeProviderStatuses(providers = []) {
  const groups = { connected: [], limited: [], error: [], standby: [] };
  for (const p of providers) {
    const status = resolveProviderStatus(p);
    groups[status.kind].push(p);
  }
  return {
    total: providers.length,
    connected: groups.connected,
    limited: groups.limited,
    error: groups.error,
    standby: groups.standby,
  };
}
