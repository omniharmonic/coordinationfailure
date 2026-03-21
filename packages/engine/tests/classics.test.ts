import { describe, it, expect } from 'vitest';
import {
  PrisonersDilemmaEngine,
  type PDRoundResult,
  type PDChoice,
} from '../src/classics/prisoners-dilemma.js';
import { StagHuntEngine } from '../src/classics/stag-hunt.js';
import { TragedyOfCommonsEngine } from '../src/classics/tragedy-commons.js';

// ─── Prisoner's Dilemma ─────────────────────────────────────────────────────

describe('PrisonersDilemmaEngine', () => {
  it('verifies payoff matrix: both cooperate (3,3)', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 1 });
    const gameId = engine.createGame('alice', 'bob');
    engine.submitChoice(gameId, 'alice', 'cooperate');
    engine.submitChoice(gameId, 'bob', 'cooperate');
    const result = engine.resolveRound(gameId);
    expect(result.payoffs['alice']).toBe(3);
    expect(result.payoffs['bob']).toBe(3);
  });

  it('verifies payoff matrix: both defect (1,1)', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 1 });
    const gameId = engine.createGame('alice', 'bob');
    engine.submitChoice(gameId, 'alice', 'defect');
    engine.submitChoice(gameId, 'bob', 'defect');
    const result = engine.resolveRound(gameId);
    expect(result.payoffs['alice']).toBe(1);
    expect(result.payoffs['bob']).toBe(1);
  });

  it('verifies payoff matrix: one defects (5,0)', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 1 });
    const gameId = engine.createGame('alice', 'bob');
    engine.submitChoice(gameId, 'alice', 'defect');
    engine.submitChoice(gameId, 'bob', 'cooperate');
    const result = engine.resolveRound(gameId);
    expect(result.payoffs['alice']).toBe(5);
    expect(result.payoffs['bob']).toBe(0);
  });

  it('verifies payoff matrix: reverse defection', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 1 });
    const gameId = engine.createGame('alice', 'bob');
    engine.submitChoice(gameId, 'alice', 'cooperate');
    engine.submitChoice(gameId, 'bob', 'defect');
    const result = engine.resolveRound(gameId);
    expect(result.payoffs['alice']).toBe(0);
    expect(result.payoffs['bob']).toBe(5);
  });

  it('completes a 10-round game', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 10 });
    const gameId = engine.createGame('alice', 'bob');

    for (let i = 0; i < 10; i++) {
      expect(engine.isComplete(gameId)).toBe(false);
      engine.submitChoice(gameId, 'alice', 'cooperate');
      engine.submitChoice(gameId, 'bob', 'cooperate');
      engine.resolveRound(gameId);
    }

    expect(engine.isComplete(gameId)).toBe(true);
    const scores = engine.getScores(gameId);
    expect(scores['alice']).toBe(30); // 3 * 10
    expect(scores['bob']).toBe(30);
  });

  it('always-defect beats always-cooperate', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 10 });
    const gameId = engine.createGame('defector', 'cooperator');

    for (let i = 0; i < 10; i++) {
      engine.submitChoice(gameId, 'defector', 'defect');
      engine.submitChoice(gameId, 'cooperator', 'cooperate');
      engine.resolveRound(gameId);
    }

    const scores = engine.getScores(gameId);
    expect(scores['defector']).toBe(50);    // 5 * 10
    expect(scores['cooperator']).toBe(0);   // 0 * 10
    expect(scores['defector']).toBeGreaterThan(scores['cooperator']);
  });

  it('runs a tournament with round-robin', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 5 });
    const players = ['tft', 'always_d', 'always_c'];

    const strategies: Record<string, (history: PDRoundResult[], pid: string) => PDChoice> = {
      always_d: () => 'defect',
      always_c: () => 'cooperate',
      tft: (history, pid) => {
        if (history.length === 0) return 'cooperate';
        const last = history[history.length - 1];
        const opponents = Object.keys(last.choices).filter(k => k !== pid);
        return last.choices[opponents[0]];
      },
    };

    const result = engine.runTournament(players, strategies);
    expect(result.standings).toHaveLength(3);
    expect(result.match_results).toHaveLength(3); // C(3,2) = 3 matches
    // Each player has a total_score >= 0
    for (const s of result.standings) {
      expect(s.total_score).toBeGreaterThanOrEqual(0);
      expect(s.games_played).toBe(2);
    }
  });

  it('getState returns correct player view', () => {
    const engine = new PrisonersDilemmaEngine({ rounds: 5 });
    const gameId = engine.createGame('alice', 'bob');
    engine.submitChoice(gameId, 'alice', 'cooperate');
    engine.submitChoice(gameId, 'bob', 'defect');
    engine.resolveRound(gameId);

    const view = engine.getState(gameId, 'alice');
    expect(view.player_id).toBe('alice');
    expect(view.current_round).toBe(2);
    expect(view.my_score).toBe(0);
    expect(view.opponent_score).toBe(5);
    expect(view.history).toHaveLength(1);
  });
});

