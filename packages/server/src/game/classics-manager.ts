import { v4 as uuid } from 'uuid';
import { generateBoard, boardToText } from './schelling-board.js';
import type { SchellingBoard } from './schelling-board.js';

// ---------------------------------------------------------------------------
// Types for classic game engines (placeholder interfaces until engine files exist)
// ---------------------------------------------------------------------------

export type ClassicGameType = 'prisoners_dilemma' | 'stag_hunt' | 'tragedy_of_commons' | 'schelling_point';

export interface ClassicRoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
  /** For tragedy_of_commons: resource level after this round resolved */
  resource_after?: number;
  /** For schelling_point: the board used this round */
  board?: SchellingBoard;
  /** Chain-of-thought reasoning submitted with choices (spectator-only, never shown to players) */
  reasoning?: Record<string, string>;
}

export interface ClassicGameConfig {
  rounds: number;
  allow_communication: boolean;
  [key: string]: unknown;
}

export interface ClassicGameSession {
  id: string;
  type: ClassicGameType;
  config: ClassicGameConfig;
  player_ids: string[];
  min_players: number;
  max_players: number;
  current_round: number;
  total_rounds: number;
  history: ClassicRoundResult[];
  scores: Record<string, number>;
  pending_choices: Record<string, string>;
  /** Chain-of-thought reasoning (stored per-round, never shown to players) */
  pending_reasoning: Record<string, string>;
  phase: 'waiting' | 'playing' | 'complete';
  messages: Array<{ from: string; content: string; timestamp: number }>;
  created_at: Date;
  /** Tragedy of the Commons: current resource level (starts at 100) */
  resource_level?: number;
  /** Tragedy of the Commons: true if game ended because resource hit 0 */
  ended_by_depletion?: boolean;
  /** Schelling Point: current board for this round */
  current_board?: SchellingBoard;
  /** Last activity timestamp (choice submission or message) */
  last_activity: number;
}

// ---------------------------------------------------------------------------
// Game-type definitions: payoff matrices & rules
// ---------------------------------------------------------------------------

interface PayoffEntry {
  payoffs: Record<string, number>;
}

type PayoffResolver = (choices: Record<string, string>, playerIds: string[]) => Record<string, number>;

const GAME_DEFS: Record<ClassicGameType, {
  description: string;
  min_players: number;
  max_players: number;
  valid_choices: string[];
  default_rounds: number;
  resolvePayoffs: PayoffResolver;
}> = {
  prisoners_dilemma: {
    description: 'Iterated Prisoner\'s Dilemma — cooperate or defect each round',
    min_players: 2,
    max_players: 2,
    valid_choices: ['cooperate', 'defect'],
    default_rounds: 10,
    resolvePayoffs(choices, playerIds) {
      const [p1, p2] = playerIds;
      const c1 = choices[p1];
      const c2 = choices[p2];
      if (c1 === 'cooperate' && c2 === 'cooperate') return { [p1]: 3, [p2]: 3 };
      if (c1 === 'defect' && c2 === 'defect') return { [p1]: 1, [p2]: 1 };
      if (c1 === 'defect') return { [p1]: 5, [p2]: 0 };
      return { [p1]: 0, [p2]: 5 };
    },
  },
  stag_hunt: {
    description: 'Stag Hunt — coordinate on stag (risky, high reward) or play it safe with hare',
    min_players: 2,
    max_players: 2,
    valid_choices: ['stag', 'hare'],
    default_rounds: 10,
    resolvePayoffs(choices, playerIds) {
      const [p1, p2] = playerIds;
      const c1 = choices[p1];
      const c2 = choices[p2];
      if (c1 === 'stag' && c2 === 'stag') return { [p1]: 4, [p2]: 4 };
      if (c1 === 'hare' && c2 === 'hare') return { [p1]: 2, [p2]: 2 };
      if (c1 === 'stag') return { [p1]: 0, [p2]: 3 };
      return { [p1]: 3, [p2]: 0 };
    },
  },
  tragedy_of_commons: {
    description: 'Tragedy of the Commons — choose an extraction rate (0.0 = conserve, 1.0 = full exploit) from a shared resource pool',
    min_players: 2,
    max_players: 6,
    valid_choices: [], // numeric 0.0-1.0 — validated separately
    default_rounds: 10,
    // NOTE: For tragedy_of_commons, payoffs are computed inside resolveRound
    // using the session's resource_level. This resolver is a fallback that
    // should not be called directly for tragedy games.
    resolvePayoffs(choices, playerIds) {
      // Fallback — the real logic is in resolveTragedyRound
      const n = playerIds.length;
      const payoffs: Record<string, number> = {};
      for (const id of playerIds) {
        const rate = parseFloat(choices[id]);
        payoffs[id] = Math.round((isNaN(rate) ? 0 : rate) * 100 / n * 100) / 100;
      }
      return payoffs;
    },
  },
  schelling_point: {
    description: 'Schelling Point — independently choose a location on a shared map. No communication. Converge on the focal point.',
    min_players: 2,
    max_players: 6,
    valid_choices: [], // coordinate format "row,col" — validated separately
    default_rounds: 5,
    resolvePayoffs(_choices, playerIds) {
      // Fallback — the real logic is in resolveSchellingRound
      const payoffs: Record<string, number> = {};
      for (const id of playerIds) payoffs[id] = 0;
      return payoffs;
    },
  },
};

