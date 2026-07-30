# TKO — MVP & App-Store Readiness Audit

**Date:** 2026-07-21
**Repo:** `StrikerClips` (tko.cam / app.killcam)
**Method:** direct code inspection. Every claim below cites a file. Nothing here is inferred from docs or commit messages.

---

## TL;DR — the honest headline

The app is a **large, well-organized, well-tested front end sitting on a backend that is not yet safe to expose to real users.** Test suite: 317 tests passing across 23 files, `tsc` clean, `vite build` clean. That is genuine quality work — but it measures the *pure logic modules*, not the system.

Three findings are hard launch-blockers, in priority order:

1. **The API has no row-level authorization.** `POST /api/db` lets any signed-in user update or delete *any row in any whitelisted table*, and lets an **unauthenticated** caller `select *` from `users` (emails + bcrypt hashes) and `redeem_codes` (every valid code). See `server/app.ts:266-343`.
2. **Chat spaces and Clans are broken on the deployed backend.** Those pages query `chat_spaces`, `chat_channels`, `chat_messages`, `clan_members` — none of which are in the server's table whitelist (`server/app.ts:27-44`), even though they exist in `db/schema.sql`. Every such query returns `400 unknown table`. They only work against the local mock.
3. **The mobile app cannot reach the backend at all.** `_mobilebuild.bat` runs bare `vite build`, so `.env.local`'s `VITE_MOCK_BACKEND=1` is baked into the APK. Even if it weren't, `realSupabase.ts:23` uses a **relative** `/api` base, which inside Capacitor resolves to `https://localhost/api` — not Cloud Run.

Beyond that: a large share of user-visible "economy" features (wallet, tokens, shop, Oracle predictions, clan treasury, winnings ledger) are **localStorage scaffolds**. They work perfectly for one person on one device and silently produce wrong/empty state for everyone else. No real money moves anywhere today except an optional Stripe subscription checkout that is almost certainly not configured.

**Opening tournament sign-ups today would be a mistake.** Opening them after the "Must-have" list in section E is realistic and not that far off — the King tournament path itself is the *most* real part of the app.

---

## A. Feature-by-feature reality check

Legend: **REAL** = persists to Postgres via the API, multi-user safe · **LOCAL-ONLY** = localStorage scaffold, single-device, silently wrong with real users · **STUB/MISSING** = not implemented.

### Core identity

| Feature | Status | Evidence / caveat |
|---|---|---|
| Sign up / sign in | **REAL** | `server/app.ts` — bcrypt + JWT HS256, `users` table. Works. But `JWT_SECRET` defaults to `'dev-secret-change-me'` (`server/app.ts:21`) — if that env var isn't set on Cloud Run, **anyone can forge a token for any user**. |
| Profile (view/edit, avatar, follows) | **REAL** | `profiles`, `follows` tables, queried throughout `src/pages/Profile.tsx`. |
| Account deletion | **MISSING** | `src/pages/DataDeletion.tsx` is a static text page. There is no delete button and no endpoint — grep for `delete.?account` across `*.ts,*.tsx` returns only the route registration and the page's own prose. The page even hedges: *"If you cannot locate this option in your build, use the email method below."* |
| Age gate (13+) | **MISSING** | No DOB, age checkbox, or COPPA logic in `src/pages/Signup.tsx`. |

### Content

| Feature | Status | Evidence / caveat |
|---|---|---|
| Create a reel / clip | **REAL** | `clips` / `reels` tables (`CreateMatch.tsx`, `MyClips.tsx`, `Reels.tsx`). |
| Watch / reel detail / reactions | **REAL** | `clips`, `reel_reactions`. |
| Per-clip analysis records | **LOCAL-ONLY** | `src/lib/clipRecords.ts` — key `kc_clip_records:<userId>`. Header says outright: *"nothing here is load-bearing beyond the demo/scaffold."* A `clip_records` table exists in `db/schema.sql:341` but is **not whitelisted** in the API, so it can't be used. |
| Discover / follow | **REAL** | `follows` table. |
| Connect YouTube | **REAL (client-side)** | `src/lib/youtubeConnect.ts` — Google Identity Services token client, no backend secret needed; `VITE_YT_CLIENT_ID` is set. Saved links persist to `user_youtube_links` (whitelisted). Caveat: the OAuth consent screen is still in *testing* mode, so only allow-listed Google accounts can connect until it's verified — that alone will block most tournament registrants at step (b) of the entry gate. |

