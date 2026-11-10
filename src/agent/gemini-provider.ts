import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
} from '@google/genai';

export interface GenerateStepParams {
  model: string;
  systemInstruction: string;
  contents: Content[];
  tools: FunctionDeclaration[];
  abortSignal?: AbortSignal;
}

export interface GeminiClientLike {
  generateStep(params: GenerateStepParams): Promise<GenerateContentResponse>;
}

export class GeminiProvider implements GeminiClientLike {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateStep(params: GenerateStepParams): Promise<GenerateContentResponse> {
    return this.ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: 0.2,
        abortSignal: params.abortSignal,
        tools:
          params.tools.length > 0
            ? [{ functionDeclarations: params.tools }]
            : undefined,
      },
    });
  }
}
