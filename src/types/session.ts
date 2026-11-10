import type { Content } from '@google/genai';

export const RECOMMENDED_GEMINI_MODELS = [
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro (پیشرفته - معماری و دیباگ عمیق)',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (سریع و اقتصادی - کدنویسی روزمره)',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash (فوق سریع)',
  },
] as const;

export interface UserSession {
  userId: number;
  username?: string;
  activeProject: string;
  model: string;
  /** Conversation history keyed by project name */
  histories: Record<string, Content[]>;
  stats: {
    totalPrompts: number;
    totalToolCalls: number;
    createdAt: string;
    updatedAt: string;
  };
}
