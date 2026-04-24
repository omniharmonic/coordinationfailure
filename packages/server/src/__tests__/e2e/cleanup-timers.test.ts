/**
 * E2E Suite — stale-game cleanup via fake timers.
 *
 * The production code cleans up stale lobbies and abandoned games on a
 * 60-second interval. We drive the real cleanup path using fake timers
 * to prove the cleanup logic fires and flips state correctly, without
 * actually waiting 30+ minutes in test time.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyClassicsBackend } from '../../game/legacy-classics-backend.js';
import { PluginClassicsBackend } from '../../game/plugin-classics-backend.js';

// Hard-guarantee: even if vitest skips a test's afterEach, the file's
// afterAll restores real timers so later files can't observe fake ones.
afterAll(() => vi.useRealTimers());

const TEN_MINUTES = 10 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

describe('legacy stale cleanup', () => {
  // Fake timers at test scope only. singleThread reuses the worker, so
  // a stray useFakeTimers from this file would leak into sibling files;
  // the afterEach below unconditionally restores real timers so no other
  // suite ever observes fake Date / fake setInterval.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes waiting lobbies older than 10 minutes', () => {
    const b = new LegacyClassicsBackend({ enableCleanup: true });
    const g = b.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    expect(b.hasGame(g.id)).toBe(true);

    vi.advanceTimersByTime(TEN_MINUTES + ONE_MINUTE + 1000);
    expect(b.hasGame(g.id)).toBe(false);
    b.stopCleanup();
  });

  it('flips abandoned playing games to complete after 30 minutes', () => {
    const b = new LegacyClassicsBackend({ enableCleanup: true });
    const completed: string[] = [];
    b.onGameComplete((id) => completed.push(id));

    const g = b.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    b.joinGame(g.id, 'bob'); // triggers auto-start
    expect(b.getGame(g.id)!.phase).toBe('playing');

    vi.advanceTimersByTime(THIRTY_MINUTES + ONE_MINUTE + 1000);
    const after = b.getGame(g.id);
    expect(after).toBeDefined();
    expect(after!.phase).toBe('complete');
    expect(completed).toEqual([g.id]);
    b.stopCleanup();
  });

  it('drops completed games after 1 hour', () => {
    const b = new LegacyClassicsBackend({ enableCleanup: true });
    const g = b.createGame('prisoners_dilemma', { rounds: 1 }, 'a');
    b.joinGame(g.id, 'b');
    b.submitChoice(g.id, 'a', 'cooperate');
    b.submitChoice(g.id, 'b', 'cooperate');
    expect(b.getGame(g.id)!.phase).toBe('complete');

    vi.advanceTimersByTime(ONE_HOUR + ONE_MINUTE + 1000);
    expect(b.hasGame(g.id)).toBe(false);
    b.stopCleanup();
  });
});

describe('plugin stale cleanup', () => {
  // Fake timers at test scope only. singleThread reuses the worker, so
  // a stray useFakeTimers from this file would leak into sibling files;
  // the afterEach below unconditionally restores real timers so no other
  // suite ever observes fake Date / fake setInterval.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes waiting plugin lobbies older than 10 minutes', () => {
    const b = new PluginClassicsBackend({ enableCleanup: true });
    const g = b.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    expect(b.hasGame(g.id)).toBe(true);

    vi.advanceTimersByTime(TEN_MINUTES + ONE_MINUTE + 1000);
    expect(b.hasGame(g.id)).toBe(false);
    b.stopCleanup();
  });

  it('flips abandoned plugin games to complete after 30 minutes', () => {
    const b = new PluginClassicsBackend({ enableCleanup: true });
    const completed: string[] = [];
    b.onGameComplete((id) => completed.push(id));

    const g = b.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    b.joinGame(g.id, 'bob');
    expect(b.getGame(g.id)!.phase).toBe('playing');

    vi.advanceTimersByTime(THIRTY_MINUTES + ONE_MINUTE + 1000);
    const after = b.getGame(g.id);
    expect(after).toBeDefined();
    expect(after!.phase).toBe('complete');
    expect(completed).toEqual([g.id]);
    b.stopCleanup();
  });
});
