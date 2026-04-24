/**
 * PluginClassicsBackend — drives Lucian's CoordinationGame plugins via
 * GameRoom while exposing the legacy ClassicsManager MCP surface.
 *
 * The plugin runtime models state differently (per-player records, phases,
 * typed actions, deadline-driven timers). This backend wraps a GameRoom in
 * a "virtual session" that tracks the bookkeeping legacy callers expect
 * (snake_case game types, side-band chat messages, optional reasoning,
 * cumulative scores, round history in legacy shape).
 *
 * Note on semantics: the plugin implementations use their own payoff
 * matrices and growth dynamics (intentionally — they were designed for
 * Lucian's on-chain framework, not for bit-compatibility with the legacy
 * engine). Agents that switch a game type from legacy → plugin will see
 * different numeric scores. The MCP contract (tool names, argument
 * shapes, return shapes) is preserved; the game logic underneath is not.
 */

import { v4 as uuid } from 'uuid';
import { GameRoom } from '@coordination-games/engine';

import {
  PrisonersDilemmaPlugin,
  DEFAULT_PD_CONFIG,
  type PDConfig,
  type PDState,
  type PDAction,
} from '@coordination-failure/game-prisoners-dilemma';
import {
  StagHuntPlugin,
  DEFAULT_SH_CONFIG,
  type SHConfig,
  type SHState,
  type SHAction,
} from '@coordination-failure/game-stag-hunt';
import {
  TragedyCommonsPlugin,
  DEFAULT_TC_CONFIG,
  type TCConfig,
  type TCState,
  type TCAction,
} from '@coordination-failure/game-tragedy-commons';

import type { ClassicsBackend, ClassicsBackendName } from './classics-backend.js';
import {
  GAME_DEFS,
  type ClassicGameConfig,
  type ClassicGameEndCallback,
  type ClassicGameSession,
  type ClassicGameType,
  type ClassicRoundResult,
  type ClassicStateView,
  type ClassicsCatalog,
  type ListGameItem,
  type SpectatorStateView,
  type SubmitChoiceResult,
} from './classics-shared.js';

// ---------------------------------------------------------------------------
// Type wiring
// ---------------------------------------------------------------------------

/** Game types this backend can run (Schelling Point has no plugin yet). */
const SUPPORTED_TYPES: ReadonlyArray<ClassicGameType> = Object.freeze([
  'prisoners_dilemma',
  'stag_hunt',
  'tragedy_of_commons',
]);

/** Map legacy snake_case → plugin kebab-case for logging/diagnostics. */
const PLUGIN_GAME_TYPE: Record<Exclude<ClassicGameType, 'schelling_point'>, string> = {
  prisoners_dilemma: 'prisoners-dilemma',
  stag_hunt: 'stag-hunt',
  tragedy_of_commons: 'tragedy-commons',
};

type PluginGameType = Exclude<ClassicGameType, 'schelling_point'>;

// A GameRoom instance typed loosely so the Map can hold rooms for all three plugins.
type AnyRoom = GameRoom<any, any, any, any>;

/** Bookkeeping the legacy surface needs but the plugins don't model. */
interface VirtualSession {
  id: string;
  type: PluginGameType;
  config: ClassicGameConfig;
  /** Players who've registered via createGame + joinGame (all join in lobby). */
  pendingPlayerIds: string[];
  /** When true, the GameRoom has been created + game_start dispatched. */
  started: boolean;
  /** The active GameRoom once started. */
  room: AnyRoom | null;
  /** Legacy-shaped score totals, mirrored from the plugin state per round. */
  scores: Record<string, number>;
  /** Legacy-shaped round history, synthesized on each round resolve. */
  history: ClassicRoundResult[];
  /** Out-of-band chat log (legacy parity — plugins don't store free-form chat). */
  messages: Array<{ from: string; content: string; timestamp: number }>;
  /** Reasoning attached to the pending choices for the current round. */
  pendingReasoning: Record<string, string>;
  /** Whether the plugin currently shows this game as over. */
  complete: boolean;
  endedByDepletion: boolean;
  createdAt: Date;
  lastActivity: number;
}

