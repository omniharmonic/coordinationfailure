import { v4 as uuid } from 'uuid';

// ---------------------------------------------------------------------------
// Types for classic game engines (placeholder interfaces until engine files exist)
// ---------------------------------------------------------------------------

export type ClassicGameType = 'prisoners_dilemma' | 'stag_hunt' | 'tragedy_of_commons';

export interface ClassicRoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
  /** For tragedy_of_commons: resource level after this round resolved */
  resource_after?: number;
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
  phase: 'waiting' | 'playing' | 'complete';
  messages: Array<{ from: string; content: string; timestamp: number }>;
  created_at: Date;
  /** Tragedy of the Commons: current resource level (starts at 100) */
  resource_level?: number;
  /** Tragedy of the Commons: true if game ended because resource hit 0 */
  ended_by_depletion?: boolean;
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
};

// Tragedy of the Commons constants
const TRAGEDY_CAPACITY = 100;
const TRAGEDY_GROWTH_RATE = 0.3;
const TRAGEDY_INITIAL_RESOURCE = 100;

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
      phase: 'waiting',
      messages: [],
      created_at: new Date(),
    };

    // Initialize tragedy-specific fields
    if (type === 'tragedy_of_commons') {
      session.resource_level = TRAGEDY_INITIAL_RESOURCE;
      session.ended_by_depletion = false;
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
  submitChoice(gameId: string, playerId: string, choice: string): { submitted: true; round_resolved?: boolean; result?: ClassicRoundResult; resource_level?: number } {
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
    } else if (!def.valid_choices.includes(choice)) {
      throw new Error(`Invalid choice "${choice}". Valid choices: ${def.valid_choices.join(', ')}`);
    }

    if (game.pending_choices[playerId] !== undefined) {
      throw new Error('You have already submitted a choice this round');
    }

    game.pending_choices[playerId] = choice;

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

    // For Tragedy, communicate numeric range instead of empty array
    const validChoices = game.type === 'tragedy_of_commons'
      ? ['0.0 to 1.0 (numeric extraction rate)']
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

    return result;
  }

  /** Get spectator-safe game state (no pending choices revealed). */
  getSpectatorState(gameId: string): Omit<ClassicGameSession, 'pending_choices' | 'messages'> & { pending_count: number } | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const { pending_choices, messages, ...rest } = game;
    return {
      ...rest,
      pending_count: Object.keys(pending_choices).length,
    };
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

    const def = GAME_DEFS[game.type];
    const payoffs = def.resolvePayoffs(game.pending_choices, game.player_ids);

    const result: ClassicRoundResult = {
      round: game.current_round,
      choices: { ...game.pending_choices },
      payoffs,
    };

    game.history.push(result);

    for (const id of game.player_ids) {
      game.scores[id] = (game.scores[id] ?? 0) + (payoffs[id] ?? 0);
    }

    game.pending_choices = {};
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

    game.history.push(result);

    for (const id of game.player_ids) {
      game.scores[id] = (game.scores[id] ?? 0) + (payoffs[id] ?? 0);
    }

    game.pending_choices = {};
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