// Tragedy of the Commons constants
const TRAGEDY_CAPACITY = 100;
const TRAGEDY_GROWTH_RATE = 0.3;
const TRAGEDY_INITIAL_RESOURCE = 100;

// Schelling board seed counter for unique boards
let seed_counter = 1;

// ---------------------------------------------------------------------------
// ClassicsManager
// ---------------------------------------------------------------------------

export type ClassicGameEndCallback = (
  gameId: string,
  session: ClassicGameSession,
) => void;

export class ClassicsManager {
  private games = new Map<string, ClassicGameSession>();
  private gameEndCallbacks: ClassicGameEndCallback[] = [];

  constructor() {
    // Clean up stale classic games every 60 seconds
    setInterval(() => this.cleanStaleGames(), 60_000);
  }

  /** Remove waiting lobbies (5 min) and inactive playing games (10 min) */
  private cleanStaleGames(): void {
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    const TEN_MINUTES = 10 * 60 * 1000;

    for (const [id, game] of this.games) {
      if (game.phase === 'complete') {
        // Remove completed games after 30 minutes to free memory
        if (now - game.last_activity > 30 * 60 * 1000) {
          this.games.delete(id);
        }
        continue;
      }

      if (game.phase === 'waiting' && now - game.created_at.getTime() > FIVE_MINUTES) {
        console.log(`[CF] Cleaning stale classic lobby ${id.slice(0, 16)} (${game.type}, age ${Math.round((now - game.created_at.getTime()) / 60000)}min)`);
        this.games.delete(id);
        continue;
      }

      if (game.phase === 'playing' && now - game.last_activity > TEN_MINUTES) {
        console.log(`[CF] Cleaning inactive classic game ${id.slice(0, 16)} (${game.type}, inactive ${Math.round((now - game.last_activity) / 60000)}min)`);
        game.phase = 'complete';
        this.fireGameEndCallbacks(game);
        continue;
      }
    }
  }

  /** Register a callback that fires when ANY classic game completes. */
  onGameComplete(callback: ClassicGameEndCallback): void {
    this.gameEndCallbacks.push(callback);
  }

  /** List available classic game types and open lobbies. */
  listClassics(): {
    game_types: Array<{ type: ClassicGameType; description: string; min_players: number; max_players: number; valid_choices: string[] }>;
    open_games: Array<{ game_id: string; type: ClassicGameType; players: number; min_players: number; max_players: number; phase: string }>;
  } {
    const game_types = (Object.entries(GAME_DEFS) as Array<[ClassicGameType, typeof GAME_DEFS[ClassicGameType]]>).map(
      ([type, def]) => ({
        type,
        description: def.description,
        min_players: def.min_players,
        max_players: def.max_players,
        valid_choices: type === 'tragedy_of_commons'
          ? ['0.0 to 1.0 (numeric extraction rate)']
          : type === 'schelling_point'
          ? ['"row,col" coordinates (e.g., "3,5")']
          : def.valid_choices,
      }),
    );

    const open_games: Array<{ game_id: string; type: ClassicGameType; players: number; min_players: number; max_players: number; phase: string }> = [];
    for (const [id, game] of this.games) {
      if (game.phase === 'waiting') {
        open_games.push({
          game_id: id,
          type: game.type,
          players: game.player_ids.length,
          min_players: game.min_players,
          max_players: game.max_players,
          phase: game.phase,
        });
      }
    }

    return { game_types, open_games };
  }

  /** Create a new classic game session. */
  createClassicGame(
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

    // Initialize tragedy-specific fields
    if (type === 'tragedy_of_commons') {
      session.resource_level = TRAGEDY_INITIAL_RESOURCE;
      session.ended_by_depletion = false;
    }

    // Initialize schelling_point-specific fields
    if (type === 'schelling_point') {
      session.config.allow_communication = false; // never allow comms for schelling
      session.current_board = generateBoard(8, 8, Date.now() ^ (seed_counter++));
    }

    this.games.set(gameId, session);
    return session;
  }

