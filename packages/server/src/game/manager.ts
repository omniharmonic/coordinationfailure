import { createInitialState, tick, TIME_SPEED_PRESETS, type GameState, type PlayerAction, createDefaultConfig, type GameConfig, type GameEvent } from '@cf/engine';
import { v4 as uuid } from 'uuid';
import type { SessionManager } from '../session/manager.js';
import { GameLogger } from '../analysis/logger.js';

export interface GameLobby {
  game_id: string;
  config: GameConfig;
  host_player_id: string;
  players: Map<string, string>; // roleId -> playerId (keyed by role to prevent double-claim)
  created_at: Date;
}

export class GameManager {
  private games = new Map<string, GameState>();
  private lobbies = new Map<string, GameLobby>();
  private runners = new Map<string, NodeJS.Timeout>();
  private actionBuffers = new Map<string, PlayerAction[]>();
  private tickCallbacks = new Map<string, Array<(state: GameState, events: GameEvent[]) => void>>();
  private gameEndCallbacks: Array<(gameId: string, state: GameState, events: GameEvent[]) => void> = [];
  public readonly gameLogger = new GameLogger();

  constructor(private sessionManager: SessionManager) {
    // Clean up stale lobbies every 60 seconds
    setInterval(() => this.cleanStaleLobbles(), 60_000);
  }

  /** Remove lobbies older than 10 minutes that haven't started */
  private cleanStaleLobbles(): void {
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    for (const [id, lobby] of this.lobbies) {
      if (now - lobby.created_at.getTime() > FIVE_MINUTES) {
        console.log(`[CF] Cleaning stale lobby ${id.slice(0, 8)} (${lobby.players.size} players, age ${Math.round((now - lobby.created_at.getTime()) / 60000)}min)`);
        // Release any claimed sessions
        const sessions = this.sessionManager.getSessionsForGame(id);
        for (const s of sessions) {
          this.sessionManager.releaseSession(s.session_key);
        }
        this.lobbies.delete(id);
      }
    }
  }

  /** Register a callback that fires when ANY game ends */
  onGameEnd(callback: (gameId: string, state: GameState, events: GameEvent[]) => void): void {
    this.gameEndCallbacks.push(callback);
  }

  getGameLog(gameId: string) {
    return this.gameLogger.getLog(gameId);
  }

  getGameLogSummary(gameId: string) {
    return this.gameLogger.getLogSummary(gameId);
  }

  createGame(playerId: string, configOverrides?: Partial<GameConfig>): { game_id: string; config: GameConfig } {
    // Clean up any existing empty lobbies from this player
    for (const [id, lobby] of this.lobbies) {
      if (lobby.host_player_id === playerId && lobby.players.size === 0) {
        this.lobbies.delete(id);
      }
    }

    const gameId = uuid();
    const config = createDefaultConfig(configOverrides);

    const lobby: GameLobby = {
      game_id: gameId,
      config,
      host_player_id: playerId,
      players: new Map(),
      created_at: new Date(),
    };

    this.lobbies.set(gameId, lobby);
    return { game_id: gameId, config };
  }

  getLobby(gameId: string): GameLobby | undefined {
    return this.lobbies.get(gameId);
  }

  getGame(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }

  listGames(): Array<{
    game_id: string;
    phase: string;
    time_speed: string;
    players: number;
    max_players: number;
    available_roles: string[];
  }> {
    const list: Array<{
      game_id: string;
      phase: string;
      time_speed: string;
      players: number;
      max_players: number;
      available_roles: string[];
    }> = [];

    // Lobbies
    for (const [id, lobby] of this.lobbies) {
      const allRoles = [...lobby.config.companies.map(c => c.id), ...lobby.config.governments.map(g => g.id)];
      const claimedRoles = new Set(lobby.players.keys()); // roles are now the keys
      const available = allRoles.filter(r => !claimedRoles.has(r));

      list.push({
        game_id: id,
        phase: 'lobby',
        time_speed: lobby.config.time_speed,
        players: lobby.players.size,
        max_players: lobby.config.max_players,
        available_roles: available,
      });
    }

    // Running games
    for (const [id, state] of this.games) {
      if (state.phase === 'running') {
        const sessions = this.sessionManager.getSessionsForGame(id);
        const allRoles = Object.keys(state.roles);
        const claimedRoles = new Set(sessions.map(s => s.role_id));
        const available = allRoles.filter(r => !claimedRoles.has(r));

        list.push({
          game_id: id,
          phase: 'running',
          time_speed: state.config.time_speed,
          players: sessions.length,
          max_players: state.config.max_players,
          available_roles: available,
        });
      }
    }

    return list;
  }

  joinLobby(gameId: string, playerId: string): void {
    const lobby = this.lobbies.get(gameId);
    if (!lobby) throw new Error('Game not found');
    if (lobby.players.size >= lobby.config.max_players) throw new Error('Game is full');
  }