### Tournaments — the strongest area

| Feature | Status | Evidence / caveat |
|---|---|---|
| Tournaments list/detail | **REAL** | `tournaments`, `tournament_admins`, `tournament_results`. |
| TKO King registration | **REAL** | `tournament_registrations` (whitelisted, in schema). `src/pages/TkoKing.tsx` writes real rows. |
| King board / battles | **REAL** | `tournament_battles`, `shinobi_defeats`. `buildKingBoard` in `tkoKing.ts` is pure and heavily tested. |
| King schedule / phases | **REAL** | `KING_SCHEDULE` in `src/lib/tkoKing.ts:214`. Self-running off the calendar, no organizer needed. Genuinely good design. |
| Stat check | **REAL** | `stat_check_submissions`. |
| Battle prize artifacts | **LOCAL-ONLY** | `grantAdvancementPrize` (`tkoKing.ts:998`) writes through `assets.grantAsset` → localStorage. **Win the whole tournament and your crown exists only in your own browser.** Clear a cache, switch devices, lose it. |
| Auto-stream battles to YouTube | **STUB** | `streams_to_youtube` is a flag only — `src/types/database.ts:286`, and `TkoKing.tsx:186` tells the user it's scaffolded. |

### Social

| Feature | Status | Evidence / caveat |
|---|---|---|
| Boards / servers | **REAL** | `servers`, `server_members`, `channels`, `messages` — all whitelisted. |
| **Chat spaces** | **BROKEN on real backend** | `Chat.tsx` / `ChatSpace.tsx` query `chat_spaces` + `chat_channels`. Neither is in `server/app.ts:27-44`. Returns `400 unknown table`. Works only against `mockSupabase`. |
| **Clans (join/roles/dues)** | **BROKEN on real backend** | `ClanDiscovery.tsx` queries `clan_members` — not whitelisted. Same failure. |
| Clan dues / treasury / 80-20 split | **LOCAL-ONLY** | `src/lib/clans.ts:287+` — explicitly labelled `SCAFFOLD`. Treasury and settlement ledger are localStorage. Each member sees *their own* imaginary treasury. |
| Realtime (live chat updates) | **STUB** | `channelStub` no-ops in both `realSupabase.ts:296` and `mockSupabase.ts:127`. No websockets. Chat requires manual refresh. |
| Notifications (in-app) | **REAL** | `src/lib/notifications.ts` → `notifications` table. Note: failures are swallowed with a `console.warn`, so a broken notify looks like success. |
| Push notifications | **MISSING** | No `@capacitor/push-notifications` dependency, no `google-services.json`. |

### Economy — almost entirely fake today

| Feature | Status | Evidence |
|---|---|---|
| Wallet / tokens / sweeps | **LOCAL-ONLY** | `src/lib/wallet.ts` — key `kc_wallet:<userId>`. Header: *"SCAFFOLDING ONLY… Nothing here moves real money."* |
| Artifacts / shop | **LOCAL-ONLY** | `src/lib/assets.ts` — keys `kc_assets`, `kc_assets_owned:<id>`. The "global catalog" is per-browser: **a cosmetic one user lists is invisible to everyone else.** |
| Oracle predictions | **LOCAL-ONLY** | `src/lib/predictions.ts` — key `kc_predictions:<userId>`. `Oracle.tsx:32` admits it. Resolution runs client-side per user (`predictions.ts:299`), so two users can grade the same tournament differently. |
| Winnings / prize ledger | **LOCAL-ONLY** | `src/lib/ledger.ts` — key `kc_ledger:<userId>`. Header: *"there is no backend table for settled predictions or shipped prizes."* |
| Broadcast theme | **LOCAL-ONLY** | `src/lib/broadcastTheme.ts` — cosmetic only, low risk. |
| Redeem codes | **REAL** | `server/app.ts:350-390` — server-side lookup, uses counter, duplicate-redemption guard. Solid. |
| Trial (7-day) | **REAL persistence, FAKE billing** | `src/lib/trial.ts` writes `reelone_tier` / `reelone_tier_expires` to `user_metadata` — real. But conversion charge is stubbed (below). |
| Entitlements | **REAL** | `src/lib/entitlements.ts` reads the metadata the trial/redeem/King grant paths write. Consistent. |

