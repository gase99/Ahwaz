import type { FunctionDeclaration } from '@google/genai';
import type { WorkspaceService } from '../../services/workspace.service.js';
import type { AgentTool } from '../../types/agent.js';
import { createArchiveTools } from './archive.tool.js';
import { createExecutorTools } from './executor.tool.js';
import { createFilesystemTools } from './filesystem.tool.js';
import { createGitTools } from './git.tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(workspaceService: WorkspaceService) {
    const allTools: AgentTool[] = [
      ...createFilesystemTools(workspaceService),
      ...createExecutorTools(),
      ...createGitTools(),
      ...createArchiveTools(workspaceService),
    ];

    for (const tool of allTools) {
      if (!tool.declaration.name) {
        throw new Error('Tool declaration is missing a name.');
      }
      this.tools.set(tool.declaration.name, tool);
    }
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map((t) => t.declaration);
  }

  listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
