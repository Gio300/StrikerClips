# KillCam frontend container for Cloud Run (service: killcam, project: reelone-498406).
# Builds the Vite SPA in standalone mode and serves it with a tiny Node static
# server on $PORT. Reproducible: `gcloud run deploy killcam --source .`.

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app

# Standalone preview build: runs on the in-browser backend so login/create/
# squad/director work without a separate API. Flip VITE_MOCK_BACKEND=0 and point
# VITE_SUPABASE_URL at the real backend when phase two (Postgres API) is wired.
ENV VITE_BASE_PATH=/ \
    VITE_MOCK_BACKEND=1 \
    VITE_CREATION_AD_SECONDS=0 \
    NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/serve.mjs ./serve.mjs
EXPOSE 8080
CMD ["node", "serve.mjs"]
