# Account / Power-Level Troubleshooting (app vs web)

Written 2026-07-27 after "my profile is gone after reinstalling the app." Keep this
so we can fix it fast if it recurs. THREE separate things can make the app show a
wrong/empty profile. They're independent — check them in order.

## TL;DR
- **Data is almost never lost.** Profiles + power live in Cloud SQL Postgres. The
  web reads it correctly whenever the app looks broken, which proves the DB is fine.
- Power is stored on `profiles.power_level` and can also be recomputed from
  `clip_records` (see `recomputePower` in `server/app.ts`).

## Bug 1 — "Real" APK build silently compiled as MOCK (ROOT CAUSE, FIXED 2026-07-27)
**Symptom:** installed app shows your email as the name + Power 0 / Unranked, no
matter how many times you reinstall or sign in. Web is perfect. The app's stored
session (WebView localStorage) reads `"id":"mock-user-1","access_token":"mock"` —
proof it never talked to the real server; the mock just echoes back whatever email
you type at the login screen, with empty in-memory data.
**Root cause (subtle):** the backend selector in `src/lib/supabase.ts` checks MOCK
first: `useMockBackend = String(import.meta.env.VITE_MOCK_BACKEND).trim() === '1'`
— if true it uses the mock and ignores `VITE_REAL_BACKEND` entirely. `.env.local`
contains `VITE_MOCK_BACKEND=1` (for local UI testing). `_mobilebuild_real.bat` tried
to clear it with `set "VITE_MOCK_BACKEND="` — BUT in Windows `cmd`, `set "VAR="`
*deletes* the variable instead of setting it to empty. So it wasn't in `process.env`
at all, Vite fell back to `.env.local`'s `VITE_MOCK_BACKEND=1`, and every "real"
build was actually the mock app. Verified deterministically with
`node -e "const {loadEnv}=require('vite'); ...loadEnv('production',cwd,'VITE_')"`
which returned `VITE_MOCK_BACKEND="1"`.
**Fix:** in `_mobilebuild_real.bat` set it to a defined non-1 value:
`set "VITE_MOCK_BACKEND=0"` (a defined process.env value wins over `.env.local`).
Re-verify with the loadEnv one-liner (must print `"0"` → backend REAL). Then:
`_mobilebuild_real.bat https://tko.cam`  ->  `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`  ->  `adb shell pm clear app.killcam` (wipes stale mock session)  ->  `gcloud storage cp app-debug.apk gs://reelone-498406-downloads/TKO-latest.apk` (so tko.cam serves the fixed one). After that, sign in normally and the real 5,200 profile loads.
**Fast confirmation the installed app is mock:** pull the session with
`adb exec-out "run-as app.killcam sh -c 'cat app_webview/Default/Local?Storage/leveldb/*.log'"`
and look for `access_token`: `"mock"` = mock build; a `eyJ...` JWT = real build.

## Bug 2 — Power recompute ZEROED accounts with no player records (FIXED)
**Symptom:** an account's power_level gets overwritten to 0 on every login.
**Cause:** `recomputePower` computed power from the user's `clip_records`
(wins/losses/produced). A founder / non-player account has no such records, so it
computed 0 and **unconditionally wrote 0 over the stored value.**
**Fix (in `server/app.ts recomputePower`):** if there is NOTHING to compute from
(no clip_records and no oracle points), leave the stored `power_level` untouched
and just return it. Only recompute for accounts with real activity. NEEDS A DEPLOY
to take effect on the live server.

## Bug 3 — App shows email + 0 while web shows the real profile (ACCOUNT/SESSION)
**Symptom:** app profile header shows your **email** as the name (e.g.
"awakengiovanni3000") and **Power 0 / Unranked**, while the web shows your real
username + power.
**What it means:** the app is signed into an account whose `profiles` row is empty
/ missing, so the header falls back to the email and power reads 0. The profile-
FETCH code (`AuthContext.fetchProfile` -> `/api/db profiles`) is the same on app and
web, so this is **not** a code regression — it's a **which-account-are-you-signed-
into** problem.
**How to confirm:** query the DB by username (service key + `TKO_API_BASE`):
POST `/api/db` `{table:"profiles",action:"select",columns:"id,username,power_level",filters:[{col:"username",op:"eq",val:"<name>"}]}`.
On 2026-07-27 the real account was **username `PatternAfterError`, power 5,200**
(intact). There was **no `awakengiovanni3000` profile** — that string was just the
email shown as a fallback. So the app was signed into a *different* login than the
one holding the 5,200 profile.
**Fix:** sign the app into the SAME account the web uses (the email that owns the
real profile). If a duplicate empty account got created on reinstall, don't use it.
If both web and app are truly the same email yet still differ, then it's a mobile
runtime issue (CORS/API reachability) — check `server/app.ts` `cors()` allow-lists
`https://localhost` + `capacitor://localhost`, and that `/api/db` succeeds from the
mobile origin.

## Quick diagnostic checklist
1. Web shows the real power? -> data is safe; it's the app (Bug 1 or 3).
2. App can't reach anything at all? -> Bug 1 (wrong APK build).
3. App reaches the server (shows you as logged in) but profile is empty? -> Bug 3
   (compare the account email on web vs app — likely two different logins).
4. Power drops to 0 for a founder/non-player on login? -> Bug 2 (deploy the recompute fix).
