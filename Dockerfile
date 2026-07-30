# Full-stack image (real Postgres backend). Serves the product app at '/'
# and its marketing/install route at '/marketing' from the same bundle.
FROM node:20-slim AS build
WORKDIR /app
ENV VITE_BASE_PATH=/ VITE_REAL_BACKEND=1 VITE_CREATION_AD_SECONDS=0 NODE_ENV=production

# PUBLIC client-side values. Anything VITE_* is compiled into the browser bundle
# and is therefore public by definition — never put a secret here.
#
# VITE_YT_CLIENT_ID: the Google OAuth *client id* for "Connect YouTube"
# (src/lib/youtubeConnect.ts). It is designed to be public — the token client
# runs entirely in the browser and the client SECRET is not used by this flow.
# It lives only in the git-ignored .env.local locally, and .gcloudignore strips
# .env.local from the Cloud Build upload, so without this default the deployed
# bundle would ship with Connect YouTube disabled. Overridable at build time:
#   gcloud builds submit --substitutions ... / docker build --build-arg
ARG VITE_YT_CLIENT_ID=365406931355-hbda1fq93f2g297ml280ackb5icef72i.apps.googleusercontent.com
ENV VITE_YT_CLIENT_ID=$VITE_YT_CLIENT_ID

# A YouTube Data API key enables reading a channel's public uploads from just a
# @handle — no OAuth — which is the ONLY path that works inside the installed
# mobile app (Google blocks the OAuth popup in embedded WebViews). A VITE_* value
# is public in the browser bundle by definition; this key is restricted to the
# YouTube Data API, so exposure is expected + safe. Override at build time.
ARG VITE_YT_API_KEY=AIzaSyA7qv-7BZecK7yzEF_MUkEFJmEHh_zNxCg
ENV VITE_YT_API_KEY=$VITE_YT_API_KEY

# Build stamp surfaced at /version.json + <meta name="tko-build">. Defaults
# to a timestamp inside vite.buildId.ts when unset.
ARG BUILD_ID=
ENV BUILD_ID=$BUILD_ID

COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# The server imports pure, DOM-free helpers from src/lib (e.g. matchGrouping for
# auto-match). tsx only loads what's actually imported, so shipping the TS source
# is cheap and keeps one copy of that logic shared with the client.
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/index.ts"]
