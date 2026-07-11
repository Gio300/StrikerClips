/** Single source of truth for product name, domain, and default share copy. */
export const BRAND = {
  name: 'KillCam',
  /** Bare hostname, no scheme. */
  domain: 'killcam.app',
  /** Canonical absolute URL of the product. */
  url: 'https://killcam.app',
  /** One line — multi-angle kill/clutch highlights, every angle synced into one cam. */
  tagline: 'Every angle of the kill. One cam.',
  /** Longer marketing sentence. */
  blurb:
    'KillCam combines every player’s clip of the same moment into one synced multi-angle edit — then clans battle, chat, and climb the leaderboards.',
  /** The YouTube channel combined masters get published to (our CDN). */
  youtubeChannel: '@killcam',
  defaultShareTitle: (title?: string) => title?.trim() || 'Check out this KillCam multi-angle reel',
} as const
