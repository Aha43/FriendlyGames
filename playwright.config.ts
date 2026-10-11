import { defineConfig, devices } from '@playwright/test';

// Browser journeys against the production build. Run with `npm run e2e`.
// Shared-play journeys need the local Supabase stack running (`supabase start`).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No traces, videos, screenshots or HTML reports: they would record request headers, bodies and
  // URLs, which carry device credentials and invitation tokens.
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 850 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
