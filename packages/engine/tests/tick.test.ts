import { describe, it, expect } from 'vitest';
import { createInitialState, tick } from '../src/tick.js';
import { createDefaultConfig } from '../src/config.js';
import { computeAgreementScore } from '../src/conditions.js';
import { computeAlignmentDelta } from '../src/development.js';
import { computeGlobalStability } from '../src/events.js';
import { PRNG } from '../src/prng.js';
import type { Agreement, AgreementType, GameState } from '../src/state.js';

describe('createInitialState', () => {
  it('creates state with all 8 roles', () => {
    const config = createDefaultConfig();
    const state = createInitialState('test-game-1', config);

    expect(Object.keys(state.companies)).toHaveLength(6);
    expect(Object.keys(state.governments)).toHaveLength(2);
    expect(Object.keys(state.roles)).toHaveLength(8);
    expect(state.phase).toBe('lobby');
    expect(state.world.global_stability).toBe(80);
  });

  it('assigns correct countries', () => {
    const config = createDefaultConfig();
    const state = createInitialState('test-game-2', config);

    const usCompanies = Object.values(state.companies).filter(c => c.country === 'us');
    const chinaCompanies = Object.values(state.companies).filter(c => c.country === 'china');
    expect(usCompanies).toHaveLength(4);
    expect(chinaCompanies).toHaveLength(2);
  });
});

describe('tick', () => {
  it('advances state without crashing on empty actions', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-3', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [],
      tick_number: 1,
    });

    expect(result.new_state.world.tick_count).toBe(1);
    expect(result.new_state.phase).toBe('running');
  });

  it('applies safety allocation action', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-4', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [
        { type: 'set_safety_allocation', role_id: 'openbrain', value: 0.8 },
      ],
      tick_number: 1,
    });

    expect(result.new_state.companies.openbrain.safety_allocation).toBe(0.8);
  });

  it('enforces regulation minimum on safety allocation', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-5', config);
    state.phase = 'running';
    state.governments.us_gov.safety_regulation_level = 0.5;

    const result = tick({
      current_state: state,
      player_actions: [
        { type: 'set_safety_allocation', role_id: 'openbrain', value: 0.1 },
      ],
      tick_number: 1,
    });

    // Should be clamped to regulation minimum of 0.5
    expect(result.new_state.companies.openbrain.safety_allocation).toBe(0.5);
  });

  it('capability grows over time', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-6', config);
    state.phase = 'running';

    const initialCap = state.companies.openbrain.capability_level;

    const result = tick({
      current_state: state,
      player_actions: [],
      tick_number: 1,
    });

    expect(result.new_state.companies.openbrain.capability_level).toBeGreaterThan(initialCap);
  });

  it('is deterministic with same seed', () => {
    const config = createDefaultConfig({ seed: 42 });

    const state1 = createInitialState('test-game-7', config);
    state1.phase = 'running';
    const result1 = tick({ current_state: state1, player_actions: [], tick_number: 1 });

    const state2 = createInitialState('test-game-7', config);
    state2.phase = 'running';
    const result2 = tick({ current_state: state2, player_actions: [], tick_number: 1 });

    expect(result1.new_state.companies.openbrain.capability_level)
      .toBe(result2.new_state.companies.openbrain.capability_level);
  });

  it('runs 100 ticks without NaN or corruption', () => {
    const config = createDefaultConfig({ seed: 123 });
    let state = createInitialState('stress-test', config);
    state.phase = 'running';

    for (let i = 1; i <= 100; i++) {
      const result = tick({ current_state: state, player_actions: [], tick_number: i });
      state = result.new_state;

      // Verify no NaN or Infinity
      for (const company of Object.values(state.companies)) {
        expect(Number.isFinite(company.capability_level)).toBe(true);
        expect(Number.isFinite(company.alignment_score)).toBe(true);
        expect(Number.isFinite(company.capital_reserves)).toBe(true);
        expect(Number.isFinite(company.public_valuation)).toBe(true);
      }
      expect(Number.isFinite(state.world.global_stability)).toBe(true);
    }
  });

  it('zero safety causes alignment collapse at high capability', () => {
    const config = createDefaultConfig({ seed: 42 });
    let state = createInitialState('collapse-test', config);
    state.phase = 'running';
    // Start with high capability, zero safety
    state.companies.openbrain.capability_level = 75;
    state.companies.openbrain.safety_allocation = 0;

    for (let i = 1; i <= 50; i++) {
      const result = tick({ current_state: state, player_actions: [], tick_number: i });
      state = result.new_state;
    }

    // Alignment should have dropped significantly from starting 60
    expect(state.companies.openbrain.alignment_score).toBeLessThan(55);
  });

  it('processes agreement proposal and acceptance', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('agreement-test', config);
    state.phase = 'running';

    // Tick 1: propose agreement
    const result1 = tick({
      current_state: state,
      player_actions: [{
        type: 'propose_agreement',
        role_id: 'openbrain',
        agreement_type: 'safety_pact',
        party_ids: ['openbrain', 'prometheus'],
        terms: { min_safety: 0.3 },
      }],
      tick_number: 1,
    });

    expect(result1.new_state.agreements).toHaveLength(1);
    expect(result1.new_state.agreements[0].status).toBe('pending');
    expect(result1.new_state.agreements[0].type).toBe('safety_pact');

    const agreementId = result1.new_state.agreements[0].id;

    // Tick 2: accept agreement
    const result2 = tick({
      current_state: result1.new_state,
      player_actions: [{
        type: 'respond_agreement',
        role_id: 'prometheus',
        agreement_id: agreementId,
        accept: true,
      }],
      tick_number: 2,
    });

    expect(result2.new_state.agreements[0].status).toBe('active');
    // activated_at_tick uses the tick count at time of action processing (before clock advance)
    expect(result2.new_state.agreements[0].activated_at_tick).toBe(1);
  });

  it('handles nationalization progression', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('nat-test', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [{
        type: 'set_nationalization',
        role_id: 'us_gov',
        level: 'info_sharing',
      }],
      tick_number: 1,
    });

    expect(result.new_state.governments.us_gov.nationalization_status).toBe('info_sharing');

    // Can't go backwards
    const result2 = tick({
      current_state: result.new_state,
      player_actions: [{
        type: 'set_nationalization',
        role_id: 'us_gov',
        level: 'none',
      }],
      tick_number: 2,
    });

    expect(result2.new_state.governments.us_gov.nationalization_status).toBe('info_sharing');
  });
});

