# TKO — Handoff for Codex (2026-07-27)

Context: worked a long session on two tracks — the **video pipeline** (repo
`killcam_clips`, on the PC) and the **app/site** (repo `StrikerClips`,
Cloud Run service `killcam`, project reelone-498406). Below is exactly what's done,
what's blocked, and what to pick up. Two repos are involved; note which is which.

## THE #1 BLOCKER: videos don't show in the app (needs a deploy + maybe an app-read fix)
- Root cause found: the app's `recentProducedVideos` reads **`match_versions` FIRST**
  and only falls back to `clip_records` if match_versions is empty. match_versions'
  newest row is 2026-07-26, so today's produced videos never surface.
- The server DOES write match_versions in `/api/internal/credit-produced` — but ONLY
  `if (matchKey)` is in the request (server/app.ts ~line 5858). The **pipeline was
  omitting match_key**; I fixed the pipeline to send it (`tko_auto_render.credit_produced`
  now sends `match_key = match slug`). BUT after a fresh produce the row still didn't
  appear — meaning the **deployed** server predates the match_versions-write code (it's
  in the uncommitted StrikerClips changes).
- **ACTION for Codex:** (1) deploy the server so credit-produced actually writes
  match_versions; (2) verify a produced vertical's row lands; (3) STRONGLY consider
  making `recentProducedVideos` MERGE match_versions + clip_records by recency instead
  of returning early on match_versions — so a stale table can never hide new videos.
- Direct `/api/db insert` on match_versions returns 401 (service key is read-only for
  writes), so the pipeline can't backfill it — it has to be the server.

## App changes I made in StrikerClips (code-ready, NEED DEPLOY)
- `server/app.ts` `recomputePower`: guard so an account with NO clip_records + 0 oracle
  points is NOT zeroed (returns stored power). (Fixes founder/no-player wipes.)
- `server/app.ts` Ask TKO (`name === 'ask'`): now **page-aware** — it reads the
  `clientContext.path` the client already sends (CommandBar.tsx line ~171) and adds it
  to the model context. The server had been ignoring it. No frontend change needed.
- `server/app.ts` `TKO_SYSTEM` prompt: added **matching/timezone troubleshooting** so
  Ask TKO tells players whose clips aren't matching to fix their capture device's
  date/time/timezone. (Real case: player "Hammy" — see below.)
- Earlier this session (already in tree): `ReelScrollFeed.tsx` + `Videos.tsx` (TikTok
  vertical scroll), `Profile.tsx` stats tab.
- Docs added: `docs/ACCOUNT_POWER_TROUBLESHOOTING.md`, `docs/TKO_APP_ANALYSIS.md`,
  this file.

## Hammy (player not appearing in produced videos)
- Cause: his clips are timestamped ~19–20h off (device clock/format wrong — he had the
  right timezone but 24h format on a PS4; underlying issue is the recording time is off).
  The matcher groups players by recording time, so he never clustered with his squad.
- Two fixes: (a) **he fixes his device clock** → aligns automatically (best); (b) the
  **audio-anchor** I built in `killcam_clips/tko_crossmatch.py` (`_audio_anchor_missing_players`)
  matches him by game AUDIO + intro/outro SCREENS, learns his constant offset, and
  re-places all his clips. It's wired but only takes effect on a full discovery re-scan
  that regenerates `confirmed_matches.json` — that slow scan hasn't completed yet.
- **ACTION:** run `python -c "import tko_crossmatch as xm; xm.main(on_match=None)"` (slow;
  regenerates confirmed_matches.json with the anchor) and confirm a `gt` (Hammy) angle
  lands in a match. Optional fingerprint corroboration is behind `TKO_FINGERPRINT=1`
  (audalign installed) + `TKO_AUDIO_ANCHOR=1` (default on).

## Video pipeline state (killcam_clips) — WORKING, improved a lot this session
The producer makes TWO shapes per match, hourly (task `TKO_Autopilot`) or on demand
(`tko_make_now.bat`), and posts each to its place:
- **Vertical 1080x1920** → app scroll + YouTube Short + Facebook STORY
- **Horizontal 1920x1080** → YouTube post + Facebook FEED (now a dynamic "football-replay"
  cut, NOT the old static grid)
Improvements now live in the pipeline:
- Every channel decoupled + fail-soft (a YouTube cap can't block FB/app anymore).
- FB feed uploader is now RESUMABLE (`tko_social.cmd_postfb`) — 100MB+ grids stopped 413ing.
- Combat gate (motion) + **VL semantic gate** (`TKO_VL_GATE=1`, qwen2.5vl:7b) + motion-snap
  → cuts land on real fighting, not respawn arrows / tutorial tips / loading screens.
- Mild-zoom vertical framing (crop ~72% width — was too far out, before that too close).
- Pacing arc (fast hook, longer power holds) + **slow-mo KO finale**.
- Mood-aligned + rotating music (`tko_highlight` HYPE vs CHILL buckets, LRU ledger).
- Shuffled on-screen terms + shuffled VO (no more "BIG PLAY/KNOCKOUT/CLUTCH" every time).
- Voice recast to **CoachDee** (urban) — was the "advertisement" Alexander voice.
- Action-ranked + no-repeat selection (`tko_make_now`, local ledger `make_now_produced.json`).
- Unique per-match YouTube titles.
KNOWN REMAINING (video): event banners ("Your team stole a base!", "got a scroll!") still
appear — they're ON real action moments (base/flag steals the operator WANTS), so they're
narration, not junk. Option: mask/crop the top banner band if desired.

## Biggest app build to pick up next (analyzed, NOT built)
See `docs/TKO_APP_ANALYSIS.md` for the full map. The operator's direction: make every
section follow the **Live pattern — simple buttons to target intent, then guided config**
(no UI restyle). Priorities:
1. **Tournament creation flow**: pick TYPE (1v1 ladder / 4v4 clan / King / open / invitational)
   → configure (size/seeding, LIVE vs play-and-upload, single/double elim, venue, **rules
   free-text**) → confirm. Store rules on the tournament.
2. **Auto-seed the bracket** on create (verify create → round-1 `tournament_battles` exist).
3. **KO detection + scorer credit**: reuse the pipeline's gold-"K.O." banner detection +
   `tko_roster` OCR to AUTO-SUGGEST a battle winner (sets `battle.winner`, closing the
   manual result gap) and COUNT KOs + who scored them as a new profile/leaderboard stat.
4. **Live bracket overlay that ANIMATES** as results land (a stream scene fed by
   `tournament_battles`). 5. **Multi-host commentary** on a battle (like Live guest casters).
6. **Feed tournament rules to Ask TKO** so players can ask about a specific tournament
   (the page-context plumbing is already in — just include the tournament's rules when the
   path is /tournaments/:id).

Tournament system today (verified): real brackets exist — `tournament_battles` (round,
players, winner, status); server derives bracket depth from entrant count; winning a battle
grants a round-scaled **advancement artifact** + trophy/ledger; Final = King
(`king-prize` handler). The gap is purely: winner is entered MANUALLY by the host, no
auto-detection, and no animated bracket view.

## Deploy note
Cloud Run service `killcam` (project reelone-498406). Server + app changes above need a
deploy to take effect. Web currently runs an older good build; the APK must be built with
`_mobilebuild_real.bat` (NOT `_mobilebuild.bat`, which silently ships the mock backend —
see ACCOUNT_POWER_TROUBLESHOOTING.md).
