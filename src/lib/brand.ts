/** Single source of truth for product name and default share copy. */
export const BRAND = {
  name: 'KillCam',
  /** Two-tone wordmark halves (KILL / CAM). */
  nameParts: ['Kill', 'Cam'] as const,
  /** One line — every angle of the kill, one cam. */
  tagline: 'Every angle of the kill. One cam.',
  defaultShareTitle: (title?: string) => title?.trim() || 'Check out this KillCam clip',
} as const