describe('alignment diminishing returns', () => {
  it('alignment growth is slower at high alignment', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('align-test', config);
    state.phase = 'running';
    const rng = new PRNG(999); // deterministic, unlikely to trigger stochastic events

    const company = { ...state.companies.openbrain, safety_allocation: 0.5 };

    // Low alignment: growth should be higher
    company.alignment_score = 20;
    const lowDelta = computeAlignmentDelta(company, state, 1, rng);

    // High alignment: growth should be lower due to diminishing returns
    company.alignment_score = 80;
    const rng2 = new PRNG(999);
    const highDelta = computeAlignmentDelta(company, state, 1, rng2);

    // The safetyGrowth component at alignment 20: factor = 1 - 20/110 = 0.818
    // The safetyGrowth component at alignment 80: factor = 1 - 80/110 = 0.273
    // So growth at 80 should be significantly less
    expect(lowDelta).toBeGreaterThan(highDelta);
  });
});

describe('regulation alignment bonus', () => {
  it('government regulation boosts domestic company alignment', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('reg-align-test', config);
    state.phase = 'running';
    const rng = new PRNG(999);

    const company = { ...state.companies.openbrain, safety_allocation: 0.3 };

    // No regulation
    state.governments.us_gov.safety_regulation_level = 0;
    const noRegDelta = computeAlignmentDelta(company, state, 1, rng);

    // High regulation
    state.governments.us_gov.safety_regulation_level = 0.8;
    const rng2 = new PRNG(999);
    const highRegDelta = computeAlignmentDelta(company, state, 1, rng2);

    // Higher regulation should give a positive alignment boost
    expect(highRegDelta).toBeGreaterThan(noRegDelta);
  });
});

describe('stability minimum instability floor', () => {
  it('caps stability based on max capability', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('stab-test', config);
    state.phase = 'running';

    // Set high capability — should force stability below max possible
    state.companies.openbrain.capability_level = 90;
    // Give everyone high alignment and many agreements to try to push stability up
    for (const company of Object.values(state.companies)) {
      company.alignment_score = 100;
    }

    const stability = computeGlobalStability(state);

    // At cap 90: minInstability = (90/100)^2 * 40 = 0.81 * 40 = 32.4
    // maxPossibleStability = 100 - 32.4 = 67.6
    expect(stability).toBeLessThanOrEqual(67.6);
  });
});

