export type TournamentCreationTarget = 'king_1v1' | 'clan_battle' | 'clan_internal' | 'open_bracket'

const TARGETS = new Set<TournamentCreationTarget>([
  'king_1v1',
  'clan_battle',
  'clan_internal',
  'open_bracket',
])

export function parseTournamentCreationTarget(value: string | null): TournamentCreationTarget | null {
  return value && TARGETS.has(value as TournamentCreationTarget)
    ? value as TournamentCreationTarget
    : null
}

export function clanTournamentCreationPath(
  clanId: string,
  target: 'clan_internal' | 'clan_battle',
): string {
  const params = new URLSearchParams({
    create: '1',
    scope: 'clan',
    clan: clanId,
    target,
  })
  return `/tournaments?${params.toString()}`
}
