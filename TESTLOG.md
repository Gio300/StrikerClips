# KillCam — End-to-End Test Log

Tracks real new-user (A→Z) runs driving the actual UI in a browser, not just unit tests.
Local setup: dev server `127.0.0.1:5899` with `VITE_MOCK_BACKEND=1` (in-memory auth/data —
lets us traverse signed-in flows without Docker/cloud). Unit suite: `npm test`.

Legend: ✅ pass · 🔧 bug found + fixed · ❌ broken (open) · ⏳ not yet tested

## Run 1 — new free user, core journey (2026-07-18)

| # | Flow | Result | Notes |
|---|------|--------|-------|
| 1 | Landing renders (signed out) | ✅ | "Get Started" CTA, sidebar shows Sign in |
| 2 | Signup form fill + submit | ✅ | shows email-confirm message ("Back to sign in") — real Supabase needs email confirm |
| 3 | Session persists across reload | 🔧 | mock session was in-memory → lost on reload; fixed with localStorage persistence |
| 4 | Login (email+password) | ✅ | lands on signed-in Home ("Create a reel", "Live Now", Profile nav) |
| 5 | Protected route /dashboard | ✅ | Creator Dashboard renders, empty-state stats (0/0/0/$0) |
| 6 | Redeem a pass | ✅ | "Redeemed! You're Pro through <date>" — grant + expiry shown |
| 7 | In-app Browser page | ✅ | (run 0) shortcut tiles + clip helper render, responsive |
| 8 | Voice command (nav + director) | ✅ | (run 0) "open browser" navigated; "focus screen 2" fired director; Live reacted |
| 9 | Category tabs in create flow | ⏳ | render OK; detection needs a real uploaded clip to exercise |
| 10 | Tier gating as FREE user | ⏳ | verify Pro-only voice/director/create is blocked when not premium |
| 11 | Create a reel (YouTube clip) end-to-end | ⏳ | add clip → save → reel detail |
| 12 | Clip search ("his last 10 kills") UI | ⏳ | lib tested; UI not wired yet |
| 13 | Live-stream slots UI (go live / schedule) | ⏳ | lib tested; UI not wired yet |
| 14 | Browser 2-way clip/screenshot share | ⏳ | not built |
| 15 | Mobile (Capacitor) — same journey on emulator | ⏳ | app installs + runs; re-run this journey natively |

**Run 1 summary:** core new-user path (signup → login → persist → dashboard → redeem) works;
1 real bug found + fixed (session persistence). Remaining rows are the next build↔test targets.

## Automated tests (npm test) — 27 passing
- Frontend libs: voiceCommands (parser), tiers (gating), clipSearch (query+rank+link), streamSlots (slots/schedule).
- **Backend API (`server/app.test.ts`, 9 tests, runs on in-memory Postgres = pg-mem):** health, weak-signup rejected, signup, duplicate-email blocked (409), login, wrong-password (401), /auth/me authed + 401 unauth, clip create (auth-gated) + list, clip search by player+category ("his last kills"). This is the Supabase-replacement API driven like a user.

## Backend (Supabase replacement) — status
- `db/schema.sql` — plain Postgres, 41 tables (validated with libpg_query). Apply: `psql -f db/schema.sql`.
- `server/app.ts` — Express + `pg`: auth (bcrypt+JWT signup/login/me), profiles, clips (create/list/**search**). Prod entry `server/index.ts` (`npm run server`, needs `DATABASE_URL`). Same `pg` interface → real Postgres in prod, pg-mem in tests.
- TO DO: expand API to all resources (reels, servers/channels/messages, matches, live, rankings, tournaments, redeem, stream-slots) + realtime (chat) + uploads; then swap frontend off supabase-js onto this API; deploy + connect real Postgres.

## Known / to-do
- Repo brand still "ReelOne"; rebrand to KillCam pending.
- Real backend (Supabase creds) needed to test RLS, edge functions, real data + email confirm.
- Re-run this whole journey on the Android build (emulator) once flows stabilize.
