import crypto from 'crypto';

export interface SessionRecord {
  session_key: string;
  player_id: string;
  game_id: string;
  role_id: string;
  connected: boolean;
  last_seen: Date;
  created_at: Date;
  last_action_state: Record<string, unknown>;
}

/**
 * In-memory session manager for v1.
 * In production, this would be backed by Redis.
 */
export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private roleLocks = new Map<string, string>(); // "gameId:roleId" -> sessionKey
  private playerSessions = new Map<string, Set<string>>(); // playerId -> set of sessionKeys

  generateSessionKey(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  createSession(playerId: string, gameId: string, roleId: string): SessionRecord {
    const lockKey = `${gameId}:${roleId}`;
    if (this.roleLocks.has(lockKey)) {
      throw new Error(`Role ${roleId} in game ${gameId} is already claimed`);
    }

    const session: SessionRecord = {
      session_key: this.generateSessionKey(),
      player_id: playerId,
      game_id: gameId,
      role_id: roleId,
      connected: true,
      last_seen: new Date(),
      created_at: new Date(),
      last_action_state: {},
    };

    this.sessions.set(session.session_key, session);
    this.roleLocks.set(lockKey, session.session_key);

    if (!this.playerSessions.has(playerId)) {
      this.playerSessions.set(playerId, new Set());
    }
    this.playerSessions.get(playerId)!.add(session.session_key);

    return session;
  }

  getSession(sessionKey: string): SessionRecord | undefined {
    return this.sessions.get(sessionKey);
  }

  validateSession(sessionKey: string): SessionRecord | null {
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    session.last_seen = new Date();
    return session;
  }

  markConnected(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.connected = true;
      session.last_seen = new Date();
    }
  }

  markDisconnected(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.connected = false;
    }
  }

  releaseSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    const lockKey = `${session.game_id}:${session.role_id}`;
    this.roleLocks.delete(lockKey);
    this.sessions.delete(sessionKey);

    const playerSet = this.playerSessions.get(session.player_id);
    if (playerSet) {
      playerSet.delete(sessionKey);
    }
  }

  getSessionsForGame(gameId: string): SessionRecord[] {
    return Array.from(this.sessions.values()).filter(s => s.game_id === gameId);
  }

  isRoleClaimed(gameId: string, roleId: string): boolean {
    return this.roleLocks.has(`${gameId}:${roleId}`);
  }

  getSessionByRole(gameId: string, roleId: string): SessionRecord | undefined {
    const sessionKey = this.roleLocks.get(`${gameId}:${roleId}`);
    return sessionKey ? this.sessions.get(sessionKey) : undefined;
  }

  getConnectedSessions(gameId: string): SessionRecord[] {
    return this.getSessionsForGame(gameId).filter(s => s.connected);
  }

  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter(s => s.connected).length;
  }
}
