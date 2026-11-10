import type { Content } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { UserSession } from '../types/session.js';

const MAX_HISTORY_ENTRIES = 40;

export class SessionService {
  private readonly cache = new Map<number, UserSession>();
  private readonly sessionsDir: string;

  constructor(
    dataDir: string,
    private readonly defaultModel: string,
  ) {
    this.sessionsDir = path.resolve(dataDir, 'sessions');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  private getSessionFilePath(userId: number): string {
    return path.join(this.sessionsDir, `${userId}.json`);
  }

  async getSession(userId: number, username?: string): Promise<UserSession> {
    const cached = this.cache.get(userId);
    if (cached) {
      if (username && cached.username !== username) {
        cached.username = username;
      }
      return cached;
    }

    const filePath = this.getSessionFilePath(userId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as UserSession;
      if (username) parsed.username = username;
      this.cache.set(userId, parsed);
      return parsed;
    } catch {
      const now = new Date().toISOString();
      const fresh: UserSession = {
        userId,
        username,
        activeProject: 'default',
        model: this.defaultModel,
        histories: {},
        stats: {
          totalPrompts: 0,
          totalToolCalls: 0,
          createdAt: now,
          updatedAt: now,
        },
      };
      this.cache.set(userId, fresh);
      await this.saveSession(fresh);
      return fresh;
    }
  }

  async saveSession(session: UserSession): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    session.stats.updatedAt = new Date().toISOString();
    const filePath = this.getSessionFilePath(session.userId);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(session, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
    this.cache.set(session.userId, session);
  }

  async setActiveProject(userId: number, projectName: string): Promise<UserSession> {
    const session = await this.getSession(userId);
    session.activeProject = projectName;
    await this.saveSession(session);
    return session;
  }

  async setModel(userId: number, model: string): Promise<UserSession> {
    const session = await this.getSession(userId);
    session.model = model.trim();
    await this.saveSession(session);
    return session;
  }

  async clearProjectHistory(userId: number, projectName?: string): Promise<void> {
    const session = await this.getSession(userId);
    const target = projectName ?? session.activeProject;
    delete session.histories[target];
    await this.saveSession(session);
  }

  getProjectHistory(session: UserSession, projectName?: string): Content[] {
    const target = projectName ?? session.activeProject;
    return session.histories[target] ?? [];
  }

  setProjectHistory(
    session: UserSession,
    projectName: string,
    contents: Content[],
  ): void {
    session.histories[projectName] = SessionService.trimHistorySafely(
      contents,
      MAX_HISTORY_ENTRIES,
    );
  }

  /**
   * Trims history while guaranteeing the first message is a clean user prompt
   * (never an orphaned functionResponse or model turn).
   */
  static trimHistorySafely(contents: Content[], maxEntries = MAX_HISTORY_ENTRIES): Content[] {
    if (contents.length <= maxEntries) return [...contents];

    let startIdx = contents.length - maxEntries;
    while (startIdx < contents.length) {
      const item = contents[startIdx];
      const isPlainUserTurn =
        item.role === 'user' &&
        Array.isArray(item.parts) &&
        item.parts.length > 0 &&
        !item.parts.some((p) => Boolean(p.functionResponse));
      if (isPlainUserTurn) break;
      startIdx += 1;
    }

    return contents.slice(startIdx);
  }
}