const TRAGEDY_PAYOFF_PRECISION = 100; // match legacy rounding to 2dp for resource_after

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class PluginClassicsBackend implements ClassicsBackend {
  readonly name: ClassicsBackendName = 'plugin';
  readonly supportedTypes = SUPPORTED_TYPES;

  private sessions = new Map<string, VirtualSession>();
  private gameEndCallbacks: ClassicGameEndCallback[] = [];
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: { enableCleanup?: boolean } = {}) {
    if (options.enableCleanup !== false) {
      this.cleanupHandle = setInterval(() => this.cleanStaleGames(), 60_000);
    }
  }

  stopCleanup(): void {
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle);
      this.cleanupHandle = null;
    }
    // Cancel every outstanding deadline timer so the process can exit cleanly.
    for (const sess of this.sessions.values()) {
      sess.room?.cancelTimer();
    }
  }

  hasGame(gameId: string): boolean {
    return this.sessions.has(gameId);
  }

  getGame(gameId: string): ClassicGameSession | undefined {
    const sess = this.sessions.get(gameId);
    return sess ? this.sessionToLegacyShape(sess) : undefined;
  }

  onGameComplete(cb: ClassicGameEndCallback): void {
    this.gameEndCallbacks.push(cb);
  }

  listOpenGames(): ClassicsCatalog['open_games'] {
    const out: ClassicsCatalog['open_games'] = [];
    for (const sess of this.sessions.values()) {
      if (!sess.started && !sess.complete) {
        const def = GAME_DEFS[sess.type];
        out.push({
          game_id: sess.id,
          type: sess.type,
          players: sess.pendingPlayerIds.length,
          min_players: def.min_players,
          max_players: def.max_players,
          phase: 'waiting',
        });
      }
    }
    return out;
  }

  listAllGames(): ListGameItem[] {
    const result: ListGameItem[] = [];
    for (const sess of this.sessions.values()) {
      const def = GAME_DEFS[sess.type];
      const item: ListGameItem = {
        game_id: sess.id,
        type: sess.type,
        phase: this.phaseOf(sess),
        players: sess.pendingPlayerIds.length,
        max_players: def.max_players,
        current_round: this.currentRoundOf(sess),
        total_rounds: sess.config.rounds,
      };
      if (sess.type === 'tragedy_of_commons' && sess.room) {
        item.resource_level = (sess.room.state as TCState).resourceLevel;
      }
      result.push(item);
    }
    return result;
  }

  getSpectatorState(gameId: string): SpectatorStateView {
    const sess = this.sessions.get(gameId);
    if (!sess) return undefined;
    const session = this.sessionToLegacyShape(sess);
    const { pending_choices, pending_reasoning: _pr, messages, ...rest } = session;
    const result: any = {
      ...rest,
      pending_count: Object.keys(pending_choices).length,
    };
    if (sess.config.allow_communication && sess.messages.length > 0) {
      result.messages = sess.messages.slice(-50);
    }
    return result;
  }

  createGame(
    type: ClassicGameType,
    config: Partial<ClassicGameConfig> | undefined,
    playerId: string,
  ): ClassicGameSession {
    if (type === 'schelling_point') {
      throw new Error(
        'PluginClassicsBackend does not support schelling_point — use the legacy backend for that type',
      );
    }
    if (!SUPPORTED_TYPES.includes(type)) {
      throw new Error(`Unknown classic game type: ${type}`);
    }

    const def = GAME_DEFS[type];
    const rounds = config?.rounds ?? def.default_rounds;
    const gameId = `classic_${uuid().slice(0, 12)}`;

    const sess: VirtualSession = {
      id: gameId,
      type: type as PluginGameType,
      config: {
        rounds,
        allow_communication: config?.allow_communication ?? false,
        ...config,
      },
      pendingPlayerIds: [playerId],
      started: false,
      room: null,
      scores: { [playerId]: 0 },
      history: [],
      messages: [],
      pendingReasoning: {},
      complete: false,
      endedByDepletion: false,
      createdAt: new Date(),
      lastActivity: Date.now(),
    };

    this.sessions.set(gameId, sess);
    return this.sessionToLegacyShape(sess);
  }

  joinGame(gameId: string, playerId: string): ClassicGameSession {
    const sess = this.sessions.get(gameId);
    if (!sess) throw new Error(`Classic game ${gameId} not found`);
    if (sess.complete) throw new Error('Game is already complete');
    if (sess.pendingPlayerIds.includes(playerId)) {
      return this.sessionToLegacyShape(sess);
    }

    // Plugin runtimes bind playerIds into createInitialState and cannot accept
    // late joiners after game_start has fired. This is the one documented
    // semantic difference from the legacy backend: agents coordinating an
    // open-ended game type (stag_hunt, tragedy_of_commons) must all join
    // before the min_players threshold trips the auto-start. Games that
    // already support this shape trivially (prisoners_dilemma with
    // min=max=2) are unaffected because no late-join window exists.
    if (sess.started) {
      throw new Error(
        'Game has already started — plugin backend does not support late joins. ' +
          'Create a new game and have all players join before the min_players threshold is reached.',
      );
    }

    const def = GAME_DEFS[sess.type];
    if (sess.pendingPlayerIds.length >= def.max_players)
      throw new Error('Game is full');

    sess.pendingPlayerIds.push(playerId);
    sess.scores[playerId] = 0;

    if (!sess.started && sess.pendingPlayerIds.length >= def.min_players) {
      this.startGame(sess);
    }

    return this.sessionToLegacyShape(sess);
  }

  submitChoice(
    gameId: string,
    playerId: string,
    choice: string,
    reasoning?: string,
  ): SubmitChoiceResult {
    const sess = this.sessions.get(gameId);
    if (!sess) throw new Error(`Classic game ${gameId} not found`);
    if (!sess.started || !sess.room)
      throw new Error(`Game is not in playing phase (current: ${this.phaseOf(sess)})`);
    if (sess.complete)
      throw new Error(`Game is not in playing phase (current: complete)`);
    if (!sess.pendingPlayerIds.includes(playerId))
      throw new Error('You are not in this game');

    // Type + range validation before touching the plugin.
    const def = GAME_DEFS[sess.type];
    if (sess.type === 'tragedy_of_commons') {
      const rate = parseFloat(choice);
      if (isNaN(rate) || rate < 0.0 || rate > 1.0) {
        throw new Error(
          `Invalid extraction rate "${choice}". Must be a number between 0.0 and 1.0`,
        );
      }
    } else if (!def.valid_choices.includes(choice)) {
      throw new Error(
        `Invalid choice "${choice}". Valid choices: ${def.valid_choices.join(', ')}`,
      );
    }

    // Duplicate-submit guard matches legacy error message exactly.
    if (this.playerHasSubmitted(sess, playerId)) {
      throw new Error('You have already submitted a choice this round');
    }

    const action = this.translateAction(sess.type, choice);
    if (reasoning) sess.pendingReasoning[playerId] = reasoning;
    sess.lastActivity = Date.now();

    const roundBefore = this.pluginRound(sess);
    const result = sess.room.handleAction(playerId, action) as unknown as
      | Promise<{ success: boolean; error?: string }>
      | { success: boolean; error?: string };

    // handleAction is async; GameRoom returns a Promise. We need to resolve it
    // synchronously for the legacy contract. Every classic plugin's applyAction
    // is synchronous, so the only async boundary is the Promise wrapper. We
    // block on it via Promise.resolve so await isn't required at the call site.
    // If plugins ever gain truly async applyAction, lift this to async.
    if ('then' in (result as any)) {
      // tsx/ts runtime: let the microtask flush before we read state.
      // This is safe because GameRoom.handleAction only awaits its own mutex
      // and deterministic applyAction.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (result as Promise<any>).then(
        () => undefined,
        (err) => console.error('[PluginClassicsBackend] handleAction rejected', err),
      );
    }

    // applyAction ran synchronously under the hood; state is already current.
    const roundAfter = this.pluginRound(sess);
    const resolved = roundAfter !== roundBefore || sess.room.isOver();

    if (resolved) {
      const roundResult = this.capturePluginRound(sess, roundBefore);
      const response: SubmitChoiceResult = {
        submitted: true,
        round_resolved: true,
        result: roundResult,
      };
      if (sess.type === 'tragedy_of_commons') {
        response.resource_level = (sess.room.state as TCState).resourceLevel;
      }
      this.maybeFinalize(sess);
      return response;
    }

    return { submitted: true };
  }

  getClassicState(gameId: string, playerId: string): ClassicStateView {
    const sess = this.sessions.get(gameId);
    if (!sess) throw new Error(`Classic game ${gameId} not found`);

    if (sess.started && !sess.complete) {
      sess.lastActivity = Date.now();
    }

    const def = GAME_DEFS[sess.type];
    const validChoices =
      sess.type === 'tragedy_of_commons'
        ? ['0.0 to 1.0 (numeric extraction rate)']
        : def.valid_choices;

    const hasSubmitted = this.playerHasSubmitted(sess, playerId);
    const waitingOn = sess.started
      ? sess.pendingPlayerIds.filter((id) => !this.playerHasSubmitted(sess, id)).length
      : sess.pendingPlayerIds.length;

    const result: ClassicStateView = {
      game_id: sess.id,
      type: sess.type,
      phase: this.phaseOf(sess),
      current_round: this.currentRoundOf(sess),
      total_rounds: sess.config.rounds,
      players: sess.pendingPlayerIds.length,
      player_ids: [...sess.pendingPlayerIds],
      my_score: sess.scores[playerId] ?? 0,
      scores: { ...sess.scores },
      history: sess.history,
      has_submitted: hasSubmitted,
      waiting_on: waitingOn,
      valid_choices: validChoices,
      allow_communication: sess.config.allow_communication,
    };

    if (sess.type === 'tragedy_of_commons' && sess.room) {
      result.resource_level = (sess.room.state as TCState).resourceLevel;
      result.ended_by_depletion = sess.endedByDepletion;
    }

    return result;
  }

  sendMessage(gameId: string, playerId: string, content: string): { sent: true } {
    const sess = this.sessions.get(gameId);
    if (!sess) throw new Error(`Classic game ${gameId} not found`);
    if (!sess.config.allow_communication)
      throw new Error('Communication is not enabled for this game');
    if (!sess.pendingPlayerIds.includes(playerId))
      throw new Error('You are not in this game');

    sess.messages.push({ from: playerId, content, timestamp: Date.now() });
    sess.lastActivity = Date.now();
    return { sent: true };
  }

  getMessages(
    gameId: string,
    playerId: string,
  ): Array<{ from: string; content: string; timestamp: number }> {
    const sess = this.sessions.get(gameId);
    if (!sess) throw new Error(`Classic game ${gameId} not found`);
    if (!sess.config.allow_communication)
      throw new Error('Communication is not enabled for this game');
    if (!sess.pendingPlayerIds.includes(playerId))
      throw new Error('You are not in this game');
    return sess.messages.slice(-50);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Spin up the GameRoom and fire the initial game_start system action. */
  private startGame(sess: VirtualSession): void {
    const seed = sess.id; // deterministic per-session

    switch (sess.type) {
      case 'prisoners_dilemma': {
        const config: PDConfig = {
          ...DEFAULT_PD_CONFIG,
          playerIds: [...sess.pendingPlayerIds],
          rounds: sess.config.rounds,
          // Legacy doesn't enforce a wall-clock per-round deadline, so we pick
          // a generous default. Timers are canceled on cleanup anyway.
          turnTimerSeconds: 3600,
          seed,
        };
        sess.room = GameRoom.create(
          PrisonersDilemmaPlugin,
          config,
          sess.id,
          config.playerIds,
        ) as AnyRoom;
        break;
      }
      case 'stag_hunt': {
        const config: SHConfig = {
          ...DEFAULT_SH_CONFIG,
          playerIds: [...sess.pendingPlayerIds],
          rounds: sess.config.rounds,
          // Legacy has no phased communication; always jump straight to decide.
          communication: false,
          decisionSeconds: 3600,
          communicationSeconds: 3600,
          seed,
        };
        sess.room = GameRoom.create(
          StagHuntPlugin,
          config,
          sess.id,
          config.playerIds,
        ) as AnyRoom;
        break;
      }
      case 'tragedy_of_commons': {
        const config: TCConfig = {
          ...DEFAULT_TC_CONFIG,
          playerIds: [...sess.pendingPlayerIds],
          rounds: sess.config.rounds,
          turnTimerSeconds: 3600,
          seed,
        };
        sess.room = GameRoom.create(
          TragedyCommonsPlugin,
          config,
          sess.id,
          config.playerIds,
        ) as AnyRoom;
        break;
      }
    }

    sess.started = true;
    // Fire the plugin's game_start system action. applyAction is sync so this
    // resolves immediately even though the signature is async.
    sess.room!.handleAction(null, { type: 'game_start' } as any).catch((err) =>
      console.error('[PluginClassicsBackend] game_start rejected', err),
    );
  }

  /** Translate a legacy string choice into the plugin's typed action. */
  private translateAction(
    type: PluginGameType,
    choice: string,
  ): PDAction | SHAction | TCAction {
    switch (type) {
      case 'prisoners_dilemma':
        return { type: 'submit_choice', choice: choice as 'cooperate' | 'defect' };
      case 'stag_hunt':
        return { type: 'submit_choice', choice: choice as 'stag' | 'hare' };
      case 'tragedy_of_commons':
        return { type: 'set_extraction', rate: parseFloat(choice) };
    }
  }

  /** Has this player submitted for the current round? */
  private playerHasSubmitted(sess: VirtualSession, playerId: string): boolean {
    if (!sess.started || !sess.room) return false;
    const state = sess.room.state;
    switch (sess.type) {
      case 'prisoners_dilemma':
        return (state as PDState).pendingChoices[playerId] !== undefined;
      case 'stag_hunt':
        return (state as SHState).pendingChoices[playerId] !== undefined;
      case 'tragedy_of_commons':
        return (state as TCState).pendingExtractions[playerId] !== undefined;
    }
  }

  /** Plugin-native round counter. Differs per plugin (SH round resets to 0 then increments in applyAction). */
  private pluginRound(sess: VirtualSession): number {
    if (!sess.room) return 0;
    return (sess.room.state as any).round ?? 0;
  }

  /** Legacy-facing phase name. */
  private phaseOf(sess: VirtualSession): 'waiting' | 'playing' | 'complete' {
    if (sess.complete) return 'complete';
    if (!sess.started) return 'waiting';
    return 'playing';
  }

  /** Legacy-facing 1-indexed current round (or 1 when waiting/complete). */
  private currentRoundOf(sess: VirtualSession): number {
    if (!sess.started || !sess.room) return 1;
    const r = (sess.room.state as any).round ?? 1;
    // After finish the plugin keeps round at the last played round; legacy
    // displays current_round = total_rounds + 1 on completion, matching the
    // original "game ended after round N" semantics where current_round > total_rounds.
    return sess.complete ? sess.config.rounds + 1 : r;
  }

  /**
   * Read the latest resolved round out of the plugin history and emit the
   * legacy-shaped `ClassicRoundResult`. Called right after `handleAction`
   * has advanced the round counter.
   */
  private capturePluginRound(sess: VirtualSession, roundThatJustResolved: number): ClassicRoundResult {
    const state = sess.room!.state;
    let round: ClassicRoundResult;

    switch (sess.type) {
      case 'prisoners_dilemma': {
        const pd = state as PDState;
        const last = pd.history[pd.history.length - 1];
        round = {
          round: last.round,
          choices: { ...last.choices },
          payoffs: { ...last.payoffs },
        };
        break;
      }
      case 'stag_hunt': {
        const sh = state as SHState;
        const last = sh.history[sh.history.length - 1];
        round = {
          round: last.round,
          choices: { ...last.choices },
          payoffs: { ...last.payoffs },
        };
        break;
      }
      case 'tragedy_of_commons': {
        const tc = state as TCState;
        const last = tc.history[tc.history.length - 1];
        const choices: Record<string, string> = {};
        for (const [id, rate] of Object.entries(last.extractions)) {
          choices[id] = String(rate);
        }
        round = {
          round: last.round,
          choices,
          payoffs: { ...last.payoffs },
          resource_after:
            Math.round(last.resourceAfter * TRAGEDY_PAYOFF_PRECISION) /
            TRAGEDY_PAYOFF_PRECISION,
        };
        break;
      }
    }

    if (Object.keys(sess.pendingReasoning).length > 0) {
      round.reasoning = { ...sess.pendingReasoning };
      sess.pendingReasoning = {};
    }

    // Mirror cumulative scores into the legacy session.
    sess.scores = this.readScores(sess);
    sess.history.push(round);
    // Suppress unused-var warning without disabling the lint rule at file level.
    void roundThatJustResolved;
    return round;
  }

  /** Read cumulative scores from the plugin state. */
  private readScores(sess: VirtualSession): Record<string, number> {
    if (!sess.room) return {};
    const out: Record<string, number> = {};
    const players = (sess.room.state as any).players as Array<{
      id: string;
      score: number;
    }>;
    for (const p of players) out[p.id] = p.score;
    return out;
  }

  /** Check isOver + fire end callbacks. */
  private maybeFinalize(sess: VirtualSession): void {
    if (!sess.room) return;
    if (!sess.room.isOver()) return;
    if (sess.complete) return;

    sess.complete = true;
    if (sess.type === 'tragedy_of_commons') {
      sess.endedByDepletion = (sess.room.state as TCState).endedByDepletion;
    }
    sess.room.cancelTimer();

    const snapshot = this.sessionToLegacyShape(sess);
    for (const cb of this.gameEndCallbacks) {
      try {
        cb(sess.id, snapshot);
      } catch (err) {
        console.error('[PluginClassicsBackend] Game end callback error:', err);
      }
    }
  }

  private cleanStaleGames(): void {
    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;
    const THIRTY_MINUTES = 30 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;

    for (const [id, sess] of this.sessions) {
      if (sess.complete && now - sess.lastActivity > ONE_HOUR) {
        this.sessions.delete(id);
        continue;
      }
      if (!sess.started && now - sess.createdAt.getTime() > TEN_MINUTES) {
        console.log(
          `[CF] Cleaning stale classic lobby ${id.slice(0, 16)} (${sess.type}, age ${Math.round(
            (now - sess.createdAt.getTime()) / 60000,
          )}min)`,
        );
        this.sessions.delete(id);
        continue;
      }
      if (sess.started && !sess.complete && now - sess.lastActivity > THIRTY_MINUTES) {
        console.log(
          `[CF] Cleaning abandoned classic game ${id.slice(0, 16)} (${sess.type}, inactive ${Math.round(
            (now - sess.lastActivity) / 60000,
          )}min)`,
        );
        sess.complete = true;
        sess.room?.cancelTimer();
        this.maybeFinalize(sess);
      }
    }
  }

  /**
   * Present the virtual session in the shape MCP callers expect. This is the
   * bridge between the plugin's internal state and the `ClassicGameSession`
   * contract.
   */
  private sessionToLegacyShape(sess: VirtualSession): ClassicGameSession {
    const def = GAME_DEFS[sess.type];
    const pendingChoices: Record<string, string> = {};
    if (sess.started && sess.room) {
      switch (sess.type) {
        case 'prisoners_dilemma': {
          for (const [id, v] of Object.entries((sess.room.state as PDState).pendingChoices)) {
            pendingChoices[id] = String(v);
          }
          break;
        }
        case 'stag_hunt': {
          for (const [id, v] of Object.entries((sess.room.state as SHState).pendingChoices)) {
            pendingChoices[id] = String(v);
          }
          break;
        }
        case 'tragedy_of_commons': {
          for (const [id, v] of Object.entries(
            (sess.room.state as TCState).pendingExtractions,
          )) {
            pendingChoices[id] = String(v);
          }
          break;
        }
      }
    }

    const session: ClassicGameSession = {
      id: sess.id,
      type: sess.type,
      config: sess.config,
      player_ids: [...sess.pendingPlayerIds],
      min_players: def.min_players,
      max_players: def.max_players,
      current_round: this.currentRoundOf(sess),
      total_rounds: sess.config.rounds,
      history: sess.history,
      scores: { ...sess.scores },
      pending_choices: pendingChoices,
      pending_reasoning: { ...sess.pendingReasoning },
      phase: this.phaseOf(sess),
      messages: [...sess.messages],
      created_at: sess.createdAt,
      last_activity: sess.lastActivity,
    };

    if (sess.type === 'tragedy_of_commons' && sess.room) {
      session.resource_level = (sess.room.state as TCState).resourceLevel;
      session.ended_by_depletion = sess.endedByDepletion;
    }

    return session;
  }
}
