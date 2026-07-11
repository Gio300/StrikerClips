# KillCam — Node/Express server that serves the built SPA AND the /api/* backend
# (auth + generic query gateway) over Cloud SQL `reelone-db`. No Supabase.

# ---- build stage: compile the SPA ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Serve at the domain root. No secrets baked — DB config is runtime env.
ENV VITE_BASE_PATH=/
RUN npm run build

# ---- runtime stage: node server ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/index.mjs"]