### Live / broadcast

| Feature | Status | Evidence |
|---|---|---|
| Go live / stream rows | **REAL** | `live_streams`, `live_groups`, `live_group_members` — whitelisted. |
| Watch page | **REAL** | `LiveWatch.tsx`. |
| Actual video ingest/transport | **MISSING** | This is a *placement/metadata* layer. There is no media server, no RTMP, no WebRTC. The app records that a stream exists and embeds YouTube. |

---

## B. The money path — what actually happens when a user taps Buy

> **RESOLVED (2026-07-22).** Everything in this section describes the state at
> the time of the audit and is kept for the record. The money path has since been
> implemented end to end: token packs are credited by the webhook through the
> trusted `moveWallet`/`wallet_ledger` path, Stripe events are de-duplicated via
> a `stripe_events` table, subscription lifecycle events extend/lapse the tier,
> the trial is a real Stripe-managed `trial_period_days` subscription, and every
> purchase button is gated on `GET /api/payments/config`. See **DEPLOY.md →
> Payments (Stripe)** for the runbook and `server/app.test.ts` for the tests.
> Item 7 of the must-have list in section E is done. Creator payout **Transfers**
> remain unimplemented.

**Short answer (at audit time): no user can spend real money on tokens today, and a subscription charge probably fails silently into a "coming soon" notice.**

### Subscribe (Upgrade page)
`src/pages/Upgrade.tsx:181-197` → `requestCheckout()` (`src/lib/payments.ts:41`) → `POST /api/checkout` (`server/app.ts:464`).

The Stripe integration here is **real code**, written as direct REST calls (`server/app.ts:75-95`) — Checkout Sessions, HMAC-verified webhooks (`app.ts:103-114`, `:493`), and Stripe Connect Express onboarding for creator payouts (`:530-567`). That's a legitimate implementation, not a facade.

**But:** every endpoint short-circuits with `503 stripe_not_configured` unless `STRIPE_SECRET_KEY` is set on the server (`app.ts:76, :465, :531, :557`). The UI catches that and shows *"Checkout opens when payments go live"* (`Upgrade.tsx:190`). Unless that secret is already set on Cloud Run — which nothing in this repo indicates — **tapping Subscribe today shows a polite notice and charges nothing.**

### Buy tokens (Store page)
`src/pages/Store.tsx:76-79`:
```
function purchasePack(pack: TokenPack) {
  addTokens(pack.tokens)
  addSweeps(pack.bonusSweeps)
  setFlash('Test purchase — real checkout opens when payments go live')
}
```
No network call at all. The button is literally labelled **"Buy (test)"** and the `$0.99–$19.99` prices are display-only (`Store.tsx:28` — *"display price only — no charge is made in this preview"*). It hands out free tokens into localStorage.

**Worse, if you *did* switch Stripe on:** `POST /api/checkout` accepts a `pack` and creates a real one-time payment session — but the webhook handler explicitly does **not** credit tokens (`server/app.ts:512-516`): *"token packs (mode=payment) are acked here and credited by a token ledger elsewhere once one exists."* There is no token ledger. **Turning Stripe on without fixing this means taking real money and delivering nothing.** This is the single most dangerous line in the codebase.

### Trial → paid conversion
`src/lib/payments.ts:89-95`:
```
export async function chargeTrialConversion(_input: { tier: string }): Promise<TrialChargeResult> {
  // TODO(stripe): real charge goes here ...
  return { ok: true, simulated: true }
}
```
It **always returns success**. `Upgrade.tsx:131` awaits it and then writes the paid-tier entitlement. So every trial with "card on file" converts to a **free paid tier, forever, on a card that was never collected**. The card-capture UI is also a stub (`Upgrade.tsx:239` — *"Real Stripe SetupIntent (Elements) goes here"*).

### Clan dues
`src/pages/ClanDiscovery.tsx:96-102` — debits the localStorage wallet, books an 80/20 split into a localStorage ledger. No money, no server. And the surrounding `clan_members` insert fails on the real backend anyway.

