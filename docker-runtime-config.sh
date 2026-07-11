#!/bin/sh
# Regenerate runtime-config.js from container environment at startup, so the
# Supabase anon key (and other PUBLIC config) can be set as Cloud Run env vars
# without rebuilding the image. Runs automatically via nginx's entrypoint.d.
set -eu

CONFIG_PATH="/usr/share/nginx/html/runtime-config.js"

cat > "$CONFIG_PATH" <<EOF
window.__KILLCAM_CONFIG__ = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  APP_URL: "${APP_URL:-}",
  ADSENSE_CLIENT: "${ADSENSE_CLIENT:-}",
  ADROLL_ADV_ID: "${ADROLL_ADV_ID:-}",
  ADROLL_PIX_ID: "${ADROLL_PIX_ID:-}"
};
EOF

if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  echo "[killcam] runtime-config.js written; Supabase configured."
else
  echo "[killcam] runtime-config.js written; Supabase NOT fully configured (app will show the config screen). Set SUPABASE_URL + SUPABASE_ANON_KEY env vars."
fi
