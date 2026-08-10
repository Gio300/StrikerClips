import { describe, expect, it } from 'vitest'
import { clanTournamentCreationPath, parseTournamentCreationTarget } from './tournamentCreation'

describe('tournament creation links', () => {
  it('keeps in-clan and inter-clan clan-tool paths explicit', () => {
    expect(clanTournamentCreationPath('clan-123', 'clan_internal')).toBe(
      '/tournaments?create=1&scope=clan&clan=clan-123&target=clan_internal',
    )
    expect(clanTournamentCreationPath('clan-123', 'clan_battle')).toBe(
      '/tournaments?create=1&scope=clan&clan=clan-123&target=clan_battle',
    )
  })

  it('accepts only supported wizard targets from query state', () => {
    expect(parseTournamentCreationTarget('clan_internal')).toBe('clan_internal')
    expect(parseTournamentCreationTarget('clan_battle')).toBe('clan_battle')
    expect(parseTournamentCreationTarget('unknown')).toBeNull()
    expect(parseTournamentCreationTarget(null)).toBeNull()
  })
})
