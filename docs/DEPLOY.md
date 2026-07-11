# Deploying KillCam to killcam.app

The app is a static SPA (React + Vite) served by nginx on **Cloud Run**, fronted
by a global external HTTPS load balancer so the apex domain `killcam.app` gets a
single stable A record + a Google-managed TLS cert. The site serves zero video
bytes — YouTube is the CDN.

- **GCP project:** `reelone-498406` (project number `365406931355`)
- **Region:** `us-central1`
- **Cloud Run service:** `killcam`
- **Reserved static IP (global):** `8.232.108.57`  ← this is the A record

> ⚠️ Deploy trap: the default gcloud identity may not own this project. Always
> pass `--project=reelone-498406 --account=<owner>` and verify on the live URL.

## 1. Configuration (no rebuild needed)

The Supabase anon key and other PUBLIC config are injected at container start
from env vars into `runtime-config.js` (see `docker-runtime-config.sh`). To set
or change them, update the Cloud Run service env — no image rebuild:

```bash
gcloud run services update killcam \
  --project=reelone-498406 --region=us-central1 \
  --update-env-vars="SUPABASE_URL=https://siwcdegiavwcvgjegiww.supabase.co,SUPABASE_ANON_KEY=<paste-anon-key>,APP_URL=https://killcam.app"
```

Until `SUPABASE_ANON_KEY` is set, the app renders a "configuration required"
screen (never a white page). Optional runtime vars: `ADSENSE_CLIENT`,
`ADROLL_ADV_ID`, `ADROLL_PIX_ID`.

Get the anon key from the Supabase dashboard → Project Settings → API →
"Project API keys" → `anon` `public`. (It's safe to expose — it's the public key,
protected by RLS.)

## 2. Deploy a new revision

```bash
gcloud run deploy killcam \
  --source . \
  --project=reelone-498406 --account=<owner> \
  --region=us-central1 --allow-unauthenticated --port=8080 --memory=512Mi \
  --set-env-vars="SUPABASE_URL=https://siwcdegiavwcvgjegiww.supabase.co,APP_URL=https://killcam.app"
```

## 3. DNS records to add at the registrar (killcam.app)

Point the domain at the load balancer's static IP:

| Type  | Host / Name      | Value          | TTL  |
|-------|------------------|----------------|------|
| A     | `@` (apex)       | `8.232.108.57` | 3600 |
| A     | `www`            | `8.232.108.57` | 3600 |

(If your registrar can't put an A record on `www`, use `CNAME www → killcam.app`
instead.) After DNS resolves, the Google-managed cert auto-provisions in
~15–60 min and `https://killcam.app` goes live. No domain-verification step is
required with the load-balancer + managed-cert path.

## 4. Load balancer (one-time; see the "LB setup" commands in the deploy notes)

Serverless NEG → backend service → URL map → managed cert (`killcam.app`,
`www.killcam.app`) → HTTPS target proxy → forwarding rule on `killcam-ip`.

## 5. Supabase must-dos

- Apply migrations `001` → `013` (SQL editor, in order). `013` adds creator
  agreements, rev-share ledger, clans, rooms, and archive columns.
- Add `https://killcam.app` to Auth → URL Configuration (redirect URLs) so OAuth
  doesn't 400.
- Free-tier projects PAUSE when idle — unpause `siwcdegiavwcvgjegiww` if needed.

## 6. The publish/archive worker (separate box with the external drive)

`scripts/youtube-uploader.ts` publishes combined masters to YouTube, archives
each master to `ARCHIVE_DIR` (external drive — **fails loudly if missing**), then
purges the transient raw uploads. Required env in `.env` (see `.env.example`):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`,
and `ARCHIVE_DIR` (e.g. `E:\KillCamMasters`).
