import type { FunctionDeclaration } from '@google/genai';

export interface ArtifactDelivery {
  filePath: string;
  fileName: string;
  caption?: string;
}

export interface ToolExecutionContext {
  userId: number;
  projectName: string;
  projectRoot: string;
  abortSignal?: AbortSignal;
  enableShell: boolean;
  commandTimeoutMs: number;
  githubToken?: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  queueArtifact: (artifact: ArtifactDelivery) => void;
}

export interface AgentTool {
  declaration: FunctionDeclaration;
  /** Human-readable Persian label shown live in Telegram status updates */
  formatProgress: (args: Record<string, unknown>) => string;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
}

export interface AgentProgressEvent {
  step: number;
  maxSteps: number;
  phase: 'thinking' | 'tool_start' | 'tool_done' | 'tool_error';
  toolName?: string;
  label: string;
}

export interface ToolExecutionSummary {
  name: string;
  label: string;
  ok: boolean;
  durationMs: number;
}

export interface AgentRunInput {
  userId: number;
  username?: string;
  prompt: string;
  /** Optional inline file notes (e.g., when user uploads a file or ZIP in Telegram) */
  attachedFilesInfo?: string[];
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => Promise<void> | void;
}

export interface AgentRunResult {
  replyText: string;
  projectName: string;
  modelUsed: string;
  stepsUsed: number;
  toolCallsExecuted: ToolExecutionSummary[];
  artifacts: ArtifactDelivery[];
}
