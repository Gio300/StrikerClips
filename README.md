# Shinobi Village

Multi-angle highlight platform for *Shinobi Strikers* players: stitch teammates' clips together, run tournaments, track power-level rankings, and chat in Discord-style boards.

> Note: the GitHub repo and live deploy URL are still `StrikerClips` until rebrand-day. Set `VITE_BASE_PATH` if you change them.

## Tech Stack

- **Frontend:** React 18 + Vite + Tailwind CSS
- **Backend:** Supabase (Auth, PostgreSQL, Storage, Realtime)
- **Video:** ffmpeg.wasm — client-side multi-angle stitching (concat, 2x2 grid, side-by-side, picture-in-picture)
- **AI:** browser-only audio-energy auto-highlight detector (Web Audio API, no API costs)
- **Hosting:** GitHub Pages (free) via GitHub Actions
- **Monetization:** Google AdSense banners + reel pre-roll slots

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL migrations in `supabase/migrations/` via the SQL Editor in numeric order (001–008)
3. Storage buckets `videos` and `avatars` are created by migration 001 (or create them manually)
4. Enable Auth providers (Email, Google, GitHub) in Authentication > Providers
5. Add your site URL in Authentication > URL Configuration

### 2. Environment

Copy `.env.example` to `.env.local`:

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BASE_PATH=/StrikerClips/
```

### 3. Run

```bash
npm install
npm run dev
```

Dev server runs at `http://localhost:5889/StrikerClips/`.

### 4. Deploy

1. Push to `main` — GitHub Actions builds and deploys to GitHub Pages
2. Add the same env vars as **Repository Secrets** so the build picks them up

## Features

| Area | Status |
|---|---|
| Auth (email + OAuth) | Done |
| Highlight reels (concat 4–8 clips) | Done |
| **Multi-angle reels (2x2 grid, PiP, side-by-side)** | Done — `src/lib/ffmpegOps.ts` |
| **Auto-highlight detector (audio-energy)** | Done — `src/lib/highlightDetector.ts` |
| **Share buttons (FB / Messenger / X / Copy)** | Done — `src/components/ShareButtons.tsx` |
| Tournaments + admins + stat checks + results | Done |
| Power Ratings + Hall of Fame + Trophies | Done |
| Discord-style Boards (servers/channels/realtime chat) | Done |
| DMs, Polls, Activity feed | Done |
| Live multi-stream viewer + groups | Done |
| AdSense banner slots | Done (set `VITE_ADSENSE_*` to activate) |
| Reel pre-roll ads (IMA SDK) | Pending |
| Live chat per stream | Done — `src/components/StreamChat.tsx` |
| 6-pad soundboard + OBS scene control | Done — `src/components/Soundboard.tsx` + `OBSPanel.tsx` |
| OCR-driven match results (Tesseract.js) | Done — `src/lib/ocrMatchResult.ts` |
| Influencer dashboard `/dashboard` | Done — `src/pages/Dashboard.tsx` |
| Stripe Connect tipping (3 Edge Functions) | Scaffolded — see [docs/stripe-setup.md](docs/stripe-setup.md) |
| YouTube auto-upload queue | Scaffolded — see [docs/youtube-uploader.md](docs/youtube-uploader.md) |
| Frame-labeling tool `/ai/label` | Done — `src/pages/AILabel.tsx` |
| Striker CV detector | Roadmap — see [docs/cv-roadmap.md](docs/cv-roadmap.md) |
| Messenger bot notifications | Pending |

See `AUDIT.md` for the full code audit and roadmap.

## Going public

The site can be hosted publicly on day one. We support three deploy paths:

### A) Cloudflare Pages (recommended; free; custom domain)

1. Push the repo to GitHub. In Cloudflare → Pages → "Connect to Git", select
   the repo.
2. Build command: `npm run build`. Build output: `dist`.
3. Set environment variables (Settings → Environment variables → Production):

   | Var | Required | Notes |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | yes | Your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | yes | Public anon key |
   | `VITE_APP_URL` | yes | The Pages URL or your custom domain |
   | `VITE_STRIPE_PUBLISHABLE_KEY` | optional | Enables Tier B donations UI |
   | `VITE_YOUTUBE_AUTOUPLOAD` | optional | `1` once the worker is running |
   | `VITE_OCR_MATCH_RESULTS` | optional | `0` to disable OCR (default on) |
   | `VITE_ADSENSE_CLIENT` | optional | AdSense client id |
   | `VITE_BASE_PATH` | optional | Leave unset for Pages root `/` |

4. Hit "Save and deploy". First build takes ~2 minutes.
5. Bind your custom domain in Custom domains → Set up. DNS → CNAME →
   `<project>.pages.dev`. Cloudflare provisions a free TLS cert in seconds.

### B) GitHub Pages (free; works today)

The repo already ships [`.github/workflows/build-site.yml`](.github/workflows/build-site.yml).
On push to `main`:

1. Settings → Pages → set source to "GitHub Actions".
2. Repository Secrets must include `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (and any optional vars from the table above).
3. Set `VITE_BASE_PATH=/<repo-name>/` so asset paths resolve under the
   subdirectory (e.g. `/reelone/`).
4. Push. The workflow builds the marketing site and deploys to
   `https://<owner>.github.io/<repo>/`.

### C) Stay local-only

For private demos: `npm run dev:lan` exposes the Vite dev server on
`http://<your-LAN-ip>:5889`. Phone testing via PWA install on the same
network just works (we ship a manifest with proper icons).

### Pointing a domain (any provider)

Once Cloudflare Pages or GitHub Pages is live, point your domain in your
registrar:

```
A     @     192.0.2.1        ← (replace with provider's recommended IP)
CNAME www   <project>.pages.dev
```

Cloudflare Pages also supports apex flattening for free if you transfer
DNS to Cloudflare.

### What still needs ops attention before "go live"

- [ ] Apply migrations 001 → 012 on Supabase production.
- [ ] Create the **Storage buckets** that don't auto-create:
      `match-screenshots`, `soundboard` (public), and any others your
      branch uses.
- [ ] Set the Stripe webhook endpoint per [docs/stripe-setup.md](docs/stripe-setup.md).
- [ ] Run `node scripts/youtube-uploader.ts --once` from a box with
      `yt-dlp` + `ffmpeg` to drain the upload queue (see
      [docs/youtube-uploader.md](docs/youtube-uploader.md)).
- [ ] Add the production domain to Supabase Auth → URL configuration so
      OAuth redirects don't 400.

## License

MIT
