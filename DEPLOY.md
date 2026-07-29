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

## Site layout — marketing at `/`, app at `/app`

The single origin (`tko.cam`) now serves **two** bundles:

| URL          | Bundle      | Vite base | Build command                        |
| ------------ | ----------- | --------- | ------------------------------------ |
| `/`          | `dist-site` | `/`       | `npm run build:site`                 |
| `/app`, `/app/*` | `dist`  | `/app/`   | `VITE_BASE_PATH=/app/ npm run build` |

- The **app router** uses `basename={import.meta.env.BASE_URL}` (`src/main.tsx`),
  so it auto-mounts at `/app` on web (BASE_URL=`/app/`) and at `/` on mobile
  (BASE_URL=`/`, since `_mobilebuild.bat` never sets `VITE_BASE_PATH`). No route
  paths changed.
- Two servers implement the same layout, pick per deploy:
  - `server/index.ts` (Express, real Postgres backend) — the current `CMD`.
    Serves `dist-site` at `/`, `dist` at `/app`, API under `/api`.
  - `serve.mjs` (zero-dep static) — same `/` + `/app` split, no API. Swap the
    Dockerfile `CMD` to `["node","serve.mjs"]` for a static-only preview.
- If `dist-site/` is missing at runtime, both servers fall back to serving the
  app at `/` so the origin never hard-404s.

## What the container does

`Dockerfile` builds **both** bundles — `npm run build` with `VITE_BASE_PATH=/app/`
(→ `dist/`) and `npm run build:site` (→ `dist-site/`) — then runs `server/index.ts`
on `$PORT` (8080), serving the marketing site at `/` and the product app at `/app`.

Build env is set in the Dockerfile: `VITE_BASE_PATH=/app/`, `VITE_REAL_BACKEND=1`,
`VITE_CREATION_AD_SECONDS=0`, `NODE_ENV=production`. The deploy command below does
**not** need to pass any Vite env — it is baked into the image build.

## PWA install + update (how testers stay on the newest build)

The app is installable from `tko.cam` and pushes itself forward, so a tester
never has to reinstall or get signed out to see a new deploy.

| Piece | Where | Notes |
| ----- | ----- | ----- |
| App manifest | `public/manifest.json` → `/app/manifest.json` | `start_url`/`scope` are **relative** (`.`), so they resolve to `/app/` on web and `/` on mobile. |
| Site manifest | `public/manifest.site.json` → `/manifest.json`'s sibling at `/` | Same `id` (`/app/`) but `start_url: "/app/"` — installing from the landing page gives an icon that opens the **product**, not the brochure. |
| Service worker | `public/sw.js`, registered at `/sw.js` (site, scope `/`) and `/app/sw.js` (app, scope `/app/`) | Network-first for the HTML shell, cache-first only for `assets/*` (content-hashed), `/api/*` never touched. |
| Build stamp | `vite.buildId.ts` → `import.meta.env.VITE_BUILD_ID`, `<meta name="tko-build">`, and `dist/version.json` | Set `BUILD_ID` (e.g. a git sha) in the build env to override the timestamp default. |
| Update prompt | `src/hooks/useAppUpdate.ts` + `src/components/UpdateBanner.tsx` | Raised by a *waiting* worker OR by `/version.json` disagreeing with the running build. |

The worker **never** calls `skipWaiting()` by itself — it waits for the user to
tap **Update**. That reload clears no storage, so the JWT in localStorage
(`kc_token`) survives and the session is rehydrated on the new build.

Both servers (`server/index.ts` and `serve.mjs`) send `no-store` for
`version.json` and `sw.js` and `no-cache` for the HTML shells. **Do not put a
CDN cache in front of those three** or already-installed testers stop seeing new
builds — that is the entire failure mode this exists to prevent.

Verify a deploy landed:

```
curl -s https://tko.cam/app/version.json     # buildId must change every deploy
```

---

# Payments (Stripe)

The whole money path — subscriptions, Token packs, the 7-day trial — is real and
fulfilled server-side. It is **off** until the operator sets the secrets below,
and while it is off the app says so plainly and charges nothing. There is no
state in which a purchase button appears to work and silently credits something.

## What happens when someone pays

