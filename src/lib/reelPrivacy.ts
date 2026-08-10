export const REEL_USE_PRIVACY_VALUES = [
  'followers_of_followers',
  'only_me',
  'tournaments',
  'lives',
  'anyone',
  'followers',
  'clan_members',
  'clan_officers',
] as const

export type ReelUsePrivacy = (typeof REEL_USE_PRIVACY_VALUES)[number]
export type ReelUseContext = 'general' | 'tournament' | 'live'

export const DEFAULT_REEL_USE_PRIVACY: ReelUsePrivacy = 'followers_of_followers'

export function normalizeReelUsePrivacy(value: unknown): ReelUsePrivacy {
  const raw = String(value || '').trim().toLowerCase()
  return REEL_USE_PRIVACY_VALUES.includes(raw as ReelUsePrivacy)
    ? (raw as ReelUsePrivacy)
    : DEFAULT_REEL_USE_PRIVACY
}

export const REEL_USE_PRIVACY_OPTIONS: Array<{
  value: ReelUsePrivacy
  label: string
  description: string
}> = [
  {
    value: 'followers_of_followers',
    label: 'Followers of followers',
    description: 'People who follow you, plus people who follow them.',
  },
  { value: 'followers', label: 'Only followers', description: 'Only people who follow you.' },
  { value: 'clan_members', label: 'Only clan members', description: 'Members of any clan you belong to.' },
  { value: 'clan_officers', label: 'Only clan officers', description: 'Leaders and officers in your clans.' },
  { value: 'tournaments', label: 'Only tournaments', description: 'Tournament organizers may use them for your matches.' },
  { value: 'lives', label: 'Only lives', description: 'Live hosts may add them to a live show.' },
  { value: 'only_me', label: 'Only me', description: 'Nobody else can use them in TKO.' },
  { value: 'anyone', label: 'Anyone', description: 'Any signed-in TKO player may use them.' },
]
