/** Single source of truth for product name and default share copy. */
export const BRAND = {
  name: 'ReelOne',
  /** One line — multi-game, all angles, one reel. */
  tagline: 'Every angle. Every clutch. One reel.',
  defaultShareTitle: (title?: string) => title?.trim() || 'Check out this ReelOne reel',
} as const
