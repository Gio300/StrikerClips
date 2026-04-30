/**
 * Standalone marketing site entry.
 *
 * This is the bundle that ships at the marketing domain (e.g. clutchlens.com).
 * It contains ONLY the Marketing page — no Supabase client, no auth, no app
 * routes. The rest of the React app is the install/web product, served from
 * a separate URL and built via the default `npm run build` script.
 *
 * AdSense is intentionally optional here. If `VITE_ADSENSE_CLIENT` is set,
 * the loader script is injected the same way the main app does.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Marketing } from './pages/Marketing'
import './index.css'

const adsClient = import.meta.env.VITE_ADSENSE_CLIENT
if (adsClient && typeof document !== 'undefined') {
  const s = document.createElement('script')
  s.async = true
  s.crossOrigin = 'anonymous'
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`
  document.head.appendChild(s)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Marketing />
  </React.StrictMode>,
)
