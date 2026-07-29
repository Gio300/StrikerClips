import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/AuthContext'
import { registerServiceWorker } from './lib/swClient'
import './index.css'

// Router basename is driven off Vite's resolved BASE_URL so the app "just
// works" wherever it is served: '/' for the mobile (Capacitor) build and
// '/app/' for the hosted web deploy (VITE_BASE_PATH=/app/ → BASE_URL=/app/).
// No per-route path changes are needed — every <Route> stays relative.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

const adsClient = import.meta.env.VITE_ADSENSE_CLIENT
if (adsClient && typeof document !== 'undefined') {
  const s = document.createElement('script')
  s.async = true
  s.crossOrigin = 'anonymous'
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`
  document.head.appendChild(s)
}

// PWA: register the service worker under the deploy base ('/app/sw.js' on the
// web, '/sw.js' if ever served at the root). Production + HTTPS only, and never
// inside the Capacitor APK — see src/lib/swClient.ts. Registering here as well
// as in useAppUpdate() means the app is installable even on routes that never
// mount the Layout (e.g. /marketing).
void registerServiceWorker(import.meta.env.BASE_URL || '/')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
