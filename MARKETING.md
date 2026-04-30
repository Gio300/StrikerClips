# ClutchLens — marketing site

This repo ships **two builds**:

| Bundle | Entry | Output | What it is | Where it lives |
|---|---|---|---|---|
| **App** | `index.html` → `src/main.tsx` | `dist/` | The full product: reels, tournaments, boards, auth, AI, etc. The same surface that desktop/mobile installers wrap. | Existing GitHub Pages deploy (`/StrikerClips/` for now). |
| **Site** | `index.site.html` → `src/site-main.tsx` | `dist-site/` | Static billboard — one page, no Supabase, no auth. Drives downloads + sign-ups into the app. | Wherever you want — Cloudflare Pages, Netlify, GitHub Pages on a second repo, S3 + CloudFront. All free at this scale. |

The two builds are intentionally decoupled so the marketing domain (e.g. `clutchlens.com`) can be wiped, redesigned, and redeployed without ever touching the running app.

---

## Local development

```bash
# main app (existing flow — unchanged)
npm run dev          # → http://localhost:5889
npm run build        # → dist/
npm run preview

# standalone marketing site (new)
npm run dev:site     # → http://localhost:5890
npm run build:site   # → dist-site/
npm run preview:site
```

`dev:site` reads from your local `.env.local` like the app does.

---

## Environment variables

Add these to `.env.local` for site builds (also work in the in-app `/marketing` route):

```env
# Where the site lives (sub-path if any). Default '/'.
VITE_SITE_BASE=/

# Where the app lives. When set, marketing CTAs deep-link to it.
# Leave empty to keep relative paths (in-app build).
VITE_APP_URL=https://gio300.github.io/StrikerClips

# One-click contact button on the marketing site.
VITE_CONTACT_EMAIL=hello@clutchlens.com

# Once installers ship, point these at GitHub Releases:
VITE_DOWNLOAD_WIN=https://github.com/<you>/clutchlens-desktop/releases/latest/download/ClutchLens-Setup.exe
VITE_DOWNLOAD_MAC=...
VITE_DOWNLOAD_LINUX=...
VITE_DOWNLOAD_IOS=...
VITE_DOWNLOAD_ANDROID=...
```

The download buttons fall back to "Coming soon" pills until the URLs are filled in. The web tile (`globe`) always works.

---

## Free hosting options

All three of these stay $0/month at this scale:

### A. Cloudflare Pages (recommended)
1. Push the repo to GitHub (already done).
2. Go to <https://dash.cloudflare.com> → Pages → "Create a project" → connect the repo.
3. Build command: `npm run build:site`
4. Build output directory: `dist-site`
5. Add the env vars above under "Environment variables".
6. Add your custom domain (free SSL).

### B. Netlify
Same pattern: command = `npm run build:site`, publish dir = `dist-site`.

### C. GitHub Pages on a separate repo
1. Create a second repo, e.g. `clutchlens-site`.
2. Run `npm run build:site` locally and copy `dist-site/*` into that repo's root (or use the `gh-pages` branch flow).
3. Enable Pages → Source: branch.
4. Optional: bind a custom domain via DNS `CNAME`.

This repo also ships a manual GitHub Action (`.github/workflows/build-site.yml`). Trigger it from the Actions tab to download the built `dist-site/` as an artifact and drop it wherever you want — useful when you don't want the build hooked to a host yet.

---

## Why a hard split?

- **Marketing can change weekly without testing the whole product.**
- **The app can ship installers without the marketing copy in the bundle.**
- **The marketing build has zero secrets** — no Supabase URL, no anon key, no AdSense client unless you choose. Smaller attack surface, faster page-load, A+ Lighthouse out of the box.
- **The app keeps deploying on its existing pipeline** (`.github/workflows/deploy.yml`) — that workflow is unchanged.

---

## What's next (roadmap)

The marketing site is the front door. The actual installers come next:

1. **Desktop**: wrap `dist/` with [Tauri](https://tauri.app) — small Rust-based runtime, tiny installer, free. CI builds Win `.exe`, macOS `.dmg`, Linux `.AppImage` on tag push, uploads to GitHub Releases. The marketing download buttons read from those release URLs via env vars.
2. **Mobile**: wrap the same `dist/` with [Capacitor](https://capacitorjs.com) for iOS/Android. Apple Developer ($99/yr) and Google Play ($25 one-time) are the only real costs.
3. **OBS-style streaming**: Tauri sidecar or a deep-link to a bundled OBS portable. Desktop-only.
4. **Local LLMs**: Ollama + a tiny LLM as a sidecar process, with Anything LLM as the admin UI. Desktop-only.

Each of those is a separate, focused work session — none require rebuilding the web app.
