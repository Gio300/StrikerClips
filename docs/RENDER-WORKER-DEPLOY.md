# Render worker — always-on deploy (the self-running loop)

This is the piece that makes TKO "run whether you oversee it or not." The web
app (`killcam` service) fills the `render_jobs` queue whenever auto-match groups
≥2 angles of one match. This worker drains that queue: pulls the source angles →
composites with ffmpeg → uploads to the TKO YouTube channel → writes the link
back onto the match + clips and notifies every participant.

Two ways to run it. **Job + Scheduler is the default** (cheapest — you pay only
while a job is actually rendering).

---

## Option A — Cloud Run Job + Scheduler (recommended, batch)

The container runs `renderWorker.run.ts --once`: drain everything pending, then
exit. Cloud Scheduler re-runs it on a cadence.

### 1. Build + push the worker image
```
gcloud builds submit --tag us-central1-docker.pkg.dev/reelone-498406/killcam/tko-render-worker:latest \
  --project reelone-498406 -f Dockerfile.worker .
```
(If you use the default `gcr.io`: `--tag gcr.io/reelone-498406/tko-render-worker`.)

### 2. Create the Job (mirrors the killcam service's DB env; pulls YT secrets)
```
gcloud run jobs create tko-render-worker \
  --image us-central1-docker.pkg.dev/reelone-498406/killcam/tko-render-worker:latest \
  --region us-central1 --project reelone-498406 \
  --set-cloudsql-instances reelone-498406:us-central1:reelone-db \
  --set-env-vars INSTANCE_CONNECTION_NAME=reelone-498406:us-central1:reelone-db,DB_NAME=killcam,DB_USER=postgres,YOUTUBE_CLIENT_ID=464229950644-14thoufr97qrg78gjrv9uir7c81karnj.apps.googleusercontent.com \
  --set-secrets DB_PASSWORD=reelone-app-db-password:latest,YOUTUBE_CLIENT_SECRET=youtube-client-secret:latest,YOUTUBE_REFRESH_TOKEN=youtube-refresh-token:latest \
  --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 1
```
Notes:
- `youtube-client-secret` and `youtube-refresh-token` already exist in Secret
  Manager (created when the uploader was wired). The DB password is the same
  secret the `killcam` service uses, confirmed to be
  **`reelone-app-db-password:latest`** (Cloud SQL `reelone-498406:us-central1:reelone-db`,
  DB `killcam`). The deploy script auto-discovers it from the service.
- ffmpeg jobs are CPU-bound; 2 vCPU / 2 GiB comfortably composites up to 4
  angles. Bump `--memory`/`--cpu` if you composite long matches.

### 3. Schedule it (every 5 min; adjust to taste)
```
gcloud scheduler jobs create http tko-render-worker-tick \
  --location us-central1 --project reelone-498406 \
  --schedule "*/5 * * * *" \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/reelone-498406/jobs/tko-render-worker:run" \
  --http-method POST \
  --oauth-service-account-email <the-run-invoker-sa>@reelone-498406.iam.gserviceaccount.com
```
The invoker SA needs `roles/run.invoker` on the job. (`run.developer` SA created
during service deploy usually already has it.)

### Run it once by hand to prove the loop
```
gcloud run jobs execute tko-render-worker --region us-central1 --project reelone-498406 --wait
```
Watch it claim a job, composite, upload, and stamp the YouTube link back.

---

## Option B — Cloud Run Service, live poll loop (always warm)

Drop `--once` (set `POLL_MS`) and keep one instance warm. Simpler, slightly more
expensive (you pay for the idle min-instance).

Edit `Dockerfile.worker` CMD to
`["node_modules/.bin/tsx","server/renderWorker.run.ts"]`, then:
```
gcloud run deploy tko-render-worker \
  --image .../tko-render-worker:latest --region us-central1 --project reelone-498406 \
  --no-cpu-throttling --min-instances 1 --max-instances 1 --memory 2Gi --cpu 2 \
  --set-cloudsql-instances reelone-498406:us-central1:reelone-db \
  --set-env-vars INSTANCE_CONNECTION_NAME=reelone-498406:us-central1:reelone-db,DB_NAME=killcam,DB_USER=postgres,POLL_MS=15000,YOUTUBE_CLIENT_ID=464229950644-14thoufr97qrg78gjrv9uir7c81karnj.apps.googleusercontent.com \
  --set-secrets DB_PASSWORD=reelone-app-db-password:latest,YOUTUBE_CLIENT_SECRET=youtube-client-secret:latest,YOUTUBE_REFRESH_TOKEN=youtube-refresh-token:latest
```
`--no-cpu-throttling` is required so the poll loop keeps running between requests.

---

## The single manual gate

Everything above is scripted in `deploy-worker.ps1`. The one value only you can
confirm is the **DB password secret name** the `killcam` service already uses
(step 2). Once that matches, the worker is fully unattended: auto-match enqueues,
the worker drains, videos post themselves, participants get notified.

## Quality follow-up (tracked separately)

The current compositor is the ffmpeg xstack grid. The build plan (§1) wants the
worker to run the *full* pipeline — clock-align, intro, K.O. replays, and
ElevenLabs caster VO — so auto-output matches the hand-built AI-squad video. That
upgrades `renderAndUpload` in `renderWorker.run.ts`; the queue mechanics don't
change.
