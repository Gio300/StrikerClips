import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// VITE_BASE_PATH controls the deploy sub-path (GitHub Pages project sites need it).
// Defaults to '/StrikerClips/' to keep the existing live URL working until the repo is renamed.
// To rebrand the live URL, set VITE_BASE_PATH=/ShinobiVillage/ in .env.local + GitHub Pages secret.
export default defineConfig(({ mode: _mode }) => {
  const env = loadEnv(_mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/StrikerClips/'

  return {
    plugins: [react()],
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
  }
})
