import { defineConfig } from 'vitest/config';

// Integration tests against a running local Supabase stack (`supabase start`). See docs/backend.md.
export default defineConfig({
  test: {
    include: ['tests/backend/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
