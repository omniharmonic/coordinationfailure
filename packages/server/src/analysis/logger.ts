import type { GameState, GameEvent, GameOutcome } from '@cf/engine';
import { serializeState } from '../util/serialize.js';

export interface TickLogEntry {
  tick_number: number;
  in_game_date: string;
  companies: Record<string, { capability_level: number; alignment_score: number; safety_allocation: number; capital_reserves: number; compute_level: number; model_generation: number }>;
  governments: Record<string, { safety_regulation_level: number; nationalization_status: string; treasury: number; domestic_approval: number }>;
  world: { global_stability: number; capital_market_sentiment: number; public_awareness: number };
  events: GameEvent[];
  agreements_snapshot: Array<{ id: string; type: string; status: string; parties: string[] }>;
  scores: Record<string, number>;
  phase: string;
  outcome: GameOutcome | null;
}

export interface LogSummary {
  total_ticks: number;
  outcome: GameOutcome | null;
  peak_capabilities: Record<string, number>;
  events_by_tier: Record<string, number>;
  total_events: number;
  total_messages: number;
  agreements_formed: number;
  agreements_violated: number;
  final_scores: Record<string, number>;
}

export class GameLogger {
  private logs = new Map<string, TickLogEntry[]>();
  private messageCounts = new Map<string, number>();

  logTick(gameId: string, tickNumber: number, state: GameState, events: GameEvent[]): void {
    if (!this.logs.has(gameId)) {
      this.logs.set(gameId, []);
    }

    const companies: TickLogEntry['companies'] = {};
    for (const [id, c] of Object.entries(state.companies)) {
      companies[id] = {
        capability_level: c.capability_level,
        alignment_score: c.alignment_score,
        safety_allocation: c.safety_allocation,
        capital_reserves: c.capital_reserves,
        compute_level: c.compute_level,
        model_generation: c.model_generation,
      };
    }

    const governments: TickLogEntry['governments'] = {};
    for (const [id, g] of Object.entries(state.governments)) {
      governments[id] = {
        safety_regulation_level: g.safety_regulation_level,
        nationalization_status: g.nationalization_status,
        treasury: g.treasury,
        domestic_approval: g.domestic_approval,
      };
    }

    const entry: TickLogEntry = {
      tick_number: tickNumber,
      in_game_date: state.world.in_game_date,
      companies,
      governments,
      world: {
        global_stability: state.world.global_stability,
        capital_market_sentiment: state.world.capital_market_sentiment,
        public_awareness: state.world.public_awareness,
      },
      events,
      agreements_snapshot: state.agreements.map(a => ({
        id: a.id,
        type: a.type,
        status: a.status,
        parties: a.parties,
      })),
      scores: { ...state.scores },
      phase: state.phase,
      outcome: state.outcome,
    };

    this.logs.get(gameId)!.push(entry);
  }

  incrementMessages(gameId: string, count: number = 1): void {
    this.messageCounts.set(gameId, (this.messageCounts.get(gameId) ?? 0) + count);
  }

  getLog(gameId: string): TickLogEntry[] | undefined {
    return this.logs.get(gameId);
  }

  getLogSummary(gameId: string): LogSummary | null {
    const log = this.logs.get(gameId);
    if (!log || log.length === 0) return null;

    const lastEntry = log[log.length - 1];

    // Peak capabilities per company
    const peakCapabilities: Record<string, number> = {};
    for (const entry of log) {
      for (const [companyId, companyData] of Object.entries(entry.companies)) {
        if ((peakCapabilities[companyId] ?? 0) < companyData.capability_level) {
          peakCapabilities[companyId] = companyData.capability_level;
        }
      }
    }

    // Events by tier
    const eventsByTier: Record<string, number> = { tremor: 0, shock: 0, crisis: 0, catastrophe: 0 };
    let totalEvents = 0;
    for (const entry of log) {
      for (const event of entry.events) {
        totalEvents++;
        if (event.type === 'world_event') {
          const tier = event.event.tier;
          eventsByTier[tier] = (eventsByTier[tier] ?? 0) + 1;
        }
      }
    }

    // Agreements formed and violated
    let agreementsFormed = 0;
    let agreementsViolated = 0;
    for (const entry of log) {
      for (const event of entry.events) {
        if (event.type === 'agreement_activated') agreementsFormed++;
        if (event.type === 'agreement_violated') agreementsViolated++;
      }
    }

    return {
      total_ticks: log.length,
      outcome: lastEntry.outcome,
      peak_capabilities: peakCapabilities,
      events_by_tier: eventsByTier,
      total_events: totalEvents,
      total_messages: this.messageCounts.get(gameId) ?? 0,
      agreements_formed: agreementsFormed,
      agreements_violated: agreementsViolated,
      final_scores: lastEntry.scores,
    };
  }

  clearLog(gameId: string): void {
    this.logs.delete(gameId);
    this.messageCounts.delete(gameId);
  }
}
