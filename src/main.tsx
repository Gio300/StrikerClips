import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ConfigNeeded from './components/ConfigNeeded'
import { isSupabaseConfigured, ADSENSE_CLIENT } from './lib/runtimeConfig'
import { initAdRoll } from './lib/adroll'
import './index.css'

const basePath = import.meta.env.VITE_BASE_PATH || '/'
const basename = basePath.replace(/\/$/, '') || '/'

// AdSense loader — only when a client id is configured (build or runtime).
if (ADSENSE_CLIENT && typeof document !== 'undefined') {
  const s = document.createElement('script')
  s.async = true
  s.crossOrigin = 'anonymous'
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`
  document.head.appendChild(s)
}

// AdRoll retargeting pixel — only when configured.
initAdRoll()

const root = ReactDOM.createRoot(document.getElementById('root')!)
if (!isSupabaseConfigured) {
  // Graceful failure instead of a white screen when Supabase isn't wired yet.
  root.render(
    <React.StrictMode>
      <ConfigNeeded />
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}
