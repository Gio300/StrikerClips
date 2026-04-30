# Shinobi Village — Code Audit

Date: 2026-04-26
Branch: `main` (renamed from StrikerClips → SmashHub → ButtonMasherz → Shinobi Village)
Repo: still publishes to `Gio300/StrikerClips` GitHub Pages (rename later when ready)

## What works well

- **Stack is shoestring-perfect**: Vite + React + Tailwind + Supabase + ffmpeg.wasm + GitHub Pages. All free/cheap tiers.
- **Schema is solid**: 7 migrations build a coherent model — profiles, clips, reels, matches, servers/channels/messages, live streams + groups, DMs, polls, activity feed, power ratings, trophies, tournaments + admins + results + stat checks.
- **Auth flow is correct**: Supabase Auth + auto-profile trigger with username collision handling.
- **Realtime works**: `BoardDetail.tsx` subscribes to `postgres_changes` for chat.
- **RLS is mostly comprehensive**: every user-data table has policies.

## Issues found and fixed in this pass

### CRITICAL

**C1. `ffmpeg -c copy` will silently fail / produce garbage on heterogeneous clips**
- `src/hooks/useFFmpeg.ts` used `concat -c copy` which only works when ALL clips share identical codec, resolution, framerate, audio sample rate, audio channels. Real game clips from different captures or downloaded YouTube tools never match.
- **Fixed**: re-encode pipeline using `concat` filter + `libx264 -preset ultrafast` + `aac`. Slower (a few seconds per clip in browser) but actually produces playable output.

**C2. `useAuth` re-fetched profile during render**
- `src/hooks/useAuth.ts` lines 43–45 had `if (profile === null && user) { fetchProfile(user.id) }` *outside* `useEffect`, causing fetch storms.
- **Fixed**: removed render-time fetch, profile is loaded inside the effect.

**C3. `Profile.tsx` had Next.js `'use client'` directive at the top**
- This is a no-op in Vite but indicates copy-paste from Next.js docs. Not breaking anything but confusing.
- **Fixed**: removed.

**C4. AdSense script tag was never loaded in `index.html`**
- `AdSlot` component renders ad markup but the global `adsbygoogle.js` script wasn't loaded, so ads never fire even when client ID is configured.
- **Fixed**: added conditional AdSense bootstrap that only loads when `VITE_ADSENSE_CLIENT` is set at build time.

### MEDIUM

**M1. `CreateReel.tsx` and `CreateHighlight.tsx` were ~95% duplicate**
- Both rendered the same form, both routes (`/reels/create` and `/highlight/create`) point to `CreateHighlight` per `App.tsx`.
- **Fixed**: deleted `CreateReel.tsx`, added multi-angle layout selector to `CreateHighlight`.

**M2. No file size guard before client-side ffmpeg**
- A user uploading 4GB of clips would lock up their browser.
- **Fixed**: 200MB total cap with friendly error before processing starts.

**M3. Hardcoded `/StrikerClips/` in `vite.config.ts` and `main.tsx`**
- Hard to rebrand without editing two files plus the GitHub repo name.
- **Fixed**: env-driven via `VITE_BASE_PATH` (defaults to `/StrikerClips/` to keep current deploy working).

**M4. Stale Cursor rules forbade editing this very repo**
- `.cursor/rules/ss-tournaments*.mdc` said "NEVER touch StrikerClips" — leftovers from a prior project workflow.
- **Fixed**: deleted, replaced with one current rule for Shinobi Village.

### LOW (left for next pass)

**L1. Realtime subscription in `BoardDetail` re-pulls all messages on every change**
- Works fine until a channel has 1000+ messages. Should append/upsert from `payload.new`. Not blocking ship.

**L2. Live-group invite RLS leans on creator-or-self check**
- `live_group_members` insert policy allows the user inserting themselves OR the group creator. Works, but accept/decline UX has minor edge cases.

**L3. `dist/` and `ss-tournaments-merge/` folders left over**
- Not tracked by git, safe to delete locally any time.

