# Codex prompt — integrate the new TKO.cam UI/flow + make TKO.cam the app

Paste the block below to Codex.

---

**Task: Turn TKO.cam into the app itself, move the marketing page to `/marketing`, and integrate our new UI/flow prototype as the primary app experience.**

Repo: `StrikerClips` (this repo). Stack: Vite + React + TypeScript app in `src/`, Node/Express/TS API in `server/app.ts`, deployed to Cloud Run service `killcam` (project reelone-498406) serving `dist` + `/api`, backed by Cloud SQL Postgres. Mobile is Capacitor (`appId app.killcam`, built with `_mobilebuild_real.bat`).

**The prototype (new UI + flow):** https://tko-cam-flow-prototype.kissatronix.chatgpt.site (built by kissatronix; sign in with the same ChatGPT account that made it). Treat it as the target UX + navigation flow — screens and the flow chart. Adapt its components/flow into our real app; do not rebuild our backend.

**Goals**
1. **TKO.cam becomes the app.** Today the root is effectively a marketing/download gate. Make the root (`/`) the actual app experience using the new prototype's UI/flow, so a signed-in (or guest) user lands in the product, not a download page.
2. **Move marketing to `/marketing`.** Everything currently on the marketing/download page (`src/pages/Marketing.tsx`, currently also served at `/download`) must live at `/marketing` (and keep `/download` working as an alias/redirect). The marketing page keeps the app-store/APK download CTAs.
3. **Integrate the new UI/flow** as the navigation model for the existing sections (video/reels/watch scroll, matches, tournaments, king, live, clans, chat, store, profile, creator). Follow the prototype's "pick intent → guided config" flow (the same simple-buttons-then-configure pattern we use in Live) across sections. See `docs/TKO_APP_ANALYSIS.md`.

**Hard constraints (do NOT break these)**
- Production uses the REAL Express `/api` backend via the `realSupabase.ts` shim (`VITE_REAL_BACKEND=1` + `VITE_API_BASE`). It is NOT hosted Supabase. Keep this. Don't wire hosted Supabase.
- Preserve all existing features + routes (auth, power level, tournaments/King, reels/videos, live, store, Ask TKO, etc.). Ask TKO is now page-aware via `clientContext.path` — keep passing the current route.
- Don't touch the video pipeline repo (`killcam_clips`).
- The Android APK must still build with `_mobilebuild_real.bat` (NOT `_mobilebuild.bat`, which ships the mock backend). Capacitor serves from `https://localhost`, so `VITE_API_BASE` must stay an absolute origin.
- Keep the app same-origin (Cloud Run serves `dist` + `/api`).

**Approach (suggested)**
1. Reparent routes in `src/App.tsx`: marketing → `/marketing` (+ `/download` redirect); root `/` → the new app shell/flow.
2. Build the new app shell/nav from the prototype; route the existing pages/components into it (reuse, don't rewrite backend calls).
3. Guard/entry flow: decide guest vs signed-in landing per the prototype.
4. Verify: web build, all existing routes reachable, `/marketing` intact, APK build via `_mobilebuild_real.bat`, Ask TKO still gets the path, no hosted-Supabase wiring.

**Safety:** a full restore point exists at `Desktop\TKO_backups\` (StrikerClips git bundle + working-code zip + commit hash) with `HOW_TO_RESTORE.txt`, plus a nightly `TKO_DailyBackup` task at 3:30 AM. If anything breaks, restore from there.

Start by studying the prototype's screens + flow, then propose the route/shell restructure before large edits.

---
