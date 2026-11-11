const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Evaluates pure JavaScript snippets / unit assertions inside a shadowed scope
 * with captured console output for quick verification inside the V8 isolate.
 */
export async function verifyJavaScriptSnippet(code) {
  const logs = [];
  const formatVal = (v) => {
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const sandboxConsole = {
    log: (...args) => logs.push(args.map(formatVal).join(' ')),
    info: (...args) => logs.push(args.map(formatVal).join(' ')),
    warn: (...args) => logs.push(`[WARN] ${args.map(formatVal).join(' ')}`),
    error: (...args) => logs.push(`[ERROR] ${args.map(formatVal).join(' ')}`),
  };

  const assert = (condition, message = 'Assertion failed') => {
    if (!condition) throw new Error(message);
  };

  const t0 = Date.now();
  let timerId = null;
  try {
    // Shadow ambient globals so snippet only tests pure JS logic
    const fn = new AsyncFunction(
      'console',
      'assert',
      'fetch',
      'globalThis',
      `"use strict";\n${code}`,
    );

    const returnValue = await Promise.race([
      fn(sandboxConsole, assert, undefined, undefined),
      new Promise((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error('زمان اجرای تست بیش از ۵ ثانیه طول کشید.')),
          5000,
        );
      }),
    ]);

    return {
      ok: true,
      duration_ms: Date.now() - t0,
      logs: logs.slice(0, 50).join('\n'),
      return_value: returnValue !== undefined ? formatVal(returnValue) : null,
    };
  } catch (err) {
    return {
      ok: false,
      duration_ms: Date.now() - t0,
      logs: logs.slice(0, 50).join('\n'),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}