| Purchase | Endpoint | What actually fulfils it |
| -------- | -------- | ------------------------ |
| Subscription (Ad-Free / Pro / Elite / Legend) | `POST /api/checkout` `{tier}` | Webhook `checkout.session.completed` → grants the tier on `users.user_metadata`. `customer.subscription.*` and `invoice.*` then extend / downgrade / lapse it. |
| Token pack | `POST /api/checkout` `{pack}` | Webhook `checkout.session.completed` (mode `payment`) → credits the wallet through the same trusted `moveWallet` path the daily grant uses, and books a `wallet_ledger` row. |
| 7-day free trial | `POST /api/checkout` `{tier, trialDays: 7}` | Stripe collects the card, charges nothing for 7 days, then **auto-charges**. We only follow the webhooks. |

Two rules make this safe, and both are covered by tests in `server/app.test.ts`:

1. **The server never trusts the client about value.** The Checkout Session
   carries only a tier or pack *key*; the price comes from the server's env and
   the Token amount from the server's own catalogue (`SERVER_TOKEN_PACKS` in
   `server/app.ts`, asserted identical to `src/lib/tokenPacks.ts`). A tampered
   `priceId` or `metadata[tokens]` changes nothing.
2. **Every event is fulfilled at most once.** Stripe delivers *at least* once and
   retries any non-2xx for 3 days. The webhook claims `event.id` in the
   `stripe_events` table (primary key) before doing any work, so a replay is a
   no-op. If fulfilment throws, the claim is released and a non-2xx returned, so
   Stripe retries and the user is not left having paid for nothing.

## Server environment

Set on the Cloud Run service. **Never in the repo, never in a `VITE_*` var**
(anything `VITE_` is compiled into the browser bundle and is public).

| Var | Required | What it does |
| --- | -------- | ------------ |
| `STRIPE_SECRET_KEY` | **yes** | `sk_live_…` / `sk_test_…`. Its presence is what switches payments on. Without it every payment endpoint returns `503 stripe_not_configured` and the UI shows "payments not enabled". |
| `STRIPE_WEBHOOK_SECRET` | **yes** | `whsec_…` from the dashboard's webhook endpoint. Without it the webhook **refuses every delivery** rather than trusting an unsigned payload. |
| `APP_URL` | yes | Origin **including the app base path**, e.g. `https://tko.cam/app`. Used for the checkout success/cancel redirects and Connect return URLs. |
| `STRIPE_PRICE_AD_FREE` | per tier | Monthly price id, $1.99 |
| `STRIPE_PRICE_PRO` | per tier | Monthly price id, $4.99 |
| `STRIPE_PRICE_SUPPORTER` | per tier | Monthly price id, $9.99 (displayed as **Elite**) |
| `STRIPE_PRICE_CREATOR` | per tier | Monthly price id, $29.99 (displayed as **Legend**) |
| `STRIPE_PRICE_PACK_STARTER` | per pack | One-time price id, $0.99 → 100 Tokens + 40 Sweeps |
| `STRIPE_PRICE_PACK_PLUS` | per pack | One-time price id, $4.99 → 550 Tokens + 200 Sweeps |
| `STRIPE_PRICE_PACK_PRO` | per pack | One-time price id, $9.99 → 1,200 Tokens + 400 Sweeps |
| `STRIPE_PRICE_PACK_MEGA` | per pack | One-time price id, $19.99 → 3,000 Tokens + 800 Sweeps |

A tier or pack whose price var is unset is simply **not purchasable** — the UI
renders it "Unavailable" and the API returns `400 no_price`. You can therefore
switch items on one at a time.

Secrets belong in **Secret Manager** (project `reelone-498406`, alongside the
existing `killcam-jwt-secret`), price ids can be plain env vars:

```bat
REM one-time: create the secrets
gcloud secrets create stripe-secret-key --project reelone-498406 --replication-policy=automatic
gcloud secrets create stripe-webhook-secret --project reelone-498406 --replication-policy=automatic

REM add a version (reads from a file so the key never lands in shell history)
gcloud secrets versions add stripe-secret-key --project reelone-498406 --data-file=-

REM wire them to the service
gcloud run services update killcam --region us-central1 --project reelone-498406 ^
  --set-secrets STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest ^
  --update-env-vars APP_URL=https://tko.cam/app,STRIPE_PRICE_PRO=price_xxx,STRIPE_PRICE_PACK_PLUS=price_yyy
```

