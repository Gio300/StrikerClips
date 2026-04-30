# Repo split — going from `StrikerClips` → `clutchlens` + `clutchlens-marketing`

This doc walks the migration from the current single repo into two repos:

| Repo | Visibility | Hosts | Cost |
| --- | --- | --- | --- |
| `gio300/clutchlens-marketing` | **Public** | Static marketing site (GitHub Pages) | $0 |
| `gio300/clutchlens` | **Private** | App source + web build (Cloudflare Pages) + installers (GitHub Releases) | $0 |

Why the split:
- The marketing site needs to be public so search engines crawl it.
- The app source can be private — Cloudflare Pages is free for private repos (GitHub Pages requires Pro $4/mo for private).
- Installers ship as GitHub Releases on the private app repo with public download URLs (you can grant public read on a private repo's releases).

## Prereqs

- A Cloudflare account (free, sign up at https://dash.cloudflare.com/sign-up).
- The `gh` CLI authenticated (`gh auth status`).

## Path A — easiest (recommended)

Keep the existing repo as the **app** (rename it), and create a fresh **marketing** repo with just the `dist-site/` source.

### 1. Rename the existing repo on GitHub

```bash
# Rename gio300/StrikerClips → gio300/clutchlens
gh repo rename clutchlens
git remote set-url origin https://github.com/gio300/clutchlens.git

# Make it private
gh repo edit gio300/clutchlens --visibility private --accept-visibility-change-consequences
```

### 2. Create the marketing repo (public, fresh)

```bash
# From a sibling folder
cd ..
mkdir clutchlens-marketing
cd clutchlens-marketing
git init -b main

# Pull just the marketing source from the app repo
cp ../ShinobiVillage/index.site.html ./index.html
cp ../ShinobiVillage/vite.site.config.ts ./vite.config.ts
cp -r ../ShinobiVillage/src ./src
cp -r ../ShinobiVillage/public ./public
cp ../ShinobiVillage/package.json ./
cp ../ShinobiVillage/tailwind.config.js ./
cp ../ShinobiVillage/postcss.config.js ./
cp ../ShinobiVillage/tsconfig.json ./
# trim package.json to just what the site needs (vite, react, tailwind)
# trim src/ to just src/site-main.tsx + src/pages/Marketing.tsx + src/lib/{brand,downloads}.ts + src/components/BrandLogo.tsx
# (a sibling helper script `scripts/extract-marketing.mjs` can do this — write it next session if useful)

git add -A
git commit -m "feat: ClutchLens marketing site"

gh repo create gio300/clutchlens-marketing --public --source=. --remote=origin --push
```

### 3. Enable GitHub Pages on the marketing repo

```bash
gh api -X POST /repos/gio300/clutchlens-marketing/pages \
  -f build_type=workflow
```

Then add `.github/workflows/pages.yml`:

```yaml
name: Pages
on:
  push: { branches: [main] }
  workflow_dispatch: {}
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
        id: deployment
```

### 4. Connect the app repo to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize Cloudflare to read your GitHub. Pick `gio300/clutchlens`.
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: (leave blank)
4. Add env vars from `.env.example` that should ship in production (Supabase URL/anon key, ad slots, download URLs).
5. Save & deploy. Cloudflare gives you `clutchlens.pages.dev` for free; point a custom domain when you have one.

### 5. Wire installers via GitHub Releases on the app repo

The `release.yml` workflow already in `.github/workflows/` does this on tag push. Tag `v0.1.0` and the workflow builds Win/macOS/Linux installers and attaches them to the Release.

The marketing site's download buttons read URLs from `VITE_DOWNLOAD_*`. Set those on the marketing repo's GitHub Pages env (or hardcode in `src/lib/downloads.ts` after the first release).

## Path B — fork-and-trim

If renaming the existing repo is scary, fork instead:

```bash
gh repo fork gio300/StrikerClips --clone=false
gh repo rename --repo gio300/StrikerClips-fork clutchlens-marketing
# Make it public if it isn't
# In the fork, delete everything except marketing files
```

Path A is cleaner — fewer repos in flight.

## Path C — git-subtree split

Most surgical, hardest to mess up later:

```bash
git subtree split --prefix=src/pages -b marketing-only
# Filter further as needed, push that branch to the new repo
```

Skip this unless you really want to preserve marketing-page commit history.

## Post-migration checklist

- [ ] `clutchlens-marketing` is public + GitHub Pages live at `https://gio300.github.io/clutchlens-marketing/`
- [ ] `clutchlens` is private + Cloudflare Pages serving the app at `clutchlens.pages.dev`
- [ ] `release.yml` workflow tested with a `v0.1.0-test` tag (delete the test release after)
- [ ] `VITE_DOWNLOAD_*` env vars set on the marketing repo's Pages workflow
- [ ] Custom domain pointed (when you pick one)
