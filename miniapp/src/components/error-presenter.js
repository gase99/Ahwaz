/**
 * Turns long, mixed-language provider error strings into a compact, structured
 * object so the UI never has to print a raw technical blob as a paragraph.
 */
import { extractHttpStatus } from './ProviderCatalog.js';

const NETWORK_RE = /عدم برقراری ارتباط|network|failed to fetch|fetch failed|timeout|timed out|ECONN|اتصال برقرار/i;
const MISSING_KEY_RE = /کلید API برای سرویس|ثبت نشده|کارت بانکی|missing api key|no api key/i;
const BASE_URL_RE = /Base URL|آدرس سرور|اندپوینت/i;

/** Collapses whitespace and caps length for inline display. */
export function shortenText(raw, max = 160) {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @returns {null | {
 *   tone: 'err'|'warn',
 *   httpCode: number|null,
 *   codeLabel: string,
 *   titleFa: string,
 *   hintFa: string,
 *   raw: string,
 *   shortFa: string,
 * }}
 */
export function parseProviderError(rawError, { success = false } = {}) {
  if (success) return null;
  const raw = String(rawError ?? '').trim();
  if (!raw) return null;

  const httpCode = extractHttpStatus(raw);
  const base = { httpCode, raw };

  if (httpCode === 401 || httpCode === 403 || /unauthorized|invalid api key|کلید API نامعتبر/i.test(raw)) {
    return {
      ...base,
      tone: 'err',
      codeLabel: `HTTP ${httpCode ?? 401}`,
      titleFa: 'کلید API نامعتبر یا بدون دسترسی',
      hintFa: 'کلید را از داشبورد سرویس دوباره بسازید و در «ویرایش کلید» جایگزین کنید.',
      shortFa: 'کلید نامعتبر',
    };
  }

  if (httpCode === 429 || /rate[\s-]?limit|too many requests|سقف|محدودیت/i.test(raw)) {
    return {
      ...base,
      tone: 'warn',
      codeLabel: 'HTTP 429',
      titleFa: 'محدودیت موقت درخواست',
      hintFa: 'کلید سالم است؛ سقف لحظه‌ای پر شده. چند ثانیه بعد دوباره تست کنید یا مدل سبک‌تری انتخاب کنید.',
      shortFa: 'Rate Limit',
    };
  }

  if (httpCode === 404) {
    return {
      ...base,
      tone: 'warn',
      codeLabel: 'HTTP 404',
      titleFa: 'اندپوینت یا مدل یافت نشد',
      hintFa: 'آدرس Base URL و نام مدل پیش‌فرض را بررسی کنید.',
      shortFa: 'HTTP 404',
    };
  }

  if (httpCode && httpCode >= 500) {
    return {
      ...base,
      tone: 'err',
      codeLabel: `HTTP ${httpCode}`,
      titleFa: 'سرور سرویس موقتاً پاسخگو نیست',
      hintFa: 'مشکل از سمت سرویس است؛ کمی بعد دوباره تلاش کنید یا سرویس دیگری را فعال کنید.',
      shortFa: `HTTP ${httpCode}`,
    };
  }

  if (httpCode) {
    return {
      ...base,
      tone: 'err',
      codeLabel: `HTTP ${httpCode}`,
      titleFa: 'پاسخ ناموفق از سرویس',
      hintFa: 'پاسخ کامل سرویس را در «جزئیات فنی» ببینید.',
      shortFa: `HTTP ${httpCode}`,
    };
  }

  if (NETWORK_RE.test(raw)) {
    return {
      ...base,
      tone: 'err',
      codeLabel: 'NETWORK',
      titleFa: 'اتصال شبکه برقرار نشد',
      hintFa: 'اینترنت یا دسترسی سرویس به اندپوینت را بررسی کنید و دوباره تست بزنید.',
      shortFa: 'خطای شبکه',
    };
  }

  if (MISSING_KEY_RE.test(raw)) {
    return {
      ...base,
      tone: 'warn',
      codeLabel: 'NO_KEY',
      titleFa: 'کلید API ثبت نشده',
      hintFa: 'از دکمه «ویرایش کلید» کلید رایگان سرویس را وارد و ذخیره کنید.',
      shortFa: 'بدون کلید',
    };
  }

  if (BASE_URL_RE.test(raw)) {
    return {
      ...base,
      tone: 'warn',
      codeLabel: 'NO_URL',
      titleFa: 'آدرس سرور تنظیم نشده',
      hintFa: 'Base URL سازگار با OpenAI (مثلاً https://router.example.com/v1) را وارد کنید.',
      shortFa: 'بدون آدرس',
    };
  }

  return {
    ...base,
    tone: 'err',
    codeLabel: 'ERROR',
    titleFa: 'خطای نامشخص سرویس',
    hintFa: 'جزئیات فنی را باز کنید یا کلید و آدرس سرور را دوباره بررسی نمایید.',
    shortFa: 'خطا',
  };
}