describe('computeAgreementScore', () => {
  function makeAgreement(type: AgreementType, parties: string[], terms: Record<string, unknown> = {}): Agreement {
    return {
      id: `agr_test_${Math.random().toString(36).slice(2, 8)}`,
      type,
      parties,
      terms,
      proposed_by: parties[0],
      proposed_at_tick: 1,
      activated_at_tick: 2,
      status: 'active',
      pending_acceptances: [],
      duration_ticks: null,
      withdrawal_notice_ticks: 3,
      withdrawing_parties: new Map(),
    };
  }

  function stateWith(agreements: Agreement[]): GameState {
    const config = createDefaultConfig();
    const state = createInitialState('score-test', config);
    state.agreements = agreements;
    return state;
  }

  it('scores enforced agreements higher than symbolic', () => {
    const enforced = stateWith([makeAgreement('safety_pact', ['openbrain', 'prometheus'])]);
    const symbolic = stateWith([makeAgreement('capital_alliance', ['openbrain', 'prometheus'])]);

    const enforcedScore = computeAgreementScore('openbrain', 'company', enforced);
    const symbolicScore = computeAgreementScore('openbrain', 'company', symbolic);

    expect(enforcedScore).toBe(12);
    expect(symbolicScore).toBe(3);
  });

  it('applies diminishing returns on same type', () => {
    const agreements = [
      makeAgreement('capital_alliance', ['openbrain', 'prometheus']),
      makeAgreement('capital_alliance', ['openbrain', 'nexus']),
      makeAgreement('capital_alliance', ['openbrain', 'titan']),
    ];
    const state = stateWith(agreements);
    const score = computeAgreementScore('openbrain', 'company', state);

    // 3 * (100% + 75% + 50%) = 3 + 2.25 + 1.5 = 6.75
    expect(score).toBeCloseTo(6.75);
  });

  it('goes negative for 5th+ of same type (attenuated by global cap)', () => {
    const agreements = Array.from({ length: 7 }, (_, i) =>
      makeAgreement('capital_alliance', ['openbrain', `partner_${i}`])
    );
    const state = stateWith(agreements);
    const score = computeAgreementScore('openbrain', 'company', state);

    // idx 1-5: globalMult=1.0, idx 6-7: globalMult=0.5
    // 3*(1.0+0.75+0.5+0.25+0) + 3*((-0.25)+(-0.5))*0.5 = 7.5 + (-1.125) = 6.375
    expect(score).toBeCloseTo(6.375);
  });

  it('applies cross-country multiplier', () => {
    // openbrain=US, deepcent=China
    const domestic = stateWith([makeAgreement('safety_pact', ['openbrain', 'prometheus'])]);
    const crossCountry = stateWith([makeAgreement('safety_pact', ['openbrain', 'deepcent'])]);

    const domesticScore = computeAgreementScore('openbrain', 'company', domestic);
    const crossScore = computeAgreementScore('openbrain', 'company', crossCountry);

    expect(domesticScore).toBe(12);
    expect(crossScore).toBe(18); // 12 * 1.5
  });

  it('applies stringency bonus for safety_pact', () => {
    const low = stateWith([makeAgreement('safety_pact', ['openbrain', 'prometheus'], { min_safety: 0.3 })]);
    const high = stateWith([makeAgreement('safety_pact', ['openbrain', 'prometheus'], { min_safety: 1.0 })]);

    const lowScore = computeAgreementScore('openbrain', 'company', low);
    const highScore = computeAgreementScore('openbrain', 'company', high);

    expect(lowScore).toBe(12); // no bonus at exactly 0.3
    expect(highScore).toBe(17); // 12 + 5 * (1.0 - 0.3) / 0.7 = 12 + 5
  });

  it('applies stringency bonus for intl_safety_framework', () => {
    const state = stateWith([makeAgreement('intl_safety_framework', ['us_gov', 'china_gov'], { min_regulation: 1.0 })]);
    const score = computeAgreementScore('us_gov', 'government', state);

    // 18 (gov base) + 5 * (1.0 - 0.2) / 0.8 = 18 + 5 = 23, * 1.5 cross-country = 34.5
    expect(score).toBeCloseTo(34.5);
  });

  it('uses government base scores for government roles', () => {
    const state = stateWith([makeAgreement('info_sharing', ['us_gov', 'openbrain'])]);
    const score = computeAgreementScore('us_gov', 'government', state);

    expect(score).toBe(12); // gov base for effective tier
  });

  it('rewards diverse types over spam', () => {
    // 7 capital_alliance spam
    const spamState = stateWith(
      Array.from({ length: 7 }, () => makeAgreement('capital_alliance', ['openbrain', 'prometheus']))
    );
    const spamScore = computeAgreementScore('openbrain', 'company', spamState);

    // 3 different enforced types, cross-country, strong terms
    const diverseState = stateWith([
      makeAgreement('safety_pact', ['openbrain', 'deepcent'], { min_safety: 0.8 }),
      makeAgreement('non_aggression', ['openbrain', 'qianneng']),
      makeAgreement('intl_safety_framework', ['openbrain', 'deepcent'], { min_regulation: 0.6 }),
    ]);
    const diverseScore = computeAgreementScore('openbrain', 'company', diverseState);

    // Spam: 7 capital_alliance with global cap = 6.375
    // Diverse: 3 cross-country enforced types ≈ 63 points
    expect(spamScore).toBeCloseTo(6.375);
    expect(diverseScore).toBeGreaterThan(spamScore * 5);
  });

  it('applies global cap — 13+ agreements score zero', () => {
    const agreements = Array.from({ length: 20 }, (_, i) =>
      makeAgreement('safety_pact', ['openbrain', `partner_${i}`])
    );
    const state = stateWith(agreements);
    const score = computeAgreementScore('openbrain', 'company', state);

    // Only first 12 contribute anything; 13-20 have globalMultiplier=0
    const withOnly12 = stateWith(agreements.slice(0, 12));
    const score12 = computeAgreementScore('openbrain', 'company', withOnly12);

    expect(score).toBe(score12);
  });
});
