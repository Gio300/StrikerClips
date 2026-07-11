# KillCam — static SPA served by nginx on Cloud Run.
# The Supabase anon key and other public config are injected at CONTAINER START
# from env vars (see docker-entrypoint runtime-config generator), so the same
# image is deployable to any environment without a rebuild.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Serve at the domain root. Do NOT bake secrets here — config is runtime-injected.
ENV VITE_BASE_PATH=/
RUN npm run build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# The nginx image auto-runs /docker-entrypoint.d/*.sh before starting nginx.
COPY docker-runtime-config.sh /docker-entrypoint.d/99-killcam-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/99-killcam-runtime-config.sh
EXPOSE 8080