  /** Join an existing classic game. */
  joinClassicGame(gameId: string, playerId: string): ClassicGameSession {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (game.phase === 'complete') throw new Error('Game is already complete');
    if (game.player_ids.includes(playerId)) {
      // Already in game — just return current state
      return game;
    }
    if (game.player_ids.length >= game.max_players) throw new Error('Game is full');

    game.player_ids.push(playerId);
    game.scores[playerId] = 0;

    // Auto-start when minimum players reached
    if (game.player_ids.length >= game.min_players && game.phase === 'waiting') {
      game.phase = 'playing';
    }

    return game;
  }

  /** Submit a choice for the current round. Auto-resolves when all players have submitted. */
  submitChoice(gameId: string, playerId: string, choice: string, reasoning?: string): { submitted: true; round_resolved?: boolean; result?: ClassicRoundResult; resource_level?: number } {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (game.phase !== 'playing') throw new Error(`Game is not in playing phase (current: ${game.phase})`);
    if (!game.player_ids.includes(playerId)) throw new Error('You are not in this game');

    const def = GAME_DEFS[game.type];

    // Tragedy of the Commons accepts numeric extraction rates (0.0-1.0)
    if (game.type === 'tragedy_of_commons') {
      const rate = parseFloat(choice);
      if (isNaN(rate) || rate < 0.0 || rate > 1.0) {
        throw new Error(`Invalid extraction rate "${choice}". Must be a number between 0.0 and 1.0`);
      }
    } else if (game.type === 'schelling_point') {
      // Validate coordinate format "row,col"
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
        throw new Error(`Coordinate "${choice}" out of bounds. Board is ${board.height}×${board.width} (0-indexed).`);
      }
    } else if (!def.valid_choices.includes(choice)) {
      throw new Error(`Invalid choice "${choice}". Valid choices: ${def.valid_choices.join(', ')}`);
    }

    if (game.pending_choices[playerId] !== undefined) {
      throw new Error('You have already submitted a choice this round');
    }

    game.pending_choices[playerId] = choice;
    game.last_activity = Date.now();
    if (reasoning) {
      game.pending_reasoning[playerId] = reasoning;
    }

