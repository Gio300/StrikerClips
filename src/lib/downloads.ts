/**
 * Desktop / mobile download targets for the ClutchLens install app.
 *
 * Wire real URLs via env vars. Until they're set, the download buttons fall
 * back to the web app (`/`) so the marketing page is always usable.
 *
 *   VITE_DOWNLOAD_WIN     e.g. https://github.com/<you>/clutchlens-desktop/releases/latest/download/ClutchLens-Setup-x64.exe
 *   VITE_DOWNLOAD_MAC     .../ClutchLens.dmg
 *   VITE_DOWNLOAD_LINUX   .../ClutchLens.AppImage
 *   VITE_DOWNLOAD_IOS     App Store URL once published
 *   VITE_DOWNLOAD_ANDROID Play Store URL once published
 */

export type DeviceId = 'web' | 'windows' | 'mac' | 'linux' | 'ios' | 'android'

export type DownloadTarget = {
  id: DeviceId
  name: string
  /** Short marketing line. */
  blurb: string
  /** SVG path family for the icon. */
  icon: 'globe' | 'windows' | 'apple' | 'linux' | 'phone' | 'android'
  /** Direct download / store URL. May be empty when not yet released. */
  url: string
  /** Set true to render a "Coming soon" pill even when url is empty. */
  comingSoon?: boolean
  /** Bullet list of perks for this device. */
  perks: string[]
}

export function getDownloads(): DownloadTarget[] {
  const env = import.meta.env
  return [
    {
      id: 'web',
      name: 'Open in browser',
      blurb: 'Sign up and start in 30 seconds — no install.',
      icon: 'globe',
      url: '/',
      perks: [
        'Multi-angle reels (YouTube + uploads)',
        'Tournaments, boards, rankings',
        'Share to social',
      ],
    },
    {
      id: 'windows',
      name: 'Windows',
      blurb: 'The full app: local AI, OBS-style live, faster renders.',
      icon: 'windows',
      url: env.VITE_DOWNLOAD_WIN ?? '',
      comingSoon: true,
      perks: [
        'On-device AI commentary (your CPU/GPU)',
        'Built-in stream tools to YouTube / Twitch',
        'Faster ffmpeg renders, larger files',
      ],
    },
    {
      id: 'mac',
      name: 'macOS',
      blurb: 'Apple silicon native. Same full feature set.',
      icon: 'apple',
      url: env.VITE_DOWNLOAD_MAC ?? '',
      comingSoon: true,
      perks: [
        'On-device AI commentary',
        'Stream tools + multi-cam composer',
        'Optimized for M-series Macs',
      ],
    },
    {
      id: 'linux',
      name: 'Linux',
      blurb: 'AppImage. No daemons, no junk.',
      icon: 'linux',
      url: env.VITE_DOWNLOAD_LINUX ?? '',
      comingSoon: true,
      perks: [
        'Same full app on Linux',
        'On-device AI when supported by hardware',
        'CLI render mode included',
      ],
    },
    {
      id: 'ios',
      name: 'iOS',
      blurb: 'Capture + paste links + watch reels on the go.',
      icon: 'phone',
      url: env.VITE_DOWNLOAD_IOS ?? '',
      comingSoon: true,
      perks: [
        'Quick capture + share',
        'Friend-invite reels from your phone',
        'Watch and react anywhere',
      ],
    },
    {
      id: 'android',
      name: 'Android',
      blurb: 'Capture + paste links + watch reels on the go.',
      icon: 'android',
      url: env.VITE_DOWNLOAD_ANDROID ?? '',
      comingSoon: true,
      perks: [
        'Quick capture + share',
        'Friend-invite reels from your phone',
        'Watch and react anywhere',
      ],
    },
  ]
}

/**
 * Best-guess device based on UA. Used to highlight the most likely target on
 * first load. Pure heuristic, no PII.
 */
export function detectDevice(): DeviceId {
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  if (/mac os x|macintosh/.test(ua)) return 'mac'
  if (/windows nt/.test(ua)) return 'windows'
  if (/linux/.test(ua)) return 'linux'
  return 'web'
}
