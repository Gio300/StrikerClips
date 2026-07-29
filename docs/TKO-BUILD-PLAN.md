# TKO build plan — source of truth (2026-07-23)

Guiding principle (user, explicit): **the system runs itself.** Matching,
rendering, posting to YouTube, posting to Facebook, ad serving — all unattended,
"whether you oversee it or not." Build for autonomy, not manual one-offs.

## 1. Auto-match → auto-post (the core loop)
- A member with a **paid plan** who **connects YouTube** → their uploads start
  getting matched automatically.
- **Matched (≥2 angles of one match)** → auto-assembled + auto-posted to the TKO
  stream/YouTube.
- **Solo / unmatched clip** → do NOT post to the stream unless the user
  explicitly posts/uploads it themselves.
- **Free users** may upload, but must watch ads to do so (see §6).
- Output quality must match the hand-built AI-squad video: full pipeline
  (clock-align, intro, K.O. replays) **+ ElevenLabs commentary VO on kills and
  big moments** — "urban" caster voices, e.g. "he got him." (Not silent grids.)

## 2. Default view = DIRECTOR CUT (not static 4-up)
- Default is **auto-switching camera angles to the action**, always — the AI
  cuts to the right perspective. A constant 2×2 4-up grid is only shown if a
  viewer explicitly switches to it.
- **Live:** run a short delay so the AI can switch to the right part of the
  action before it reaches the viewer.

## 3. Versioning + labeling (user-pickable)
Every match is produced/labelled as selectable variants; the viewer picks:
- **with host / without host** (commentary)
- **with chat / without chat** (overlay)
Bake these into the video naming + the player's version picker.

## 4. Host-existing-matches (commentary lane)
- The platform lets a host narrate matches that **already happened** OR a **live**
  stream.
- Entry point + flow needed: where the host goes in, and how they talk over it —
  **connect OBS**, or **use our system with their phone camera/mic**.
- Feeds the "with host" version (§3).

## 5. Stat tracking / integrity (develop over time; not real-time required)
- AI stat check — DONE.
- Track in-game **timing for ults/jutsus** and boosts.
- Eventually: flag whether a user's boosts/timing are **consistent** (anti-cheat
  / anomaly detection). Batch is fine; doesn't need to be live.

## 6. Ads — AdMob
- Provider: **AdMob**. Use whatever ad setup is easiest to manage.
- **Paid users see NO ads. Unpaid users see ads.** Free users watch ads to
  upload.
- Gating by tier is ours to build; needs the user's AdMob **app ID + ad unit
  IDs** (manual: create the AdMob app + units).

## 7. YouTube monetization
- Turn on channel monetization. Mostly manual/eligibility (YouTube Partner
  Program thresholds). Surface the exact manual steps to the user; they prefer
  to avoid manual steps where possible.

## 8. Facebook auto-poster (thisbot)
- The thisbotdoesmysocialmedia / Swoosh system: **take videos and auto-post to
  Facebook**, self-running.

## 9. Pricing / trials (already partly built)
- **Every signup:** free **week** of Basic, **card on file**, then auto-charge
  (Stripe 7-day trial — built).
- **Competitors** (tournament players): free **month** of Basic.

## 10. App stores — LAST, after the above
- Play Store (creds in hand).
- iOS via **Codemagic** (repo → build → submit on App Store) — no Mac needed.

## Founder host codes (current)
TKO-HOST-K9F3QX, TKO-HOST-M4R7PZ, TKO-HOST-B2X8LT, TKO-HOST-3P9K2J, TKO-HOST-7X4M8Q
(hardcoded in server/app.ts + src/lib/tkoKing.ts + src/lib/mockSupabase.ts).
