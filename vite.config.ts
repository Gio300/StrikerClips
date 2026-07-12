import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// VITE_BASE_PATH controls the deploy sub-path.
// Defaults to '/' — the canonical home is now killcam.app served at the domain root
// (Cloud Run). Only set VITE_BASE_PATH=/StrikerClips/ for the legacy GitHub Pages
// project-site preview, which is served under a sub-path.
export default defineConfig(({ mode: _mode }) => {
  const env = loadEnv(_mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/'

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