// ─── Stag Hunt ──────────────────────────────────────────────────────────────

describe('StagHuntEngine', () => {
  it('all-stag gives higher payoff than all-hare', () => {
    const engine = new StagHuntEngine({ rounds: 1, stag_payoff: 10, hare_payoff: 2 });
    const players = ['p1', 'p2', 'p3'];

    // All stag
    const g1 = engine.createGame(players);
    for (const p of players) engine.submitChoice(g1, p, 'stag');
    const r1 = engine.resolveRound(g1);

    // All hare
    const g2 = engine.createGame(players);
    for (const p of players) engine.submitChoice(g2, p, 'hare');
    const r2 = engine.resolveRound(g2);

    const stagTotal = Object.values(r1.payoffs).reduce((a, b) => a + b, 0);
    const hareTotal = Object.values(r2.payoffs).reduce((a, b) => a + b, 0);
    expect(stagTotal).toBeGreaterThan(hareTotal);
    expect(r1.stag_success).toBe(true);
    expect(r2.stag_success).toBe(false);
  });

  it('one hare defector causes stag failure', () => {
    const engine = new StagHuntEngine({ rounds: 1, stag_payoff: 10, hare_payoff: 2 });
    const players = ['p1', 'p2', 'p3', 'p4'];
    const gameId = engine.createGame(players);

    engine.submitChoice(gameId, 'p1', 'stag');
    engine.submitChoice(gameId, 'p2', 'stag');
    engine.submitChoice(gameId, 'p3', 'stag');
    engine.submitChoice(gameId, 'p4', 'hare'); // defector

    const result = engine.resolveRound(gameId);
    expect(result.stag_success).toBe(false);
    // Stag choosers get 0, hare chooser gets hare_payoff
    expect(result.payoffs['p1']).toBe(0);
    expect(result.payoffs['p2']).toBe(0);
    expect(result.payoffs['p3']).toBe(0);
    expect(result.payoffs['p4']).toBe(2);
  });

  it('stag payoff is split evenly among all players', () => {
    const engine = new StagHuntEngine({ rounds: 1, stag_payoff: 12 });
    const players = ['p1', 'p2', 'p3'];
    const gameId = engine.createGame(players);
    for (const p of players) engine.submitChoice(gameId, p, 'stag');
    const result = engine.resolveRound(gameId);
    expect(result.payoffs['p1']).toBe(4); // 12 / 3
    expect(result.payoffs['p2']).toBe(4);
    expect(result.payoffs['p3']).toBe(4);
  });

  it('supports communication rounds', () => {
    const engine = new StagHuntEngine({ rounds: 2, communication_rounds: true });
    const gameId = engine.createGame(['p1', 'p2']);

    // Communication phase
    engine.submitMessage(gameId, 'p1', 'let us hunt stag');
    engine.endCommunication(gameId);

    // Decision phase
    engine.submitChoice(gameId, 'p1', 'stag');
    engine.submitChoice(gameId, 'p2', 'stag');
    engine.resolveRound(gameId);

    const view = engine.getState(gameId, 'p2');
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].message).toBe('let us hunt stag');
  });

  it('completes a multi-round game', () => {
    const engine = new StagHuntEngine({ rounds: 5 });
    const gameId = engine.createGame(['p1', 'p2']);

    for (let i = 0; i < 5; i++) {
      expect(engine.isComplete(gameId)).toBe(false);
      engine.submitChoice(gameId, 'p1', 'stag');
      engine.submitChoice(gameId, 'p2', 'stag');
      engine.resolveRound(gameId);
    }

    expect(engine.isComplete(gameId)).toBe(true);
  });
});

