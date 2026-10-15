/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The commit being built: Cloudflare Pages provides it; locally, ask git. Shown in the footer.
function buildCommit(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  resolve: {
    alias: {
      // Code shared with the Edge Functions (chess rules); see docs/backend.md.
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
  },
});