### Creator payouts
Stripe Connect onboarding is implemented and real (`app.ts:530`), but nothing ever creates a **Transfer**. Creators can onboard; they can never be paid.

---

## C. Backend reality check

**The web app on Cloud Run: correct.** `Dockerfile:8` hard-codes `ENV VITE_REAL_BACKEND=1`, so the container's bundle talks to the real Express + Postgres API, same-origin. `.env.local` is not copied into a clean build context in a way that overrides this. Good.

**The mobile app: a launch-blocker, two ways over.**

1. `_mobilebuild.bat:5` runs bare `node_modules\.bin\vite build` with **no env override**. Vite loads `.env.local`, which contains `VITE_MOCK_BACKEND=1` (`.env.local:8`). `src/lib/supabase.ts:20-29` then selects `mockSupabase`. **The APK on the phone is running entirely on an in-memory mock with placeholder Supabase creds.** Nothing a user does in it persists anywhere. (`build-real.bat` does it correctly — `VITE_REAL_BACKEND=1`, `VITE_MOCK_BACKEND=` — but the mobile script doesn't use it.)

2. Even after fixing #1, `src/lib/realSupabase.ts:23` sets `const API_BASE = '/api'` — a **relative** path. Capacitor serves the app from `https://localhost` (`capacitor.config.ts:8`, `androidScheme: 'https'`). So `/api/auth/login` resolves to `https://localhost/api/auth/login`, which does not exist. The mobile app needs an **absolute** API base (e.g. `VITE_API_BASE=https://tko.cam`) plus CORS — `cors()` is already permissive (`server/app.ts:118`), so that part is fine.

**Also verify before launch:** that `db/schema.sql` has actually been applied to the live Cloud SQL instance (the newer tables — `chat_*`, `clan_members`, `clip_records`, King tables — may or may not be there), and that `JWT_SECRET` and `APP_URL` are set as Cloud Run env vars.

### Security findings (these are the real blockers)

**C-1 — No row-level authorization. Critical.**
`server/app.ts:266-343`. The generic `/api/db` endpoint checks only (a) that the table is whitelisted, and (b) for writes, that *some* valid JWT is present. It never checks that the row belongs to the caller. Concretely, any user who signs up can:
- `update users set user_metadata='{"reelone_tier":"creator", "tko_host":true}'` — grant themselves the top tier and global host rights, free, forever.
- `delete from tournaments` / `tournament_registrations` — wipe the season.
- `update profiles` — edit anyone's profile.
- Insert battle results as any player.

**C-2 — Public reads of sensitive tables. Critical.**
Line 272: *"selects are public."* `users` is whitelisted (`:28`) and has `password_hash` (`db/schema.sql:28`). An unauthenticated `POST /api/db {table:"users",action:"select"}` returns every user's email and bcrypt hash. `redeem_codes` is also whitelisted (`:35`) — anyone can dump every valid code.

Neither of these is theoretical or hard to exploit; they're a single curl. RLS exists nowhere (`db/schema.sql` has 2 incidental matches for "policy", no real policies) because the app moved off Supabase's RLS and never replaced it.

---

## D. App-store readiness checklist

### Google Play

| Item | Status |
|---|---|
| Signed release build | **BLOCKER.** `android/app/build.gradle:19-24` has a `release` block with **no `signingConfigs` and no keystore anywhere in the repo.** `_mobilebuild.bat:11` builds `assembleDebug`. You cannot upload a debug/unsigned artifact. Need a keystore + `signingConfigs.release` + `bundleRelease` (Play requires an **.aab**, not an APK). |
| Target SDK | **BLOCKER.** `android/variables.gradle:4` — `targetSdkVersion = 34`. Play has required API 35 for new submissions since Aug 2025 and will likely require 36 by the time you submit. 34 will be rejected. Confirm the current floor in Play Console before bumping. |
| Version | `versionCode 1`, `versionName "1.0"` — fine for a first submission. |
| App icons | **Done.** All densities present under `android/app/src/main/res/mipmap-*`, plus adaptive-icon XML. |
| Splash screen | Present (`core-splashscreen` dependency, `AppTheme.NoActionBarLaunch`). |
| Permissions declared vs used | **Consistent.** `AndroidManifest.xml:34-42` declares INTERNET, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS with `uses-feature required="false"`. Camera/mic are genuinely used by `getUserMedia` in the WebView. You will have to justify camera/mic in the Data Safety form. |
| **In-app account deletion** | **BLOCKER.** Required by Play policy since 2024 for any app with account creation. `DataDeletion.tsx` is prose only; no button, no endpoint. Play also requires a **web-accessible** deletion URL — `/account/delete` exists (`App.tsx:84`), which covers half of it. |
| Privacy policy | Pages exist (`Privacy.tsx`, `Terms.tsx`, `Legal.tsx`) but are marked **draft, pending legal counsel** in-file. Need a stable public URL and real review. |
| Data Safety disclosure | **Not started.** Must declare: email, username, user content, camera/mic, and (once Stripe is on) payment info. |
| Content rating (IARC) | **Not started.** Note: user-generated content + chat pushes the rating up and triggers Play's UGC policy — you need moderation and a report/block mechanism, which I don't see. |
| Age gate 13+ | **Missing** (see A). Play's Families policy and your own Terms both need it. |
| Store listing assets | Not in repo — need feature graphic (1024×500), ≥2 phone screenshots, short + full description. |

### Apple App Store

| Item | Status |
|---|---|
| iOS project | **DOES NOT EXIST.** `Glob ios/**` returns nothing. No `@capacitor/ios` dependency in `package.json`. There is *no* iOS app to submit. |
| Mac requirement | Creating and archiving it requires macOS + Xcode. Memory notes you have a Mac — that unblocks it, but it's a from-scratch task (`npx cap add ios`), plus icons, splash, `Info.plist` usage strings for camera/mic (Apple **rejects** missing `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`), and a $99/yr developer account. |
| Account deletion | Same blocker, and Apple has enforced in-app deletion (Guideline 5.1.1(v)) longer and more strictly than Google. |
| Realistic assessment | iOS is not a "submit next week" item. **Ship Android first.** |

### IAP — the one that could sink the whole monetization model

This is worth taking seriously. **Tokens, cosmetic artifacts, and subscription tiers are digital goods consumed inside the app.** Both stores require their own billing for that — Apple Guideline 3.1.1, Google Play Payments policy — and take ~15-30%. **Stripe Checkout for these is a policy violation on both platforms** and a common rejection reason.

Practical options:
- **Web-only monetization.** Keep Stripe on tko.cam; the app ships with no purchase UI and no link to it. Legal on Google Play; on Apple this is the "reader-ish" grey zone and still risky. This is the fastest path.
- **Implement Google Play Billing / StoreKit** for tokens + subscriptions in the mobile builds, Stripe on web. Correct, but a substantial piece of work (weeks) and needs server-side receipt validation.
- Note the **US anti-steering carve-outs** (post-*Epic v. Apple*) now permit external purchase links in some cases with specific entitlements — worth checking current rules, but don't bet the launch on it.

Related legal exposure: `Store.tsx:224` disclaims *"No purchase necessary… no cash value"*, and there's a free daily sweeps grant — that's a sweepstakes structure. Combined with prediction mechanics, this needs actual counsel per-state before real money is involved. The prior pivot away from cash was the right instinct; keep it.

---

## E. Path to MVP — prioritized

### MUST-HAVE before opening tournament sign-ups to real users

Ordered. Sizes: S ≈ hours, M ≈ 1-3 days, L ≈ 1-2 weeks.

| # | Item | Size | Why it's a blocker |
|---|---|---|---|
| 1 | **Lock down `/api/db`.** Per-table read/write rules; owner checks on writes; never expose `users.password_hash` or `redeem_codes` to public selects. Simplest correct fix: drop `users` and `redeem_codes` from the whitelist entirely (they're only needed by dedicated auth/redeem routes) and add an ownership predicate to update/delete. | **M** | Without this, one motivated user rewrites the tournament. `server/app.ts:266-343` |
| 2 | **Set `JWT_SECRET` (and `APP_URL`) on Cloud Run** and fail startup if `JWT_SECRET` is missing rather than defaulting. | **S** | `server/app.ts:21` default = forgeable tokens. |
| 3 | **Whitelist the missing tables** — `chat_spaces`, `chat_channels`, `chat_messages`, `clan_members`, `clip_records` — and confirm `db/schema.sql` is applied to live Cloud SQL. | **S** | Chat + Clans are 100% broken on the real backend today. |
| 4 | **Fix the mobile build:** make `_mobilebuild.bat` use `build-real.bat`'s env, and change `realSupabase.ts:23` to an absolute `VITE_API_BASE`. Verify on a real device that sign-up hits Postgres. | **M** | The phone app currently persists nothing. |
| 5 | **In-app account deletion** — a Settings button → `DELETE /api/account` that hard-deletes the user + cascades, with confirmation. | **M** | Hard requirement for both stores; also a GDPR/CCPA obligation you already promise in `DataDeletion.tsx`. |
| 6 | **Move King prize artifacts + registration proof to Postgres.** At minimum, the crown and round artifacts must live in a real table, not `kc_assets_owned:`. | **M** | If someone wins your first season and their trophy vanishes with a cache clear, the season is worthless. |
| 7 | **Either turn Stripe fully on or fully off — no half state.** If on: credit token packs in the webhook (`server/app.ts:512`) and replace `chargeTrialConversion` (`payments.ts:89`). If off: hide/disable the Store's "Buy (test)" buttons and the trial's card-on-file step. | **S** (off) / **L** (on) | Today's half-state either charges nothing or, if the key is set, takes money and delivers nothing. |
| 8 | **Age gate (13+) at signup** + a report/block affordance for UGC. | **S** | Store policy + your own Terms. |
| 9 | **Release signing:** generate a keystore, add `signingConfigs.release`, bump `targetSdkVersion` to the current Play floor, produce a signed `.aab`. | **M** | Nothing is submittable without it. |
| 10 | **Finalize Privacy Policy / Terms** with counsel; complete Data Safety + IARC rating. | **M** | Submission gate. |
| 11 | **Decide the IAP strategy.** For MVP I'd recommend: no purchase UI in the mobile build, monetize on web only, revisit after v1. | **S** (decision) | Avoids the most common rejection. |
| 12 | **Get the YouTube OAuth consent screen verified** (out of testing mode). | **M** (mostly Google's clock — start early) | "Connect YouTube" is step (b) of the King entry gate; in testing mode it fails for everyone not on your allow-list. |

**Rough total: ~3-5 weeks of focused work** for a safe Android + web launch, assuming Google's OAuth verification runs in parallel.

### CAN SHIP AFTER MVP

- Realtime chat (replace `channelStub` with SSE or websockets) — refresh-to-update is survivable at launch scale.
- Server-side Oracle prediction resolution + a real `predictions` table.
- Real clan treasury / dues settlement in Postgres.
- Token ledger + creator payout Transfers via Stripe Connect.
- Winnings ledger backing table.
- Shared artifact marketplace (server-side catalog).
- Push notifications.
- YouTube auto-streaming of battles.
- Bundle-size work (`index-*.js` is 1.08 MB / 300 KB gzipped — fine for now, bad on mobile data).
- **iOS app.** Treat as a v2 project.

---

## Appendix — what's genuinely good

Worth saying plainly, because the list above is long:

- The pure-logic modules (`tkoKing.ts`, `clans.ts`, `tiers.ts`, `predictions.ts`, `trial.ts`, `entitlements.ts`, `identity.ts`, `chat.ts`) are cleanly separated from React and storage, and are properly unit-tested. 317 passing tests is real.
- The self-running King schedule (`KING_SCHEDULE` → phase → countdown → seeded row) is genuinely elegant — no organizer, no cron, the whole product moves when you edit four constants.
- Every scaffold is **honestly labelled in-file**. Nothing was hidden; the code told the truth about itself everywhere I looked, which is why this audit was possible in one pass.
- The Stripe server implementation is real and correct as far as it goes.
- The `/api` shim design (one interface, three backends) is a good call and makes the mock-vs-real fix mechanical rather than architectural.

The gap here is not code quality. It is that **the front end got substantially ahead of the backend**, and the seam between them — authorization, and which features actually have tables behind them — is where the risk is concentrated.
