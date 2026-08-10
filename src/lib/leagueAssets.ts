/**
 * League asset kit — the TEMPLATE VOCABULARY shared by the app and the Loras
 * render factory.
 *
 * VOCABULARY LOCK-STEP (do not rename casually): every `file` below mirrors a
 * real file in the renderer repo, `Loras/assets/brand/` (intro_vs_01.mp4,
 * outro_01.mp4, outro_02.mp4, banner_fire.jpg, banner_smoke.jpg,
 * banner_dark.jpg — the rotation `Loras/common/tko_vertical.py` picks from)
 * and `killcam_clips/music/ninja/` (the Suno music_dir). The app never serves
 * these files; it only needs the MANIFEST so a member building a reel and a
 * host going live pick from the exact same branded kit the factory renders
 * with. A league's own uploads under `Loras/assets/leagues/<slug>/` REPLACE
 * the TKO files renderer-side (same names win), so the ids here stay valid
 * for every league — which is why this manifest can be static/deterministic
 * with no new storage.
 *
 * Pure + dependency-free on purpose: imported by BOTH the client
 * (src/lib/leagueConfig.ts, the reel builder) and the server
 * (server/app.ts GET /api/league/:slug/config).
 */

export type LeagueAssetOption = {
  /** Stable, URL-safe pick id — what the reel builder stores on the reel. */
  id: string
  /** Human label shown in pickers. */
  label: string
  /** The renderer-side file name (see the lock-step note above). */
  file: string
}

export type LeagueAssetKit = {
  /** VS-screen intro clips (2s open with the competitors' name boxes). */
  intros: LeagueAssetOption[]
  /** Brand outro clips (the TKO King screen / league logo close). */
  outros: LeagueAssetOption[]
  /** Top-banner styles burned into the vertical frame. */
  banners: LeagueAssetOption[]
  /** Music tracks (the TKO Suno library, league's own anthem hoisted first). */
  music: LeagueAssetOption[]
}

/** Intro clips in Loras/assets/brand. */
export const INTRO_LIBRARY: LeagueAssetOption[] = [
  { id: 'vs-01', label: 'VS screen', file: 'intro_vs_01.mp4' },
]

/** Outro clips in Loras/assets/brand (tko_vertical.py alternates by variant). */
export const OUTRO_LIBRARY: LeagueAssetOption[] = [
  { id: 'king-01', label: 'TKO King I', file: 'outro_01.mp4' },
  { id: 'king-02', label: 'TKO King II', file: 'outro_02.mp4' },
]

/** Banner styles in Loras/assets/brand (the `tops` rotation in tko_vertical.py). */
export const BANNER_LIBRARY: LeagueAssetOption[] = [
  { id: 'fire', label: 'Fire', file: 'banner_fire.jpg' },
  { id: 'smoke', label: 'Smoke', file: 'banner_smoke.jpg' },
  { id: 'dark', label: 'Dark', file: 'banner_dark.jpg' },
]

/**
 * The TKO Suno music library (files in killcam_clips/music/ninja — the
 * renderer's `music_dir`). This lights up the `music_library` feature flag
 * that src/lib/tiers.ts has carried unimplemented until now.
 * (Moved here from src/lib/leagueConfig.ts, which re-exports it unchanged.)
 */
export const MUSIC_LIBRARY: LeagueAssetOption[] = [
  { id: 'suno_shinobi_striker_league', label: 'Shinobi Striker League', file: 'suno_shinobi_striker_league.mp3' },
  { id: 'tensorverse-shadow-kage-suno', label: 'Shadow Kage', file: 'tensorverse-shadow-kage-suno.mp3' },
  { id: 'tensorverse-shinobi-stand-up-intense-suno', label: 'Shinobi Stand Up', file: 'tensorverse-shinobi-stand-up-intense-suno.mp3' },
  { id: 'tensorverse-dungeon-queue-full-suno', label: 'Dungeon Queue', file: 'tensorverse-dungeon-queue-full-suno.mp3' },
  { id: 'tensorverse-mic-on-mute', label: 'Mic On Mute', file: 'tensorverse-mic-on-mute.mp3' },
  { id: 'tensorverse-ninja-aware-deception-suno', label: 'Ninja Aware Deception', file: 'tensorverse-ninja-aware-deception-suno.mp3' },
  { id: 'tensorverse-tko-dot-cam-suno', label: 'TKO Dot Cam', file: 'tensorverse-tko-dot-cam-suno.mp3' },
  { id: 'tokyorifft-night-of-the-ninjas', label: 'Night of the Ninjas', file: 'tokyorifft-night-of-the-ninjas.mp3' },
  { id: 'meditativetiger-samurai-siren', label: 'Samurai Siren', file: 'meditativetiger-samurai-siren.mp3' },
  { id: 'amethystmusic-my-sensei-at-their-max', label: 'My Sensei at Their Max', file: 'amethystmusic-my-sensei-at-their-max.mp3' },
  { id: 'moodmode-8-bit-retro-game-music', label: '8-Bit Retro', file: 'moodmode-8-bit-retro-game-music.mp3' },
  { id: 'wings_of_freedom-ninja-oriental', label: 'Ninja Oriental', file: 'wings_of_freedom-ninja-oriental.mp3' },
]

/** Display label for a library track; unknown files fall back to the raw name. */
export function musicLabel(file: string): string {
  return MUSIC_LIBRARY.find((t) => t.file === file)?.label ?? file
}

/**
 * Normalize the `leagues.music` jsonb (or the client config's plain string)
 * into the bare track file name, '' when unset.
 */
export function leagueMusicTrack(
  music: string | { track?: string | null } | null | undefined,
): string {
  if (typeof music === 'string') return music.trim()
  if (music && typeof music === 'object') return String(music.track ?? '').trim()
  return ''
}

/** A friendly label for a track file that isn't in the library ("my-anthem.mp3"). */
function prettyTrackLabel(file: string): string {
  return file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || file
}

/**
 * Derive the asset kit for a league config (or `null`/`undefined` for the TKO
 * house kit). Deterministic and storage-free: every league shares the template
 * intro/outro/banner ids (renderer-side, a league's own files under
 * assets/leagues/<slug>/ substitute the visuals without changing the ids), and
 * the music list is the TKO library with the league's configured anthem
 * (leagues.music jsonb) hoisted to the front — added if it's a custom file.
 */
export function leagueAssetKit(
  league?: { music?: string | { track?: string | null } | null } | null,
): LeagueAssetKit {
  const track = leagueMusicTrack(league?.music)
  let music = [...MUSIC_LIBRARY]
  if (track) {
    const hit = MUSIC_LIBRARY.find((t) => t.file === track)
    const first: LeagueAssetOption =
      hit ?? { id: track.replace(/\.[a-z0-9]+$/i, ''), label: prettyTrackLabel(track), file: track }
    music = [first, ...MUSIC_LIBRARY.filter((t) => t.file !== track)]
  }
  return {
    intros: [...INTRO_LIBRARY],
    outros: [...OUTRO_LIBRARY],
    banners: [...BANNER_LIBRARY],
    music,
  }
}
