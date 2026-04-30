# ReelOne — Desktop (Tauri)

This folder is the desktop wrapper. It builds **Windows .exe / .msi**, **macOS .dmg**, and **Linux .AppImage / .deb** installers from the same web build that powers the browser app.

## What's already in place

- `Cargo.toml` — Rust crate definition
- `tauri.conf.json` — Tauri 2 config (window, bundling, identifier)
- `src/main.rs` + `src/lib.rs` — Tauri entry, with `app_version` and `open_obs_install_page` commands wired
- `capabilities/default.json` — capability permissions (shell open, dialog, os, fs)
- `build.rs` — Tauri build script

## What's still needed (one-time per dev machine)

1. **Install Rust** — https://rustup.rs/ (~5 min)
2. **Platform prerequisites** — see https://v2.tauri.app/start/prerequisites/
   - Windows: Microsoft C++ Build Tools, WebView2 (auto on Win11)
   - macOS: Xcode CLI tools (`xcode-select --install`)
   - Linux: webkit2gtk + assorted dev headers
3. **Add icons** — drop a `1024x1024` master icon at `icons/icon.png` and run `npx tauri icon icons/icon.png` to generate all formats. Today the bundle config references icon paths that don't exist yet, so production bundling will fail until icons are present.

## Run it

```bash
# Dev — boots the Vite dev server + opens a native window pointed at it.
npm run tauri:dev

# Production build — produces installers in `src-tauri/target/release/bundle/`
npm run tauri:build
```

## CI / Releases

Cross-platform installer builds happen on tag push via `.github/workflows/release.yml` (next session — needs Rust on the runners). Output uploads as a GitHub Release on the private app repo. Marketing site reads the latest release URL via the `VITE_DOWNLOAD_*` env vars on the public marketing repo.

## What's queued

- Real Ollama sidecar binding (`tauri.conf.json` → `bundle.externalBin`) so the installer ships with `ollama` and a `Llama 3.2 1B` model preloaded
- Piper TTS sidecar similarly bundled
- A `localAi` adapter that calls the sidecar via stdin/stdout instead of using the web fallback
- Auto-updater (`tauri-plugin-updater`)
- macOS code-signing + notarization
- Windows code-signing (when we have a cert)
