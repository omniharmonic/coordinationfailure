import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Single-threaded pool: one worker, one process, all files share it.
    // Spawning many workers on a networked/iCloud filesystem is where
    // the per-file wait time comes from, and test logic itself is fast
    // (<20ms per test on average). cleanup-timers.test.ts uses afterAll
    // to restore real timers so fake-timer state can't leak.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true, isolate: false } },
    fileParallelism: false,
  },
});

