import { defineConfig } from 'vitest/config';

// Integration tests against a running local Supabase stack (`supabase start`). See docs/backend.md.
// Files run in parallel. Migration rehearsals that drop/recreate schema objects would take locks that
// deadlock parallel signups, so they live in tests/backend/migrations/ and run afterwards on their
// own (vitest.backend-migrations.config.ts, #60).
export default defineConfig({
  test: {
    include: ['tests/backend/**/*.test.ts'],
    exclude: ['tests/backend/migrations/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