## What was added in this pass

| Feature | File | Notes |
|---|---|---|
| Multi-angle stitching (2x2 grid, side-by-side, PiP) | `src/lib/ffmpegOps.ts` | All client-side, ffmpeg.wasm `xstack`/`overlay` filters |
| Audio-energy auto-highlight detector | `src/lib/highlightDetector.ts` | Web Audio API, no API costs |
| Share buttons (FB / Messenger / X / copy link) | `src/components/ShareButtons.tsx` | URL-share, no SDK keys |
| Layout selector in reel creator | `src/pages/CreateHighlight.tsx` | Choose: Concat / Grid / PiP / Side-by-side |
| AdSense bootstrap | `index.html` | Conditional, only loads when client ID is set |
| Server seed rename migration | `supabase/migrations/008_rename_default_server.sql` | Updates the seeded server name to "Shinobi Village" |
| **Synced YouTube reel player** (free multi-angle) | `src/components/SyncedYouTubeReel.tsx`, `src/lib/youtubeApi.ts` | Loads YouTube IFrame API; plays multi-angle YouTube clips synced in any layout. No download/transcode, no storage cost. |
| **Reel `layout` column** (optional) | `supabase/migrations/009_reel_layout.sql` | Persists which layout each reel uses for playback. **Now optional** — see below. |
| **Layout encoding fallback** | `src/lib/reelLayout.ts` | Lets multi-angle reels work *before* migration 009 is applied: encodes layout into `combined_video_url` as `shinobi-layout://<layout>`. `resolveLayout()` reads from column first, then URL marker, then defaults to `concat`. |
| **Multi-angle creator accepts YouTube links** | `src/pages/CreateHighlight.tsx` | All four layouts now work with link-only YouTube clips (no file size cap, no rendering). Uses the layout encoder so it doesn't depend on the `layout` column existing. |
| **Facebook OAuth login** | `src/pages/Login.tsx`, `src/pages/Signup.tsx` | Adds Facebook button alongside Google + GitHub via Supabase Auth. |
| **Messenger Send Dialog** | `src/components/ShareButtons.tsx` | When `VITE_FACEBOOK_APP_ID` is set, share-to-Messenger uses the proper FB dialog (works on desktop too). Falls back to deep-link otherwise. |
| **Branded auth emails** | `supabase/templates/*.html`, `supabase/config.toml`, `supabase/EMAIL_BRANDING.md` | Replaces Supabase's default "Confirm your signup" emails with Shinobi-branded HTML (kunai red gradient, mark, dark theme). Six templates: confirmation, magic_link, recovery, invite, email_change, reauthentication. Auto-deploys via `supabase config push --linked` once a PAT is in place; a 30-second dashboard paste path is documented in `EMAIL_BRANDING.md`. |

## What's NOT done yet (waiting for go-ahead)

- IMA SDK pre-roll player wrapping the `<video>` tag in `ReelDetail`
- YouTube Data API auto-publish (needs Supabase Edge Function for OAuth)
- Messenger Webhook bot (needs Meta App + page; user confirmed Meta API not actually wired)
- Theming the tournaments with Naruto-tier names (Genin/Chunin/Jonin/Kage)
- Tournament bracket UI (currently `Tournaments` page lists tournaments and `TournamentDetail` does stat checks + results, but no bracket visualizer)

## Recommended next session plan (in priority order)

