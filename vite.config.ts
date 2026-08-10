/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { buildIdPlugin, resolveBuildId } from './vite.buildId'

// VITE_BASE_PATH controls the deploy sub-path.
//   • Default (no env)  → '/'   — used by the MOBILE build (_mobilebuild.bat
//     never sets VITE_BASE_PATH) so the Capacitor app serves from root.
//   • Hosted WEB deploy → set VITE_BASE_PATH=/app/ so the app is served under
//     tko.cam/app while the marketing site (dist-site) owns '/'. The Dockerfiles
//     set this for the container build.
// Vite exposes the resolved value as import.meta.env.BASE_URL, which the router
// (src/main.tsx) uses as its basename — so routes auto-work at '/' on mobile and
// under '/app' on web with no per-route changes.
export default defineConfig(({ mode: _mode }) => {
  const env = loadEnv(_mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/'

  // Stamp the build BEFORE Vite resolves its env, so VITE_BUILD_ID is compiled
  // into the bundle and matches the emitted version.json byte for byte. See
  // vite.buildId.ts and src/lib/appVersion.ts for what consumes it.
  const buildId = resolveBuildId(process.env)
  const builtAt = Date.now()
  process.env.VITE_BUILD_ID = buildId
  process.env.VITE_BUILD_AT = String(builtAt)

  return {
    plugins: [react(), buildIdPlugin({ buildId, builtAt, emitVersionFile: true })],
    base,
    server: {
      host: true,
      port: 5889,
      // Allow tunnel hostnames so we can demo the dev server to testers
      // over a public HTTPS URL. Vite 5 blocks unknown hosts by default.
      allowedHosts: true,
    },
    preview: {
      allowedHosts: true,
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    // Unit/integration tests are Vitest (*.test.ts under src/ and server/). The
    // Playwright front-end E2E specs live in e2e/*.spec.ts and are run by
    // `npx playwright test`, NOT Vitest — exclude them so `vitest run` doesn't
    // try to execute a Playwright spec and fail to import '@playwright/test'.
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
  }
})