  claimRole(gameId: string, playerId: string, roleId: string): string {
    const lobby = this.lobbies.get(gameId);
    if (!lobby) throw new Error('Game not found or already started');

    const allRoles = [...lobby.config.companies.map(c => c.id), ...lobby.config.governments.map(g => g.id)];
    if (!allRoles.includes(roleId)) throw new Error(`Invalid role: ${roleId}`);

    if (this.sessionManager.isRoleClaimed(gameId, roleId)) {
      throw new Error(`Role ${roleId} is already claimed`);
    }

    const session = this.sessionManager.createSession(playerId, gameId, roleId);
    lobby.players.set(roleId, playerId); // keyed by role to support same player claiming multiple roles

    return session.session_key;
  }

  startGame(gameId: string): GameState {
    const lobby = this.lobbies.get(gameId);
    if (!lobby) throw new Error('Lobby not found');
    if (lobby.players.size < lobby.config.min_players) {
      throw new Error(`Need at least ${lobby.config.min_players} players`);
    }

    const state = createInitialState(gameId, lobby.config);
    state.phase = 'running';

    // Mark connected players
    const sessions = this.sessionManager.getSessionsForGame(gameId);
    for (const session of sessions) {
      if (state.companies[session.role_id]) {
        state.companies[session.role_id].connection_status = 'connected';
      }
      if (state.governments[session.role_id]) {
        state.governments[session.role_id].connection_status = 'connected';
      }
    }

    this.games.set(gameId, state);
    this.lobbies.delete(gameId);
    this.actionBuffers.set(gameId, []);

    // Start tick loop
    this.startTickLoop(gameId);

    return state;
  }

  bufferAction(gameId: string, action: PlayerAction): void {
    const buffer = this.actionBuffers.get(gameId);
    if (buffer) {
      buffer.push(action);
    }
  }

  onTick(gameId: string, callback: (state: GameState, events: GameEvent[]) => void): void {
    if (!this.tickCallbacks.has(gameId)) {
      this.tickCallbacks.set(gameId, []);
    }
    this.tickCallbacks.get(gameId)!.push(callback);
  }

  removeTickCallback(gameId: string, callback: (state: GameState, events: GameEvent[]) => void): void {
    const callbacks = this.tickCallbacks.get(gameId);
    if (callbacks) {
      const idx = callbacks.indexOf(callback);
      if (idx >= 0) callbacks.splice(idx, 1);
    }
  }

  private startTickLoop(gameId: string): void {
    const state = this.games.get(gameId)!;
    const { tick_interval_ms } = TIME_SPEED_PRESETS[state.config.time_speed];
    let tickNumber = 1;

    const interval = setInterval(() => {
      const currentState = this.games.get(gameId);
      if (!currentState || currentState.phase !== 'running') {
        clearInterval(interval);
        return;
      }

      // Drain action buffer
      const actions = this.actionBuffers.get(gameId) ?? [];
      this.actionBuffers.set(gameId, []);

      // Run tick
      const result = tick({
        current_state: currentState,
        player_actions: actions,
        tick_number: tickNumber++,
      });

      // Store updated state
      this.games.set(gameId, result.new_state);

      // Notify callbacks
      const callbacks = this.tickCallbacks.get(gameId) ?? [];
      for (const cb of callbacks) {
        try { cb(result.new_state, result.events); } catch (_e) { /* ignore */ }
      }

      // Log tick for analysis
      this.gameLogger.logTick(gameId, tickNumber - 1, result.new_state, result.events);

      // Check game over
      if (result.new_state.phase === 'ended') {
        clearInterval(interval);
        this.runners.delete(gameId);
        this.actionBuffers.delete(gameId);

        // Fire game-end callbacks (leaderboard, analysis, knowledge base)
        for (const cb of this.gameEndCallbacks) {
          try { cb(gameId, result.new_state, result.events); } catch (_e) { /* ignore */ }
        }

        // Keep ended game in memory for 5 minutes so spectators can see final state
        setTimeout(() => {
          const g = this.games.get(gameId);
          if (g && g.phase === 'ended') {
            this.games.delete(gameId);
            this.tickCallbacks.delete(gameId);
          }
        }, 5 * 60 * 1000);
      }
    }, tick_interval_ms);

    this.runners.set(gameId, interval);
  }

  stopGame(gameId: string): void {
    const interval = this.runners.get(gameId);
    if (interval) clearInterval(interval);
    this.runners.delete(gameId);
  }

  stopAllGames(): void {
    for (const [gameId, interval] of this.runners) {
      clearInterval(interval);
    }
    this.runners.clear();
  }

  getActiveTickLoopCount(): number {
    return this.runners.size;
  }
}
