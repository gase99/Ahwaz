import { fetch } from 'sdk';

/**
 * Calls Google Gemini v1beta REST API directly from the Telegram Serverless V8 isolate.
 */
export async function generateGeminiStep({
  apiKey,
  model,
  systemInstruction,
  contents,
  functionDeclarations,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents,
    generationConfig: {
      temperature: 0.2,
    },
  };

  if (Array.isArray(functionDeclarations) && functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = `خطای سرویس Google Gemini (کد ${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) {
        msg = `${msg}: ${parsed.error.message}`;
      }
    } catch {
      if (errText) msg = `${msg}: ${errText.slice(0, 220)}`;
    }
    throw new Error(msg);
  }

  return await res.json();
}
