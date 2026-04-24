/**
 * LegacyClassicsBackend — the original in-memory classics engine.
 *
 * The logic is byte-for-byte the same as the pre-refactor ClassicsManager
 * class that shipped with the server; we only renamed the class, moved the
 * shared types / GAME_DEFS / tragedy constants out into classics-shared.ts,
 * and declared the ClassicsBackend interface to mirror the original public
 * methods (createClassicGame → createGame, joinClassicGame → joinGame).
 *
 * No classic game that was working on main should behave differently under
 * this backend. Parity with the plugin backend is validated by tests in
 * packages/server/src/__tests__/classics-backends.test.ts.
 */

import { v4 as uuid } from 'uuid';
import { generateBoard, boardToText } from './schelling-board.js';

import type { ClassicsBackend, ClassicsBackendName } from './classics-backend.js';
import {
  GAME_DEFS,
  TRAGEDY_CAPACITY,
  TRAGEDY_GROWTH_RATE,
  TRAGEDY_INITIAL_RESOURCE,
  type ClassicGameConfig,
  type ClassicGameEndCallback,
  type ClassicGameSession,
  type ClassicGameType,
  type ClassicRoundResult,
  type ClassicStateView,
  type ListGameItem,
  type SpectatorStateView,
  type SubmitChoiceResult,
  type ClassicsCatalog,
} from './classics-shared.js';

// Schelling board seed counter — monotonic so each new board is distinct
// even within a single process.
let seed_counter = 1;

export class LegacyClassicsBackend implements ClassicsBackend {
  readonly name: ClassicsBackendName = 'legacy';
  readonly supportedTypes: ReadonlyArray<ClassicGameType> = Object.freeze([
    'prisoners_dilemma',
    'stag_hunt',
    'tragedy_of_commons',
    'schelling_point',
  ]);

