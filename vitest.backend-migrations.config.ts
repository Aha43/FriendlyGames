import { defineConfig } from 'vitest/config';

// Migration rehearsals against the local Supabase stack (#60). Each drops and recreates schema
// objects inside a rolled-back transaction, so they run one file at a time, after the parallel
// backend suite (`npm run test:backend` runs both), with no other test traffic.
export default defineConfig({
  test: {
    include: ['tests/backend/migrations/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
