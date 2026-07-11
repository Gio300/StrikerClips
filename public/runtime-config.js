// Runtime configuration placeholder.
//
// In production the container entrypoint (docker-entrypoint.sh) OVERWRITES this
// file at startup with real values from environment variables, so the anon key
// never has to be baked into the build. In local dev this stub does nothing and
// config falls back to VITE_* from .env.local (see src/lib/runtimeConfig.ts).
window.__KILLCAM_CONFIG__ = window.__KILLCAM_CONFIG__ || {};