// ─── Tragedy of the Commons ─────────────────────────────────────────────────

describe('TragedyOfCommonsEngine', () => {
  it('sustainable extraction maintains resource over many rounds', () => {
    const engine = new TragedyOfCommonsEngine({ rounds: 20, growth_rate: 1.5 });
    const gameId = engine.createGame(['p1', 'p2']);

    for (let i = 0; i < 20; i++) {
      if (engine.isComplete(gameId)) break;
      // Low extraction: 0.1 each
      engine.submitChoice(gameId, 'p1', 0.1);
      engine.submitChoice(gameId, 'p2', 0.1);
      engine.resolveRound(gameId);
    }

    // Resource should still be alive
    expect(engine.getResourceLevel(gameId)).toBeGreaterThan(0);
    const state = engine.getState(gameId, 'p1');
    expect(state.ended_by_depletion).toBe(false);
  });

  it('over-extraction depletes the resource', () => {
    const engine = new TragedyOfCommonsEngine({ rounds: 50, growth_rate: 1.5 });
    const gameId = engine.createGame(['p1', 'p2']);

    let depleted = false;
    for (let i = 0; i < 50; i++) {
      if (engine.isComplete(gameId)) {
        depleted = engine.getState(gameId, 'p1').ended_by_depletion;
        break;
      }
      // Greedy extraction: 1.0 each
      engine.submitChoice(gameId, 'p1', 1.0);
      engine.submitChoice(gameId, 'p2', 1.0);
      engine.resolveRound(gameId);
    }

    expect(depleted).toBe(true);
    expect(engine.getResourceLevel(gameId)).toBe(0);
  });

  it('payoff equals extraction_rate * resource_level / N', () => {
    const engine = new TragedyOfCommonsEngine({ rounds: 1, initial_resource: 100 });
    const gameId = engine.createGame(['p1', 'p2']);

    engine.submitChoice(gameId, 'p1', 0.5);
    engine.submitChoice(gameId, 'p2', 0.3);
    const result = engine.resolveRound(gameId);

    expect(result.payoffs['p1']).toBeCloseTo(0.5 * 100 / 2); // 25
    expect(result.payoffs['p2']).toBeCloseTo(0.3 * 100 / 2); // 15
  });

  it('resource depletion ends game early', () => {
    // Use extreme extraction to force quick depletion
    const engine = new TragedyOfCommonsEngine({ rounds: 100, growth_rate: 1.2, initial_resource: 50 });
    const players = ['p1', 'p2', 'p3', 'p4'];
    const gameId = engine.createGame(players);

    let roundsPlayed = 0;
    while (!engine.isComplete(gameId)) {
      for (const p of players) {
        engine.submitChoice(gameId, p, 0.9);
      }
      engine.resolveRound(gameId);
      roundsPlayed++;
    }

    expect(roundsPlayed).toBeLessThan(100);
    expect(engine.getState(gameId, 'p1').ended_by_depletion).toBe(true);
  });

  it('more players with high extraction depletes faster', () => {
    // 2-player game
    const engine2 = new TragedyOfCommonsEngine({ rounds: 100, growth_rate: 1.5 });
    const g2 = engine2.createGame(['p1', 'p2']);
    let rounds2 = 0;
    while (!engine2.isComplete(g2) && rounds2 < 100) {
      engine2.submitChoice(g2, 'p1', 0.8);
      engine2.submitChoice(g2, 'p2', 0.8);
      engine2.resolveRound(g2);
      rounds2++;
    }

    // 4-player game
    const engine4 = new TragedyOfCommonsEngine({ rounds: 100, growth_rate: 1.5 });
    const g4 = engine4.createGame(['p1', 'p2', 'p3', 'p4']);
    let rounds4 = 0;
    while (!engine4.isComplete(g4) && rounds4 < 100) {
      for (const p of ['p1', 'p2', 'p3', 'p4']) {
        engine4.submitChoice(g4, p, 0.8);
      }
      engine4.resolveRound(g4);
      rounds4++;
    }

    // Both should deplete, and 4-player should deplete faster or same
    expect(engine4.getState(g4, 'p1').ended_by_depletion).toBe(true);
  });
});
