# KillCam Build Plan — Backend, Payments, Sweepstakes/Betting

How the money + real-multiuser systems get built, in order, and what each needs.

## Where things stand (confirmed 2026-07-20)

The backend infrastructure is **already provisioned** — this was the big unknown, now cleared:
- **Database:** Cloud SQL `reelone-db` (Postgres 15, running).
- **Secrets in place:** DB password, JWT secret, YouTube client/secret/refresh token, Supabase service-role key.
- **Cloud Run env already wired:** DB connection, user, name, JWT — all set.
- **The server code is built and solid** (`server/app.ts` / `server/index.ts`): own JWT+bcrypt auth, a generic data API, the redeem-code function, storage shim.

**The one blocker:** the live `killcam` database has an older `users` table created before the `user_metadata` column existed. The schema file (`db/schema.sql`) is idempotent, so reconciliation is small.

## Milestone 1 — Turn on the real backend (unlocks everything)

1. **Reconcile the schema** on the live DB: run `db/schema.sql` (creates any missing tables, harmless to existing ones) + targeted `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_metadata jsonb DEFAULT '{}';` and any other drifted columns.
2. **Deploy `Dockerfile.server`** as a **no-traffic** revision (the live mock site keeps serving). Smoke-test its URL: `/health`, sign up, create a reel, chat.
3. **Cut traffic** to it only after it passes. Rollback is one command if anything's off.

Result: real accounts, cross-device chat, other people's streams/clips, notifications, DMs — all the "needs backend" items from the audit go live. **This is the gate for every money feature.**

## Milestone 2 — Memberships (web checkout)

- Create the KillCam products/prices on Stripe: **Free / Ad-Free $1.99 / Pro $4.99 / Elite $9.99 / Legend $29.99/mo** — added to the existing account **additively** (tagged for KillCam, never touching Swoosh's objects).
- Backend: a `/api/checkout` (Stripe Checkout Session) + a Stripe **webhook** that writes the tier onto the user's account. The `/upgrade` page (already built) swaps its stub for the real checkout call.
- Uses the existing live key from Secret Manager — no new key needed.

## Milestone 3 — Creator payouts (Stripe Connect, 80/20)

- Enable **Stripe Connect** on the account (you're flipping this on).
- Each creator does a one-time Connect onboarding (identity + bank — legally required).
- Charges use **destination charges with an application fee**: one payment, Stripe auto-routes **80% to the creator's connected account** and **20% to us**. Creators can **Instant Payout** to a debit card (~1.5% fee) or take the free ~2-day payout.
- Powers: paid live guests, channel subs, paid clans, paid chats, paid tournament entry, tournament prize payouts.

## Milestone 4 — The store + sweepstakes/prediction system (the "legal betting")

Your researched model is the right one — the **dual-currency sweepstakes / prediction-market** structure (how Fliff, NoVig operate without a casino license):

- **Tokens** — a utility currency you *buy* (premium match entry, customization, features). **Never cashable.**
- **Sweeps Points** — *free* promotional points granted with token purchases (and other promos). Used to predict outcomes; winning points may be **redeemed for prizes where legal**.
- The **Store + wallet** are already scaffolded (`/store`, `/upgrade`, wallet chip). Next: real token purchase via Stripe, then the prediction UI (pick tournament outcomes with sweeps points), then a gated prize-redemption flow.

**Legal must-dos before this goes live (not optional):**
- A gaming / interactive-entertainment attorney reviews the **Terms of Service + entity structure** (your own research says this — it's right).
- **"No purchase necessary"** free-entry path must always exist (that's what keeps it a sweepstakes, not gambling).
- **Geofencing** — exclude states that prohibit the model (e.g. WA and a few others; the list shifts, counsel confirms).
- **Age verification (18+/21+)** and **KYC/AML** on redemptions; **1099** tax forms on payouts.
- Tokens must have **no cash value** and never be redeemable for money — only sweeps points redeem for prizes.

*Note: this is general product/architecture information, not legal advice — I'm not a lawyer. The compliance sign-off has to come from licensed counsel before you take real wagers.*

## Milestone 5 — Ads + YouTube auto-upload

- Ads: wire **AdSense (web)** / **AdMob (Android)**; the free-user ad gate UI exists. Approval needs real traffic — turn on once daily users hit the low thousands.
- YouTube auto-upload: the uploader (`scripts/youtube-uploader.ts`) is built; stand up a small always-on worker with the channel's refresh token (already in Secret Manager) to drain the upload queue.

## Sequence
Backend (M1) → Memberships (M2) → Connect payouts (M3) → Store + predictions w/ legal sign-off (M4) → Ads + auto-upload (M5).