## Step 1 — create the catalogue

`scripts/stripe-setup.ts` creates the products and prices and prints the env
lines. It is **idempotent**: products use deterministic ids (`tko_sub_pro`,
`tko_pack_mega`) and prices use deterministic `lookup_key`s, so re-running reuses
what exists. Changing an amount in the script creates a *new* Stripe price and
moves the lookup key to it (existing subscribers stay on the old one, and the
change is reported loudly).

```bat
REM dry run first — shows what would change, writes nothing
set STRIPE_SECRET_KEY=sk_test_xxx
npm run stripe:setup -- --dry-run

REM for real
npm run stripe:setup
```

Do the whole flow against a **test** key first. The key is read from the
environment only — it is never printed, logged or written to disk.

## Step 2 — register the webhook

In the Stripe dashboard → Developers → Webhooks → *Add endpoint*:

**Endpoint URL:** `https://tko.cam/api/stripe/webhook`

(The path is always `/api/stripe/webhook` on the API origin — note it is **not**
under `/app`, since the API is mounted at `/api` on the root origin.)

**Events to send** — exactly these seven:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
account.updated
```

`account.updated` is only needed if you use Stripe Connect creator payouts.

Copy the signing secret it shows you (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

## Step 3 — apply the schema

The billing tables are additive and idempotent, so just re-run the schema:

```bat
psql "<cloud-sql-conn>" -f db/schema.sql
```

This adds `users.stripe_customer_id`, `stripe_events` (idempotency),
`payments` (audit) and `creator_stripe_accounts`.

## Step 4 — verify

```bat
REM should report configured:true and the items you set prices for
curl https://tko.cam/api/payments/config
```

Then use the Stripe CLI to replay a real event against the deployed endpoint,
and confirm the same event delivered twice credits only once:

```
stripe trigger checkout.session.completed
```

## Audit trail

- `payments` — one row per fulfilment attempt (paid / unpaid / failed), with the
  Stripe session, invoice, subscription and customer ids. A user can read **their
  own** rows through `/api/db`; nobody can write one.
- `wallet_ledger` — the append-only balance movement, `kind='purchase'`, with the
  Checkout Session id in `ref_id`.
- `stripe_events` — every event id ever processed.

## Still stubbed

**Creator payouts.** Stripe Connect onboarding works (`/api/connect/onboard`,
`/api/connect/status`) but nothing ever creates a **Transfer**, so creators can
onboard and still cannot be paid. `donations` is referenced by the table policy
but has no table in `db/schema.sql`.

**App-store billing.** Tokens and subscriptions are digital goods consumed in the
app, so Apple and Google require *their* billing inside the mobile builds —
Stripe Checkout there is a policy violation. Keep purchases web-only in the APK
until Play Billing / StoreKit is implemented (see `docs/mvp-readiness.md` § D).

---

# Mobile (Android) builds

There are **two** Android builds, and picking the wrong one is the single easiest
way to ship an APK that silently does nothing.

| Script | Backend | Use it for |
| ------ | ------- | ---------- |
| `_mobilebuild.bat` | **Mock** (in-memory) | Local UI work. Fully clickable, **persists nothing.** |
| `_mobilebuild_real.bat` | **Real** (`/api` → Cloud Run) | Anything you install on a phone to actually test. |

```bat
REM real backend, default origin https://tko.cam
_mobilebuild_real.bat

REM real backend, some other deployment
_mobilebuild_real.bat https://staging.tko.cam
```

Both scripts run `vite build` → `cap sync android` → `gradlew assembleDebug`
and write a log next to themselves (`_mobilebuild.log` / `_mobilebuild_real.log`).

## Why the real build needs `VITE_API_BASE`

Two separate bugs used to make the phone app unable to reach the backend at all:

1. `_mobilebuild.bat` ran a bare `vite build`, so `.env.local`'s
   `VITE_MOCK_BACKEND=1` was baked into the APK.
2. `src/lib/realSupabase.ts` used a **relative** `/api`. Capacitor serves the
   bundle from `https://localhost` (`capacitor.config.ts`, `androidScheme: 'https'`),
   so `/api/auth/login` resolved to `https://localhost/api/auth/login` — nothing.

The fix is `src/lib/apiBase.ts`, which resolves the base once:

| `VITE_API_BASE` | resolved base | used by |
| --------------- | ------------- | ------- |
| *(unset)* | `/api` | web build (same origin as the API) |
| `https://tko.cam` | `https://tko.cam/api` | the APK |
| `https://tko.cam/` | `https://tko.cam/api` | trailing slash trimmed |
| `https://tko.cam/api` | `https://tko.cam/api` | not doubled |

Build env for a real-backend APK (what `_mobilebuild_real.bat` sets):

```
VITE_REAL_BACKEND=1
VITE_MOCK_BACKEND=          (explicitly cleared — .env.local sets it to 1)
VITE_API_BASE=https://tko.cam
VITE_BASE_PATH=             (mobile serves from '/', never '/app')
```

## CORS on the server

Because the APK is cross-origin, the Express API must answer its preflights.
`server/app.ts` allow-lists:

- `https://localhost`, `http://localhost`, `capacitor://localhost`, `ionic://localhost` — Capacitor
- `https://tko.cam`, `https://www.tko.cam`, `https://killcam.app`, `https://www.killcam.app`
- any `localhost` / `127.0.0.1` port — the Vite dev server and device port-forwards

with `credentials: true` and the `Authorization` header allowed (that is how the
JWT travels). It is an allow-list, not `*`, so a random site cannot drive the API
from a signed-in user's browser. Add more origins at deploy time:

```
gcloud run services update killcam --region us-central1 \
  --set-env-vars APP_ORIGINS=https://staging.tko.cam,https://preview.tko.cam
```

---

# Android release signing

Play will not accept a debug-signed or unsigned artifact, and it wants an
**.aab**, not an APK.

**No keystore or password exists in this repo, and none will be generated for
you** — the release key is the one secret that cannot be re-issued. If you lose
it you cannot update the app, ever. Create it yourself, once:

```bat
keytool -genkeypair -v ^
  -keystore C:\keys\tko-release.jks ^
  -alias tko ^
  -keyalg RSA -keysize 4096 -validity 10000 ^
  -storetype PKCS12
```

`keytool` ships with the JDK (it is on the PATH once Android Studio's JDK is).
It will prompt for a store password, a key password and your name/organisation.
**Back the `.jks` file and both passwords up somewhere you will still have in
five years** (a password manager plus an offline copy).

Then tell Gradle where it is, by any ONE of these (checked in this order):

**1. `android/keystore.properties`** — git-ignored, easiest locally:

```properties
TKO_KEYSTORE_FILE=C:/keys/tko-release.jks
TKO_KEYSTORE_PASSWORD=your-store-password
TKO_KEY_ALIAS=tko
TKO_KEY_PASSWORD=your-key-password
```

**2. Gradle properties** — `~/.gradle/gradle.properties`, or per-invocation:

```bat
cd android
gradlew.bat bundleRelease -PTKO_KEYSTORE_FILE=C:/keys/tko-release.jks -PTKO_KEYSTORE_PASSWORD=... -PTKO_KEY_ALIAS=tko -PTKO_KEY_PASSWORD=...
```

**3. Environment variables** of the same names — what CI should use
(`TKO_KEYSTORE_FILE`, `TKO_KEYSTORE_PASSWORD`, `TKO_KEY_ALIAS`, `TKO_KEY_PASSWORD`).

Produce the upload artifact:

```bat
_mobilebuild_real.bat
cd android
gradlew.bat bundleRelease
REM -> android/app/build/outputs/bundle/release/app-release.aab
```

If the signing config is absent, Gradle prints
`TKO: no release signing config found — release builds will be UNSIGNED`
and **`assembleDebug` still works exactly as before**. That warning is the only
symptom; check for it before uploading.

Other release settings (`android/app/build.gradle`, `android/variables.gradle`):

- `compileSdkVersion` / `targetSdkVersion` = **35** (Play's floor since Aug 2025;
  re-check in Play Console before each submission).
- `minifyEnabled false` / `shrinkResources false` — **deliberate.** Capacitor
  registers plugins reflectively, so R8 with stock rules strips classes the
  bridge needs and the app breaks at runtime rather than at build time. Nearly
  all the app's size is the web bundle in `assets/`, which R8 never touches.
  `proguard-rules.pro` already carries the Capacitor keep rules, so enabling it
  later is a two-line change plus an on-device pass over every plugin.

---

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