  private games = new Map<string, ClassicGameSession>();
  private gameEndCallbacks: ClassicGameEndCallback[] = [];
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: { enableCleanup?: boolean } = {}) {
    if (options.enableCleanup !== false) {
      this.cleanupHandle = setInterval(() => this.cleanStaleGames(), 60_000);
    }
  }

  /** Stop the background cleanup timer (used by tests). */
  stopCleanup(): void {
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle);
      this.cleanupHandle = null;
    }
  }

  hasGame(gameId: string): boolean {
    return this.games.has(gameId);
  }

  getGame(gameId: string): ClassicGameSession | undefined {
    return this.games.get(gameId);
  }

  onGameComplete(cb: ClassicGameEndCallback): void {
    this.gameEndCallbacks.push(cb);
  }

  listOpenGames(): ClassicsCatalog['open_games'] {
    const out: ClassicsCatalog['open_games'] = [];
    for (const [id, game] of this.games) {
      if (game.phase === 'waiting') {
        out.push({
          game_id: id,
          type: game.type,
          players: game.player_ids.length,
          min_players: game.min_players,
          max_players: game.max_players,
          phase: game.phase,
        });
      }
    }
    return out;
  }

  listAllGames(): ListGameItem[] {
    const result: ListGameItem[] = [];
    for (const [, game] of this.games) {
      const item: ListGameItem = {
        game_id: game.id,
        type: game.type,
        phase: game.phase,
        players: game.player_ids.length,
        max_players: game.max_players,
        current_round: game.current_round,
        total_rounds: game.total_rounds,
      };
      if (game.type === 'tragedy_of_commons') {
        item.resource_level = game.resource_level;
      }
      result.push(item);
    }
    return result;
  }

  getSpectatorState(gameId: string): SpectatorStateView {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const { pending_choices, pending_reasoning: _pr, messages, ...rest } = game;
    const result: any = {
      ...rest,
      pending_count: Object.keys(pending_choices).length,
    };
    if (game.type === 'schelling_point' && game.current_board) {
      result.board_text = boardToText(game.current_board);
    }
    if (game.config.allow_communication && messages.length > 0) {
      result.messages = messages.slice(-50);
    }
    return result;
  }

  createGame(
    type: ClassicGameType,
    config: Partial<ClassicGameConfig> | undefined,
    playerId: string,
  ): ClassicGameSession {
    const def = GAME_DEFS[type];
    if (!def) throw new Error(`Unknown classic game type: ${type}`);

    const gameId = `classic_${uuid().slice(0, 12)}`;
    const rounds = config?.rounds ?? def.default_rounds;

    const session: ClassicGameSession = {
      id: gameId,
      type,
      config: {
        rounds,
        allow_communication: config?.allow_communication ?? false,
        ...config,
      },
      player_ids: [playerId],
      min_players: def.min_players,
      max_players: def.max_players,
      current_round: 1,
      total_rounds: rounds,
      history: [],
      scores: { [playerId]: 0 },
      pending_choices: {},
      pending_reasoning: {},
      phase: 'waiting',
      messages: [],
      created_at: new Date(),
      last_activity: Date.now(),
    };

    if (type === 'tragedy_of_commons') {
      session.resource_level = TRAGEDY_INITIAL_RESOURCE;
      session.ended_by_depletion = false;
    }

    if (type === 'schelling_point') {
      session.config.allow_communication = false;
      session.current_board = generateBoard(8, 8, Date.now() ^ (seed_counter++));
    }

    this.games.set(gameId, session);
    return session;
  }

  joinGame(gameId: string, playerId: string): ClassicGameSession {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (game.phase === 'complete') throw new Error('Game is already complete');
    if (game.player_ids.includes(playerId)) return game;
    if (game.player_ids.length >= game.max_players) throw new Error('Game is full');

    game.player_ids.push(playerId);
    game.scores[playerId] = 0;

    if (game.player_ids.length >= game.min_players && game.phase === 'waiting') {
      game.phase = 'playing';
    }

    return game;
  }

  submitChoice(
    gameId: string,
    playerId: string,
    choice: string,
    reasoning?: string,
  ): SubmitChoiceResult {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (game.phase !== 'playing')
      throw new Error(`Game is not in playing phase (current: ${game.phase})`);
    if (!game.player_ids.includes(playerId))
      throw new Error('You are not in this game');

    const def = GAME_DEFS[game.type];

    if (game.type === 'tragedy_of_commons') {
      const rate = parseFloat(choice);
      if (isNaN(rate) || rate < 0.0 || rate > 1.0) {
        throw new Error(
          `Invalid extraction rate "${choice}". Must be a number between 0.0 and 1.0`,
        );
      }
    } else if (game.type === 'schelling_point') {
      const parts = choice.split(',');
      if (parts.length !== 2) {
        throw new Error(`Invalid coordinate "${choice}". Format: "row,col" (e.g., "3,5")`);
      }
      const row = parseInt(parts[0], 10);
      const col = parseInt(parts[1], 10);
      if (isNaN(row) || isNaN(col)) {
        throw new Error(`Invalid coordinate "${choice}". Row and col must be numbers.`);
      }
      const board = game.current_board;
      if (board && (row < 0 || row >= board.height || col < 0 || col >= board.width)) {
        throw new Error(
          `Coordinate "${choice}" out of bounds. Board is ${board.height}×${board.width} (0-indexed).`,
        );
      }
    } else if (!def.valid_choices.includes(choice)) {
      throw new Error(
        `Invalid choice "${choice}". Valid choices: ${def.valid_choices.join(', ')}`,
      );
    }

    if (game.pending_choices[playerId] !== undefined) {
      throw new Error('You have already submitted a choice this round');
    }

    game.pending_choices[playerId] = choice;
    game.last_activity = Date.now();
    if (reasoning) {
      game.pending_reasoning[playerId] = reasoning;
    }

    const allSubmitted = game.player_ids.every(
      (id) => game.pending_choices[id] !== undefined,
    );
    if (allSubmitted) {
      const result = this.resolveRound(game);
      const response: SubmitChoiceResult = {
        submitted: true,
        round_resolved: true,
        result,
      };
      if (game.type === 'tragedy_of_commons') {
        response.resource_level = game.resource_level;
      }
      return response;
    }

    return { submitted: true };
  }

  getClassicState(gameId: string, playerId: string): ClassicStateView {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);

    if (game.phase === 'playing') {
      game.last_activity = Date.now();
    }

    const def = GAME_DEFS[game.type];

    const validChoices =
      game.type === 'tragedy_of_commons'
        ? ['0.0 to 1.0 (numeric extraction rate)']
        : game.type === 'schelling_point'
        ? ['"row,col" coordinates (e.g., "3,5")']
        : def.valid_choices;

    const result: ClassicStateView = {
      game_id: game.id,
      type: game.type,
      phase: game.phase,
      current_round: game.current_round,
      total_rounds: game.total_rounds,
      players: game.player_ids.length,
      player_ids: game.player_ids,
      my_score: game.scores[playerId] ?? 0,
      scores: { ...game.scores },
      history: game.history,
      has_submitted: game.pending_choices[playerId] !== undefined,
      waiting_on: game.player_ids.filter(
        (id) => game.pending_choices[id] === undefined,
      ).length,
      valid_choices: validChoices,
      allow_communication: game.config.allow_communication,
    };

    if (game.type === 'tragedy_of_commons') {
      result.resource_level = game.resource_level;
      result.ended_by_depletion = game.ended_by_depletion;
    }

    if (game.type === 'schelling_point' && game.current_board) {
      result.board = boardToText(game.current_board);
      result.board_grid = game.current_board.cells;
      result.board_width = game.current_board.width;
      result.board_height = game.current_board.height;
    }

    return result;
  }

  sendMessage(gameId: string, playerId: string, content: string): { sent: true } {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (!game.config.allow_communication)
      throw new Error('Communication is not enabled for this game');
    if (!game.player_ids.includes(playerId))
      throw new Error('You are not in this game');

    game.messages.push({ from: playerId, content, timestamp: Date.now() });
    game.last_activity = Date.now();
    return { sent: true };
  }

  getMessages(
    gameId: string,
    playerId: string,
  ): Array<{ from: string; content: string; timestamp: number }> {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (!game.config.allow_communication)
      throw new Error('Communication is not enabled for this game');
    if (!game.player_ids.includes(playerId))
      throw new Error('You are not in this game');
    return game.messages.slice(-50);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private cleanStaleGames(): void {
    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;
    const THIRTY_MINUTES = 30 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;

    for (const [id, game] of this.games) {
      if (game.phase === 'complete' && now - game.last_activity > ONE_HOUR) {
        this.games.delete(id);
        continue;
      }
      if (
        game.phase === 'waiting' &&
        now - game.created_at.getTime() > TEN_MINUTES
      ) {
        console.log(
          `[CF] Cleaning stale classic lobby ${id.slice(0, 16)} (${game.type}, age ${Math.round(
            (now - game.created_at.getTime()) / 60000,
          )}min)`,
        );
        this.games.delete(id);
        continue;
      }
      if (game.phase === 'playing' && now - game.last_activity > THIRTY_MINUTES) {
        console.log(
          `[CF] Cleaning abandoned classic game ${id.slice(0, 16)} (${game.type}, inactive ${Math.round(
            (now - game.last_activity) / 60000,
          )}min)`,
        );
        game.phase = 'complete';
        this.fireGameEndCallbacks(game);
        continue;
      }
    }
  }

  private resolveRound(game: ClassicGameSession): ClassicRoundResult {
    if (game.type === 'tragedy_of_commons') return this.resolveTragedyRound(game);
    if (game.type === 'schelling_point') return this.resolveSchellingRound(game);

    const def = GAME_DEFS[game.type];
    const payoffs = def.resolvePayoffs(game.pending_choices, game.player_ids);

    const result: ClassicRoundResult = {
      round: game.current_round,
      choices: { ...game.pending_choices },
      payoffs,
    };
    if (Object.keys(game.pending_reasoning).length > 0) {
      result.reasoning = { ...game.pending_reasoning };
    }

    game.history.push(result);

    for (const id of game.player_ids) {
      game.scores[id] = (game.scores[id] ?? 0) + (payoffs[id] ?? 0);
    }

    game.pending_choices = {};
    game.pending_reasoning = {};
    game.current_round++;

    if (game.current_round > game.total_rounds) {
      game.phase = 'complete';
      this.fireGameEndCallbacks(game);
    }

    return result;
  }

  private resolveTragedyRound(game: ClassicGameSession): ClassicRoundResult {
    const n = game.player_ids.length;
    const resource = game.resource_level ?? TRAGEDY_INITIAL_RESOURCE;

    const rates: Record<string, number> = {};
    let totalExtraction = 0;
    for (const id of game.player_ids) {
      const rate = parseFloat(game.pending_choices[id]);
      rates[id] = isNaN(rate) ? 0.5 : Math.max(0, Math.min(1, rate));
      totalExtraction += (rates[id] * resource) / n;
    }

    const payoffs: Record<string, number> = {};
    for (const id of game.player_ids) {
      payoffs[id] = Math.round((rates[id] * resource) / n * 100) / 100;
    }

    const growth = TRAGEDY_GROWTH_RATE * resource * (1 - resource / TRAGEDY_CAPACITY);
    const newResource = Math.max(
      0,
      Math.round((resource + growth - totalExtraction) * 100) / 100,
    );

    game.resource_level = newResource;

    const result: ClassicRoundResult = {
      round: game.current_round,
      choices: { ...game.pending_choices },
      payoffs,
      resource_after: newResource,
    };
    if (Object.keys(game.pending_reasoning).length > 0) {
      result.reasoning = { ...game.pending_reasoning };
    }

    game.history.push(result);

    for (const id of game.player_ids) {
      game.scores[id] = (game.scores[id] ?? 0) + (payoffs[id] ?? 0);
    }

    game.pending_choices = {};
    game.pending_reasoning = {};
    game.current_round++;

    if (newResource <= 0) {
      game.resource_level = 0;
      game.ended_by_depletion = true;
      game.phase = 'complete';
      this.fireGameEndCallbacks(game);
    } else if (game.current_round > game.total_rounds) {
      game.phase = 'complete';
      this.fireGameEndCallbacks(game);
    }

    return result;
  }

  private resolveSchellingRound(game: ClassicGameSession): ClassicRoundResult {
    const board = game.current_board!;
    const n = game.player_ids.length;

    const coords: Record<string, [number, number]> = {};
    for (const id of game.player_ids) {
      const parts = game.pending_choices[id].split(',');
      coords[id] = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
    }

    const payoffs: Record<string, number> = {};
    for (const id of game.player_ids) payoffs[id] = 0;

    for (let i = 0; i < game.player_ids.length; i++) {
      for (let j = i + 1; j < game.player_ids.length; j++) {
        const a = game.player_ids[i];
        const b = game.player_ids[j];
        const dist =
          Math.abs(coords[a][0] - coords[b][0]) +
          Math.abs(coords[a][1] - coords[b][1]);
        const pairScore = Math.max(0, 15 - dist);
        payoffs[a] += pairScore;
        payoffs[b] += pairScore;

        if (dist === 0) {
          payoffs[a] += 10;
          payoffs[b] += 10;
        }
      }
    }

    const allSame = game.player_ids.every(
      (id) =>
        coords[id][0] === coords[game.player_ids[0]][0] &&
        coords[id][1] === coords[game.player_ids[0]][1],
    );
    if (allSame && n >= 2) {
      for (const id of game.player_ids) {
        payoffs[id] += 20 * n;
      }
    }

    const result: ClassicRoundResult = {
      round: game.current_round,
      choices: { ...game.pending_choices },
      payoffs,
      board,
    };
    if (Object.keys(game.pending_reasoning).length > 0) {
      result.reasoning = { ...game.pending_reasoning };
    }

    game.history.push(result);

    for (const id of game.player_ids) {
      game.scores[id] = (game.scores[id] ?? 0) + (payoffs[id] ?? 0);
    }

    game.pending_choices = {};
    game.pending_reasoning = {};
    game.current_round++;

    if (game.current_round > game.total_rounds) {
      game.phase = 'complete';
      this.fireGameEndCallbacks(game);
    } else {
      game.current_board = generateBoard(8, 8, Date.now() ^ (seed_counter++));
    }

    return result;
  }

  private fireGameEndCallbacks(game: ClassicGameSession): void {
    for (const cb of this.gameEndCallbacks) {
      try {
        cb(game.id, game);
      } catch (err) {
        console.error('[LegacyClassicsBackend] Game end callback error:', err);
      }
    }
  }
}
