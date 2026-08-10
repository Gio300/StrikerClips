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

# League domain bundles (SSL on Amplify) — league-branded PWA

A league's own domain (shinobistrikerleague.com, hosted as an AWS Amplify
manual deploy) serves the **app** bundle at `/`. The runtime chrome re-skins
itself via the domain takeover (`src/lib/leagueDomain.ts`), but **everything
static in the HTML is not covered by that** — the PWA manifest and the `<head>`
are shipped bytes. Without a build step, installing from the league's domain
puts **TKO's** name and icon on the home screen, and *sharing* the league's
link shows **TKO's** preview card (no crawler — Slack, Discord, iMessage, X,
Facebook — runs the takeover JS; they read the shipped `<head>` and stop).
`scripts/league_pwa.py` stamps the league identity onto a built `dist/`:

```bat
REM 1. Build the app at '/', real backend at tko.cam (same env the SSL zips used)
set VITE_REAL_BACKEND=1& set VITE_API_BASE=https://tko.cam& set VITE_BASE_PATH=& npm run build

REM 2. Brand it as the league + zip for the Amplify manual deploy
python scripts/league_pwa.py --slug shinobistrikerleague --name "Shinobi Striker League" ^
    --domain shinobistrikerleague.com --tagline "rise. strike. reign." --no-card-name ^
    --zip ssl-deploy7.zip
```

What the script does (see its docstring): regenerates every `icons/*.png`
(192/512 + apple/favicons, `any`+`maskable`) from
`public/leagues/<slug>.png` on the stock dark `#0A0A0C`, renders the social
card `leagues/<slug>-og.png`, rewrites `manifest.json` with the league
name/short_name and stock-dark theme colors, rewrites the whole social `<head>`
(below), and zips with **forward-slash** arcnames (Windows backslash entries
break Amplify). It only ever writes into `dist/` — the source `index.html`
stays TKO's, so tko.cam's own previews are untouched.

### Link previews (the shared-link card)

Every tag a crawler reads is rewritten for the league, and **inserted if the
template doesn't carry it**:

| Tag | Value |
| --- | ----- |
| `<title>`, `og:title`, `twitter:title` | `<name> — <tagline>` (name alone without `--tagline`) |
| `description`, `og:description`, `twitter:description` | `--description`, else derived from name + tagline |
| `og:site_name`, `apple-mobile-web-app-title` | `--name` |
| `og:url` | `https://<--domain>/` — must be absolute or scrapers ignore it |
| `og:type` | `website` |
| `og:image`(+`:secure_url`/`:type`/`:alt`/`:width`/`:height`), `twitter:image`(+`:alt`) | `https://<domain>/leagues/<slug>-og.png?v=<content hash>`, 1200x630 |
| `twitter:card` | `summary_large_image` |