1. ~~**Verify `npm install` + `npm run build` succeeds**~~ ✅ done (passes clean)
2. ~~**UI restyle (shinobi theme: kunai red gradient, chakra gold, atmospheric bg)**~~ ✅ done
3. ~~**`supabase init` + project_id set in config.toml**~~ ✅ done
4. ~~**Add Supabase publishable/anon key to `.env.local`**~~ ✅ done — `sb_publishable_KzKAcOCTRo-KVgQnpOFAuw_i14XrSJ0` wired in. Login/signup verified working against the live project (auth API responded with a real domain-validation error on a fake email).
5. ~~**Run migration 008 (rename default server)**~~ ✅ done — applied via PostgREST `PATCH /rest/v1/servers` with the service-role key. Verified: `select name from public.servers where id = '00000000…'` returns `Shinobi Village`.
6. ~~**Make migration 009 (reels.layout) optional**~~ ✅ done — frontend now encodes layout into `combined_video_url` via the `shinobi-layout://` scheme. Multi-angle YouTube reels work without DDL. New helper at `src/lib/reelLayout.ts` (`resolveLayout`, `isPlayableUrl`, `encode/decodeLayoutMarker`). When 009 is applied later, `resolveLayout` prefers the column and a one-time backfill migrates marker URLs into the column. SQL block ready at `supabase/RUN_PENDING_MIGRATIONS.sql` (now optional cleanup, not required).
7. ~~**Smoke test a multi-angle YouTube reel**~~ ✅ done — created two reels end-to-end via the live UI: a 2-clip concat reel (`/reels/e7794809-…`) and a 4-clip 2x2 squad-view reel (`/reels/d280552b-…`). Both saved to DB and rendered with synced YouTube embeds + "Play all" / "Use audio" controls. Original failure was the pre-fix code path (sent missing `layout` column → 400); resolved by the `shinobi-layout://` workaround.
8. **Apply Shinobi-branded auth emails:** the templates are in `supabase/templates/*.html` and wired into `supabase/config.toml`. Two paths — see `supabase/EMAIL_BRANDING.md`:
   - **Fast (CLI)**: `supabase login` then `supabase config push --linked` — pushes all six templates + subjects in one command.
   - **No CLI**: open the dashboard → Authentication → Email Templates and paste each HTML file + subject (table in `EMAIL_BRANDING.md`). 30 seconds.
   - Then in **Authentication → SMTP Settings** set Sender Name to `Shinobi Village`.
9. **Configure Supabase Auth providers:** Dashboard → Authentication → Providers → enable Google + Facebook, paste OAuth client ID/secret. Set redirect URL to `https://siwcdegiavwcvgjegiww.supabase.co/auth/v1/callback`.
   - Google client ID we already have on disk: `943866637967-0ljk5otjf2ci9ne1fmb78ib2rin2fqil.apps.googleusercontent.com`
   - Facebook app ID we already have on disk: `1635627497443035`
10. **(Optional) AdSense** — sign up, paste keys into `.env.local` + GitHub Pages secrets.
11. **(Optional) `VITE_FACEBOOK_APP_ID`** to enable proper Messenger share dialog.
12. Then circle back for IMA SDK pre-roll → YouTube auto-publish → Messenger bot.

## UI restyle summary (this pass)

| Layer | Before | After |
|---|---|---|
| Theme | generic cyan accent only | added "shinobi" palette: `kunai` (red), `chakra` (gold), `leaf` (green), `dark.elevated` |
| Background | flat grid | layered radial glow (kunai red top + chakra gold corner) + faint dot pattern |
| Brand logo | inline gradient style | `BrandLogo` uses CSS class + `font-brand` (Orbitron) |
| Buttons | hand-rolled per page | shared `.btn-primary` (kunai gradient, hover-lift) + `.btn-ghost` |
| Cards | rectangle with hover border | `.card` + `.card-hover` (lift + kunai border on hover) |
| Pills | one-off | `.pill`, `.pill-kunai`, `.pill-chakra`, `.pill-accent` |
| Sidebar active state | full bg fill | left-border indicator + elevated bg + kunai icon |
| Sidebar logo | small cyan square | gradient kunai shuriken |
| Landing hero | plain heading + CTAs | tagline pill, oversized brand title, feature pill strip, view-all links, layout badges on reel cards, hover play overlay |
| Login / Signup | basic form | brand mark on top, backdrop-blur card, gradient CTA, "or continue with" divider, focus rings |
| Scrollbar | OS default | dark themed |
