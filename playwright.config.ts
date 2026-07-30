import { defineConfig } from '@playwright/test'

// Front-end E2E against the full-stack e2e server (server/e2eServer.ts) — the
// REAL built app over the REAL API on pg-mem. Start that server first:
//   VITE_REAL_BACKEND=1 VITE_MOCK_BACKEND= VITE_BASE_PATH= npx vite build
//   PORT=8799 npx tsx server/e2eServer.ts
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE || 'http://localhost:8799',
    headless: true,
    // Chromium headless-shell was the browser Playwright downloaded here.
    channel: undefined,
  },
})