The card itself is generated by PIL from the league's own logo: alpha-trimmed
and contained on the stock dark `#0A0A0C`, over a soft wash in the logo's own
dominant hue, with the name and/or tagline beneath — dropped automatically if
they can't be drawn legibly. Pass `--no-card-name` when the logo is a full
lockup that already spells the league name (SSL's is), so the card doesn't say
it twice. The `?v=` is a content hash: it busts the scrapers' image cache
exactly when the card changes and never otherwise.

**Future leagues:** drop their logo at `public/leagues/<slug>.png` (the same
asset `LeagueWatermark`/`BrandLogo` use), then run the script with their
`--slug`/`--name`/`--domain`. The same name+icon inputs are what a per-league
app-store (wrapped) build will use for its store listing, so this file is the
single source of a league's installed-app identity.

Deploy the zip — CLI (`--profile swoosh`, SSL app id `d1hmhqwu3vw5bg`):

```bash
aws amplify create-deployment --app-id d1hmhqwu3vw5bg --branch-name main --profile swoosh
curl -H "Content-Type: application/zip" --upload-file ssl-deploy7.zip "<zipUploadUrl>"
aws amplify start-deployment --app-id d1hmhqwu3vw5bg --branch-name main --job-id <jobId> --profile swoosh
aws amplify get-job --app-id d1hmhqwu3vw5bg --branch-name main --job-id <jobId> --profile swoosh  # until SUCCEED
```

Never zip with PowerShell `Compress-Archive` — it writes backslash arcnames
and Amplify serves a broken bundle. Console alternative: the league's app →
**Deploy updates** (manual deploy) → drag the zip. Verify after deploy:

```
curl -s https://shinobistrikerleague.com/manifest.json   # name must be the league's
curl -s https://shinobistrikerleague.com/version.json    # buildId must be the new build
curl -s https://shinobistrikerleague.com/ | grep -E "og:|<title>"   # league values, zero tko.cam
curl -sI "https://shinobistrikerleague.com/leagues/shinobistrikerleague-og.png"  # 200, image/png
```

---

# League URLs — the three rungs

Operator, 2026-08-04: *"users can attach their website name to our app if they
pay for that level on TKO for their branding.. or they just get tko.cam/their
league name."*

A league's ADDRESS is a tier benefit. Which plans exist and whether one was
actually PAID for belongs to `src/lib/leaguePlans.ts` (`leagues.tier` +
`leagues.plan_status`); `src/lib/leagueUrls.ts` maps that ladder onto the three
addresses. Both halves of the app import them, so the rule cannot drift between
the UI and the enforcement.

**Two gates, not one.** `leagues.tier` is editable from the Studio — it is a
design document. `leagues.plan_status` is webhook-only. Rungs 2 and 3 require
BOTH a high enough tier and `plan_status` in {`active`, `comped`}. Rung 1 is
deliberately outside that: `tko.cam/<slug>` is the operator's stated no-pay
option, so an unpaid draft still has an address to share.

Rung 3 sits at **Dynasty**, the top plan a card can actually buy — Enterprise
is a lead capture with no self-serve checkout, so pinning the rung there would
make it unsellable. `canUseUrlRung('custom', …)` also defers to leaguePlans'
own `custom_domain` capability, so this layer can only ever be stricter than
the plan catalogue.

| Rung | Address | Tier | Infra needed |
| ---- | ------- | ---- | ------------ |
| 1 · PATH | `https://tko.cam/<slug>` | every plan | **none** — ships working |
| 2 · SUBDOMAIN | `https://<slug>.tko.cam` | Pro League + | wildcard DNS + wildcard-capable cert |
| 3 · CUSTOM | `https://<their-own-domain>` | Dynasty + | league adds A + TXT; operator adds the domain to a cert |

All three produce the **same** takeover — colors, logo, name, watermark,
splash, title. `src/components/LeagueThemeProvider.tsx` folds them into one
source (`'domain'`) on purpose.

## Rung 1 — the path (already live, nothing to do)

The SPA owns the root of tko.cam, so `/<slug>` is free. `src/main.tsx` sets the
router `basename` to `/<slug>` when the first path segment is a slug that is
**not** one of the app's own route names (`RESERVED_ROOT_PATHS`). That one line
makes every existing `<Route>` and `<Link>` work under the prefix with no
per-route change — and makes share links carry it
(`src/lib/canonicalUrl.ts`).

Two safety rails, both tested:

- **Reserved names win.** `/tournaments`, `/studio`, `/leagues`, `/assets`… are
  never leagues. Adding a new top-level route means adding its name to
  `RESERVED_ROOT_PATHS` in `src/lib/leagueUrls.ts` — that list is the contract.
- **Unknown slugs fail soft.** The prefix is adopted optimistically (the
  basename must be decided before the first paint), then
  `GET /api/league/<slug>/config` confirms it. No such league → the app drops
  the prefix and reloads the plain URL, so `tko.cam/typo` lands on the ordinary
  app rather than a broken page.

Verify after any deploy:

```bash
curl -s https://tko.cam/shinobistrikerleague | grep -o '<title>[^<]*'
curl -s https://tko.cam/api/league/shinobistrikerleague/config | head -c 400
```

## Rung 2 — `<slug>.tko.cam` (operator action required)

### What the infrastructure looks like today (verified 2026-08-04)

```
tko.cam            A      8.232.108.57         (GoDaddy — ns21/ns22.domaincontrol.com)
8.232.108.57       =      reserved IP `killcam-ip`, project reelone-498406
  ├── killcam-http-fr  → killcam-http-proxy
  └── killcam-https-fr → killcam-https-proxy
                            ssl-certificates: killcam-cert (killcam.app, www.killcam.app)
                                              tko-cert     (tko.cam, www.tko.cam)
                            url-map: killcam-urlmap
                              └── NO host rules — defaultService = killcam-backend
                                    └── serverless NEG killcam-neg → Cloud Run `killcam` (us-central1)
```

**The URL map has no host rules.** That is what makes this cheap: ANY hostname
that (a) resolves to `8.232.108.57` and (b) presents a valid certificate is
*already* served by the Cloud Run app. Nothing in the load balancer ever needs
to change per league — only DNS and certificates.

So rung 2 needs exactly two things: a wildcard **DNS** record and a wildcard
**certificate**.

### Step 1 — wildcard DNS (GoDaddy, tko.cam zone)

One record. This is the only DNS change rung 2 ever needs.

| Type | Name | Value | TTL |
| ---- | ---- | ----- | --- |
| `A` | `*` | `8.232.108.57` | 600 |

Confirm (NXDOMAIN before the change, the reserved IP after):

```bash
nslookup -type=A anything.tko.cam 8.8.8.8
```

Infrastructure labels are refused in code (`RESERVED_SUBDOMAINS` in
`src/lib/leagueUrls.ts`: `api`, `cdn`, `static`, `mail`, `admin`, `auth`,
`status`…), so the wildcard cannot let a league named "api" take over
`api.tko.cam`.

### Step 2 — a wildcard-capable certificate

**Classic managed certs (`gcloud compute ssl-certificates`) do not support
wildcards.** Two ways forward; pick one.

**OPTION A — Certificate Manager wildcard (recommended: one-time, then every
league subdomain just works).**

> ⚠️ **Read before running.** Attaching a certificate map to a target HTTPS
> proxy makes the proxy **ignore** the SSL certificates attached directly to
> it. `killcam-https-proxy` also terminates **killcam.app** and
> **www.killcam.app** via `killcam-cert`. If the map does not cover those two
> names, killcam.app breaks. The commands below cover them.

```bash
P=reelone-498406

# 1. DNS authorization for the tko.cam zone — this is what permits a wildcard.
gcloud certificate-manager dns-authorizations create tko-cam-dnsauth \
    --domain="tko.cam" --project=$P
gcloud certificate-manager dns-authorizations describe tko-cam-dnsauth \
    --project=$P \
    --format="value(dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)"
#    → add THAT CNAME at GoDaddy (an `_acme-challenge…` host pointing at a
#      *.googlehosted.com value), then wait for it to resolve.

# 2. The wildcard certificate.
gcloud certificate-manager certificates create tko-wildcard-cert \
    --domains="tko.cam,*.tko.cam" \
    --dns-authorizations="tko-cam-dnsauth" --project=$P

# 2b. The same again for killcam.app, so the map can keep serving it.
gcloud certificate-manager dns-authorizations create killcam-app-dnsauth \
    --domain="killcam.app" --project=$P
gcloud certificate-manager dns-authorizations describe killcam-app-dnsauth \
    --project=$P \
    --format="value(dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)"
gcloud certificate-manager certificates create killcam-app-cert \
    --domains="killcam.app,www.killcam.app" \
    --dns-authorizations="killcam-app-dnsauth" --project=$P

# 3. Wait until BOTH report ACTIVE before going near the proxy.
gcloud certificate-manager certificates describe tko-wildcard-cert --project=$P
gcloud certificate-manager certificates describe killcam-app-cert  --project=$P

# 4. The map.
gcloud certificate-manager maps create tko-cert-map --project=$P
gcloud certificate-manager maps entries create tko-apex \
    --map=tko-cert-map --certificates=tko-wildcard-cert \
    --hostname="tko.cam" --project=$P
gcloud certificate-manager maps entries create tko-wildcard \
    --map=tko-cert-map --certificates=tko-wildcard-cert \
    --hostname="*.tko.cam" --project=$P
gcloud certificate-manager maps entries create killcam-apex \
    --map=tko-cert-map --certificates=killcam-app-cert \
    --hostname="killcam.app" --project=$P
gcloud certificate-manager maps entries create killcam-www \
    --map=tko-cert-map --certificates=killcam-app-cert \
    --hostname="www.killcam.app" --project=$P

# 5. Attach. THIS is the moment the classic certs stop being used.
gcloud compute target-https-proxies update killcam-https-proxy \
    --certificate-map=tko-cert-map --global --project=$P
```

Verify all five names — then rung 2 is done forever, and a new Pro league needs
no infra at all:

```bash
for h in tko.cam www.tko.cam shinobistrikerleague.tko.cam killcam.app www.killcam.app; do
  printf '%-32s ' "$h"; curl -sI "https://$h/" -o /dev/null -w '%{http_code}\n'
done
```

Rollback is instant and deletes nothing:

```bash
gcloud compute target-https-proxies update killcam-https-proxy \
    --clear-certificate-map --global --project=reelone-498406
# classic killcam-cert + tko-cert take over again
```

**OPTION B — no map, one classic cert listing each league (zero risk, small
per-league toil).** Do the wildcard DNS record above, leave the proxy exactly
as it is, and name each sold league's subdomain in one extra classic managed
cert. A classic cert holds up to 100 domains and a proxy up to 15 certs, so
this reaches ~1500 leagues before Option A becomes mandatory.

```bash
P=reelone-498406
# First league (create the cert + attach):
gcloud compute ssl-certificates create tko-leagues-cert \
    --domains="shinobistrikerleague.tko.cam" --global --project=$P
gcloud compute target-https-proxies update killcam-https-proxy \
    --ssl-certificates=killcam-cert,tko-cert,tko-leagues-cert \
    --global --project=$P

# Every league after that — managed certs are immutable, so create a NEW one
# with the full list and swap it in (the old one keeps serving until the swap):
gcloud compute ssl-certificates create tko-leagues-cert-2 \
    --domains="shinobistrikerleague.tko.cam,blaze.tko.cam" --global --project=$P
gcloud compute target-https-proxies update killcam-https-proxy \
    --ssl-certificates=killcam-cert,tko-cert,tko-leagues-cert-2 \
    --global --project=$P
gcloud compute ssl-certificates delete tko-leagues-cert --global --project=$P --quiet
```

### What the app does on its own

Nothing above touches the app. Once DNS + cert exist, `server/index.ts` runs a
**host gate** in front of the static SPA:

- `<slug>.tko.cam` for a PAID league whose `leagues.tier` is Pro League or
  higher → served.
- Below that tier → `302` to `https://tko.cam/<slug>`, the rung the league
  actually pays for. A league is only ever *downgraded* to its path address,
  never dead-ended.
- Unknown subdomain, reserved label, or the apex → passes straight through.

The decision is one small query, memoized 60 s, skipped for `/api`, and
fail-soft: any error serves the site exactly as before.

## Rung 3 — the league's own domain (Dynasty and above)

The app side is **built and self-serve**; the operator only does the cert.

1. **The league claims the domain in the Studio** ("League URL" → *Your own
   domain*). `POST /api/fn/league-url-claim` checks the league's row is
   Dynasty-or-above AND paid, stores the domain and mints a token.
2. **The league publishes ONE TXT record** at their registrar:

   | Type | Name | Value |
   | ---- | ---- | ----- |
   | `TXT` | `_tko-verify` | `tko-verify=<32-hex token>` |

3. **The league clicks "Check verification"** — `POST /api/fn/league-url-verify`
   does the DNS lookup server-side (`server/leagueUrl.ts`) and flips the row to
   `verified`. Until then the host gate refuses that hostname, so nobody can
   point DNS at us and steal a league's app.
4. **The league adds an A record** `@ → 8.232.108.57` (and `www` → the same).
5. **The operator adds the domain to a certificate.** With Option A above:

   ```bash
   P=reelone-498406; D=theirleague.com; N=${D//./-}
   gcloud certificate-manager dns-authorizations create "$N-dnsauth" \
       --domain="$D" --project=$P
   gcloud certificate-manager dns-authorizations describe "$N-dnsauth" \
       --project=$P \
       --format="value(dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)"
   #   → the LEAGUE adds that CNAME too (same registrar, one more record)
   gcloud certificate-manager certificates create "$N-cert" \
       --domains="$D,www.$D" --dns-authorizations="$N-dnsauth" --project=$P
   gcloud certificate-manager maps entries create "$N" \
       --map=tko-cert-map --certificates="$N-cert" --hostname="$D" --project=$P
   gcloud certificate-manager maps entries create "$N-www" \
       --map=tko-cert-map --certificates="$N-cert" --hostname="www.$D" --project=$P
   ```

   With Option B, add `$D,www.$D` to the next `tko-leagues-cert-N` instead.

   **No URL-map or backend change, ever** — the map has no host rules, so the
   new hostname is routed to Cloud Run the moment TLS works.

6. Verify:

   ```bash
   curl -sI https://theirleague.com/ -o /dev/null -w '%{http_code}\n'
   curl -s "https://tko.cam/api/league/by-host?host=theirleague.com"
   #   → {"slug":"…","rung":"custom","entitled":true,"redirect_to":null}
   ```

**shinobistrikerleague.com is grandfathered and untouched.** It stays the
hand-built AWS Amplify deploy documented in the previous section (its DNS
points at AWS, not at `8.232.108.57`); nothing here changes it. To retire that
pattern later: claim + verify the domain in the Studio, do step 5, then repoint
the A record at `8.232.108.57`. Note the tradeoff — the Amplify per-league
bundle (`scripts/league_pwa.py`) exists to brand the *installed PWA icon and
the link-preview card* on a standalone host. A league served from the shared
origin keeps TKO's manifest and preview card. That is a known, deliberate limit
of rungs 1 and 2, and the reason rung 3 is the top tier.

## Where the entitlement is actually enforced

| Layer | File | What it refuses |
| ----- | ---- | --------------- |
| Claim / verify / release | `server/app.ts` → `POST /api/fn/league-url-*` | an unpaid plan, a tier below the rung, an already-claimed domain, an unproven TXT |
| Hostname | `server/index.ts` host gate → `hostGateDecision()` | serving a subdomain / custom host above the league's tier, or unverified |
| Shared rule | `src/lib/leagueUrls.ts` | — the vocabulary both halves import |
| Studio UI | `src/components/LeagueUrlPanel.tsx` | nothing (honest UI only): locked rungs stay VISIBLE with their real address and an "Unlock — upgrade your account" CTA |

The Studio panel reads `leagues.tier` AND `leagues.plan_status` from the
server, never the local draft — flipping the plan radio in the Studio changes
the design document, not the entitlement.

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
| **Cancellation (self-serve)** | `POST /api/billing/portal` | Opens Stripe's hosted Customer Portal. The cancel comes back as `customer.subscription.updated` → `.deleted`, which lapses the tier. **Needs the dashboard step in [Step 2b](#step-2b--enable-the-customer-portal-required--this-is-the-cancel-button).** |

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
| `STRIPE_PRICE_LEAGUE_STARTER` | per league plan | Monthly price id, $49 — **league owner**, not a player |
| `STRIPE_PRICE_LEAGUE_PRO` | per league plan | Monthly price id, $149 |
| `STRIPE_PRICE_LEAGUE_DYNASTY` | per league plan | Monthly price id, $399 |

A tier or pack whose price var is unset is simply **not purchasable** — the UI
renders it "Unavailable" and the API returns `400 no_price`. You can therefore
switch items on one at a time.

### Phone notifications (web push / VAPID)

| Var | Required | What it does |
| --- | -------- | ------------ |
| `VAPID_PUBLIC_KEY` | to enable push | The application-server public key. It is handed to the browser by `/api/fn/push-config` and embedded in every subscription. |
| `VAPID_PRIVATE_KEY` | to enable push | Signs the push requests. **A credential — treat it like `STRIPE_SECRET_KEY`.** |
| `VAPID_SUBJECT` | recommended | `mailto:you@tko.cam` or an https URL — who a push service contacts about this application server. Defaults to `https://tko.cam`. |

Generate the pair once, on your own machine:

```
npm run vapid:keys
```

It prints the three lines and writes nothing. Set them on the API service and
**restart it** — Node does not hot-reload.

**With the keys unset the whole feature is inert**, by design: `push-config`
answers `enabled: false`, the opt-in control on `/notifications` does not
render, `push-subscribe` refuses to store anything, and every send path returns
before it even reads the database. Nothing throws and no chat message is
affected either way.

**Do not regenerate the pair once members have subscribed.** The public key is
baked into every existing subscription; changing it silently breaks all of them
and everyone has to opt in again.

Members opt in per device on **/notifications**, on a tap — never on page load,
because a permission prompt fired without a user gesture is denied permanently
and cannot be asked for again. Two things notify today: a **direct message** to
you, and an **@mention** of you in any room. You are never notified about your
own message, nor about a conversation you are currently looking at.

iOS needs the app **added to the home screen** (16.4+) before web push works at
all; Android Chrome works in the browser.

### League plans are a SEPARATE product from the member ladder

`STRIPE_PRICE_LEAGUE_*` (a league owner buying a league) and `STRIPE_PRICE_*`
(a player buying a membership) are deliberately different namespaces, because
**both ladders contain the key `pro`**. If a league plan ever resolved through
`STRIPE_PRICE_PRO`, a $149 league checkout would open against the $4.99 member
price. The catalogue for both lives in code — `src/lib/leaguePlans.ts` and
`SUBSCRIPTION_TIERS` in `server/app.ts` — and `scripts/stripe-setup.ts` creates
both sets.

League plans **degrade instead of failing**: with `STRIPE_PRICE_LEAGUE_*` unset,
`/league-plans` still renders every plan and the button still works — it
captures the prospect into the `league_leads` table (email, plan, league name)
and says so. Enterprise never has a checkout at all; it is always a lead. So
you can ship the plans page before creating a single Stripe product and lose
nobody. Read the pipeline with:

```sql
select created_at, email, plan, league_name, source, status
  from league_leads order by created_at desc;
```

Webhook events the league path needs (on top of the member ones):
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` —
the same list, already registered. No new endpoint.

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

## Step 2b — enable the Customer Portal (REQUIRED — this is the cancel button)

**Most of this document is operational. This step is a legal obligation.** The
FTC negative-option rule and the state auto-renewal statutes (CA ARL, NY GBL
§527-a and others) require cancelling a subscription to be **at least as easy as
signing up**. Signing up is two clicks on `/upgrade`, so the app ships a
"Manage or cancel subscription" button (`POST /api/billing/portal`) that opens
Stripe's hosted Customer Portal — and §8.3 of the published Terms now tells
subscribers to use it.

**That button returns `502 portal_not_configured` until the portal is saved in
the dashboard.** It is a dashboard setting, not an env var, and test mode and
live mode are configured separately.

In the Stripe dashboard → **Settings → Billing → Customer portal**:

1. **Cancel subscriptions** — turn ON, mode **"At end of billing period"**. That
   is exactly what §8.3 promises: future renewals stop, the period already paid
   for is kept. Do not make a cancellation-reason survey a required step.
2. **Update payment methods** — turn ON. This is how a `past_due` subscriber
   fixes a failed card without contacting support.
3. **Invoice history** — turn ON.
4. **Switch plans / update quantity** — leave OFF unless you want portal-side
   upgrades; the app changes tiers through checkout.
5. **Business information** — set *Terms of service* to
   `https://tko.cam/app/terms` and *Privacy policy* to
   `https://tko.cam/app/privacy`. Stripe will not save without both.
6. **Default redirect link** — `https://tko.cam/app/upgrade`. The server sends
   its own `return_url` per session, so this is only the fallback.
7. **Save changes**, then repeat the whole list in **live mode** — a test-mode
   configuration does not carry over.

Verify:

```bat
REM signed-in user WITH a subscription: {"ok":true,"url":"https://billing.stripe.com/..."}
REM signed-in user who never paid:      {"ok":false,"error":"no_customer"}   (200, not an error)
curl -X POST https://tko.cam/api/billing/portal -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" -d "{}"
```

`{"ok":false,"error":"portal_not_configured"}` means the dashboard step above
has not been done, or was done in the other mode.

**The cancel closes the loop by itself.** Cancelling in the portal makes Stripe
send `customer.subscription.updated` (carrying `cancel_at_period_end`) and then
`customer.subscription.deleted` when the period ends. Both are already in the
required event list above and the webhook lapses `users.user_metadata` back to
Free — so no extra wiring. But if those two event types are ever dropped from
the endpoint, a cancel would leave the tier granted forever. Keep them.

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