    // Check if all players have submitted
    const allSubmitted = game.player_ids.every(id => game.pending_choices[id] !== undefined);
    if (allSubmitted) {
      const result = this.resolveRound(game);
      const response: { submitted: true; round_resolved: boolean; result: ClassicRoundResult; resource_level?: number } = {
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

  /** Get the game state from a specific player's perspective. */
  getClassicState(gameId: string, playerId: string): {
    game_id: string;
    type: ClassicGameType;
    phase: string;
    current_round: number;
    total_rounds: number;
    players: number;
    player_ids: string[];
    my_score: number;
    scores: Record<string, number>;
    history: ClassicRoundResult[];
    has_submitted: boolean;
    waiting_on: number;
    valid_choices: string[];
    allow_communication: boolean;
    resource_level?: number;
    ended_by_depletion?: boolean;
  } {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);

    const def = GAME_DEFS[game.type];

    // For Tragedy/Schelling, communicate format instead of empty array
    const validChoices = game.type === 'tragedy_of_commons'
      ? ['0.0 to 1.0 (numeric extraction rate)']
      : game.type === 'schelling_point'
      ? ['"row,col" coordinates (e.g., "3,5")']
      : def.valid_choices;

    const result: any = {
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
      waiting_on: game.player_ids.filter(id => game.pending_choices[id] === undefined).length,
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

  /** Get spectator-safe game state (no pending choices revealed). */
  getSpectatorState(gameId: string): Omit<ClassicGameSession, 'pending_choices' | 'messages'> & { pending_count: number } | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const { pending_choices, pending_reasoning, messages, ...rest } = game;
    const result: any = {
      ...rest,
      pending_count: Object.keys(pending_choices).length,
    };
    if (game.type === 'schelling_point' && game.current_board) {
      result.board_text = boardToText(game.current_board);
    }
    // Include messages for spectators (chat + comms indicator)
    if (game.config.allow_communication && messages.length > 0) {
      result.messages = messages.slice(-50);
    }
    return result;
  }

  /** Send a chat message in a classic game (if communication is enabled). */
  sendMessage(gameId: string, playerId: string, content: string): { sent: boolean } {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (!game.config.allow_communication) throw new Error('Communication is not enabled for this game');
    if (!game.player_ids.includes(playerId)) throw new Error('You are not in this game');

    game.messages.push({
      from: playerId,
      content,
      timestamp: Date.now(),
    });
    game.last_activity = Date.now();

    return { sent: true };
  }

  /** Get chat messages for a classic game. */
  getMessages(gameId: string, playerId: string): Array<{ from: string; content: string; timestamp: number }> {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Classic game ${gameId} not found`);
    if (!game.config.allow_communication) throw new Error('Communication is not enabled for this game');
    if (!game.player_ids.includes(playerId)) throw new Error('You are not in this game');

    return game.messages.slice(-50);
  }

  /** List all non-complete games (for API). */
  listAllGames(): Array<{
    game_id: string;
    type: ClassicGameType;
    phase: string;
    players: number;
    max_players: number;
    current_round: number;
    total_rounds: number;
    resource_level?: number;
  }> {
    const result: Array<{
      game_id: string;
      type: ClassicGameType;
      phase: string;
      players: number;
      max_players: number;
      current_round: number;
      total_rounds: number;
      resource_level?: number;
    }> = [];

    for (const [_id, game] of this.games) {
      const item: any = {
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

  /** Get a game session by ID (for testing / internal use). */
  getGame(gameId: string): ClassicGameSession | undefined {
    return this.games.get(gameId);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveRound(game: ClassicGameSession): ClassicRoundResult {
    // Use special logic for tragedy_of_commons
    if (game.type === 'tragedy_of_commons') {
      return this.resolveTragedyRound(game);
    }
    if (game.type === 'schelling_point') {
      return this.resolveSchellingRound(game);
    }

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

  /**
   * Tragedy of the Commons round resolution with logistic growth.
   *
   * Resource regeneration:
   *   new_resource = resource + growth_rate * resource * (1 - resource/capacity) - total_extraction
   *
   * Player payoff per round:
   *   extraction_rate * resource_level / num_players
   *
   * Game ends if resource hits 0 (tragedy) or all rounds complete.
   */
  private resolveTragedyRound(game: ClassicGameSession): ClassicRoundResult {
    const n = game.player_ids.length;
    const resource = game.resource_level ?? TRAGEDY_INITIAL_RESOURCE;

    // Parse extraction rates
    const rates: Record<string, number> = {};
    let totalExtraction = 0;
    for (const id of game.player_ids) {
      const rate = parseFloat(game.pending_choices[id]);
      rates[id] = isNaN(rate) ? 0.5 : Math.max(0, Math.min(1, rate));
      // Each player extracts: rate * resource / n
      totalExtraction += rates[id] * resource / n;
    }

    // Calculate payoffs: extraction_rate * resource_level / num_players
    const payoffs: Record<string, number> = {};
    for (const id of game.player_ids) {
      payoffs[id] = Math.round(rates[id] * resource / n * 100) / 100;
    }

    // Apply logistic growth then subtract extraction
    // new_resource = resource + growth_rate * resource * (1 - resource/capacity) - total_extraction
    const growth = TRAGEDY_GROWTH_RATE * resource * (1 - resource / TRAGEDY_CAPACITY);
    const newResource = Math.max(0, Math.round((resource + growth - totalExtraction) * 100) / 100);

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

    // Check end conditions
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

  /**
   * Schelling Point round resolution.
   *
   * Scoring: For each pair of players, score = max(0, 15 - manhattan_distance).
   * Same-cell bonus: +10 per matching pair.
   * All-same bonus: +20 × N if every player chose the same cell.
   */
  private resolveSchellingRound(game: ClassicGameSession): ClassicRoundResult {
    const board = game.current_board!;
    const n = game.player_ids.length;

    // Parse coordinates
    const coords: Record<string, [number, number]> = {};
    for (const id of game.player_ids) {
      const parts = game.pending_choices[id].split(',');
      coords[id] = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
    }

    // Calculate pairwise scoring
    const payoffs: Record<string, number> = {};
    for (const id of game.player_ids) payoffs[id] = 0;

    for (let i = 0; i < game.player_ids.length; i++) {
      for (let j = i + 1; j < game.player_ids.length; j++) {
        const a = game.player_ids[i];
        const b = game.player_ids[j];
        const dist = Math.abs(coords[a][0] - coords[b][0]) + Math.abs(coords[a][1] - coords[b][1]);
        const pairScore = Math.max(0, 15 - dist);
        payoffs[a] += pairScore;
        payoffs[b] += pairScore;

        // Same-cell bonus
        if (dist === 0) {
          payoffs[a] += 10;
          payoffs[b] += 10;
        }
      }
    }

    // All-same bonus: if every player chose the same cell
    const allSame = game.player_ids.every(
      id => coords[id][0] === coords[game.player_ids[0]][0] &&
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
      // Generate a new board for the next round
      game.current_board = generateBoard(8, 8, Date.now() ^ (seed_counter++));
    }

    return result;
  }

  private fireGameEndCallbacks(game: ClassicGameSession): void {
    for (const cb of this.gameEndCallbacks) {
      try {
        cb(game.id, game);
      } catch (err) {
        console.error('[ClassicsManager] Game end callback error:', err);
      }
    }
  }
}
