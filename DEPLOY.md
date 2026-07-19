# Deploying killcam.app (frontend)

killcam.app resolves (via GoDaddy DNS, A record → `8.232.108.57` = reserved IP
`killcam-ip`) to a Google Cloud **load balancer** in project **`reelone-498406`**,
which routes to the **Cloud Run** service **`killcam`** (region `us-central1`).

So the site is updated by shipping a new revision of that Cloud Run service.

## One command (reproducible)

From this repo root:

```
gcloud run deploy killcam --source . --region us-central1 --project reelone-498406 --quiet
```

This uploads the source (honoring `.gcloudignore`), builds the `Dockerfile` with
Cloud Build, pushes the image to
`us-central1-docker.pkg.dev/reelone-498406/cloud-run-source-deploy/killcam`, and
rolls out a new revision serving 100% of traffic. killcam.app updates within a
minute (it points at the same load balancer).

## What the container does

`Dockerfile` builds the Vite SPA and serves it with `serve.mjs` (a tiny zero-dep
Node static server with SPA fallback) on `$PORT` (8080).

Current build mode is **standalone preview**: `VITE_MOCK_BACKEND=1`, `VITE_BASE_PATH=/`,
`VITE_CREATION_AD_SECONDS=0` (set in the Dockerfile). The app runs on an in-browser
backend so login / create / squad / director work without a separate API.

## Phase two — real Postgres backend

The `killcam` service was previously a Node server wired to Cloud SQL
(`reelone-498406:us-central1:reelone-db`, db `killcam`) with JWT auth and Secret
Manager secrets (`killcam-jwt-secret`, `reelone-app-db-password`). To go from the
standalone preview to the real backend:

1. Serve the API from the same container (extend `serve.mjs`/add the Express app
   in `server/`), connecting to Cloud SQL via the unix socket
   `/cloudsql/reelone-498406:us-central1:reelone-db`.
2. Point the frontend data layer at that API (replace the mock/supabase client).
3. Redeploy with the DB env + `--add-cloudsql-instances` + `--set-secrets`.
