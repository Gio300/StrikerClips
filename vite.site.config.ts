import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vite config for the **standalone marketing site**.
 *
 * This builds ONLY the marketing page from `index.site.html` →
 * `src/site-main.tsx`. The output goes to `dist-site/` and is intended to
 * be hosted at a root path (clutchlens.com or any static host).
 *
 * The main app keeps using `vite.config.ts`, builds to `dist/`, and is
 * deployed as the actual product (the URL the desktop installer wraps).
 *
 * Run with:
 *   npm run dev:site      (local preview)
 *   npm run build:site    (produces dist-site/)
 *   npm run preview:site  (preview the production build)
 *
 * Environment:
 *   VITE_SITE_BASE      sub-path if hosting under a folder. Default '/'.
 *   VITE_APP_URL        absolute URL of the deployed app. When set, the
 *                       marketing CTAs deep-link there. When empty, they
 *                       become relative paths (handy in dev).
 *   VITE_CONTACT_EMAIL  enables the one-click contact button.
 *   VITE_ADSENSE_*      reused if you want sponsor slots on marketing.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_SITE_BASE || '/'
  return {
    plugins: [react()],
    base,
    publicDir: 'public',
    server: { port: 5890 },
    preview: {
      // Allow tunnel hostnames (e.g. trycloudflare) so the marketing site can
      // be previewed publicly. Vite 5 blocks unknown hosts by default.
      allowedHosts: true,
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    build: {
      outDir: 'dist-site',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.site.html'),
      },
    },
  }
})
