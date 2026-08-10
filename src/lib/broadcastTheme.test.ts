import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEME,
  loadTheme,
  saveTheme,
  normalizeAccent,
  adoptLeagueKit,
  type ThemeStorage,
} from './broadcastTheme'

/** In-memory storage stand-in so tests never touch a real localStorage. */
function memStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
  }
}

describe('broadcastTheme — normalizeAccent', () => {
  it('accepts 6-digit hex with or without #', () => {
    expect(normalizeAccent('#2F81F7')).toBe('#2f81f7')
    expect(normalizeAccent('ff7a18')).toBe('#ff7a18')
  })
  it('expands 3-digit shorthand', () => {
    expect(normalizeAccent('#f80')).toBe('#ff8800')
  })
  it('falls back to the default accent on junk / empty', () => {
    expect(normalizeAccent('not-a-color')).toBe(DEFAULT_THEME.accent)
    expect(normalizeAccent('')).toBe(DEFAULT_THEME.accent)
    expect(normalizeAccent(null)).toBe(DEFAULT_THEME.accent)
  })
})

describe('broadcastTheme — load/save', () => {
  it('returns the defaults when nothing is stored', () => {
    const s = memStorage()
    expect(loadTheme('t1', s)).toEqual(DEFAULT_THEME)
  })

  it('round-trips a saved theme, keyed independently', () => {
    const s = memStorage()
    saveTheme('cupA', { tournamentName: 'Cup A', teamA: 'Reds', teamB: 'Blues' }, s)
    saveTheme('cupB', { tournamentName: 'Cup B' }, s)

    const a = loadTheme('cupA', s)
    expect(a.tournamentName).toBe('Cup A')
    expect(a.teamA).toBe('Reds')
    expect(a.teamB).toBe('Blues')

    const b = loadTheme('cupB', s)
    expect(b.tournamentName).toBe('Cup B')
    // cupB never set teams → still the defaults, proving keys don't bleed.
    expect(b.teamA).toBe(DEFAULT_THEME.teamA)
  })

  it('merges partial patches over the existing theme', () => {
    const s = memStorage()
    saveTheme('k', { tournamentName: 'Finals', accent: '#2f81f7' }, s)
    saveTheme('k', { hostName: 'Gio' }, s)
    const t = loadTheme('k', s)
    expect(t.tournamentName).toBe('Finals') // preserved
    expect(t.accent).toBe('#2f81f7')         // preserved
    expect(t.hostName).toBe('Gio')           // patched
  })

  it('remembers the selected clan or player identity for each side', () => {
    const s = memStorage()
    saveTheme('match', {
      teamA: 'AI Clan',
      teamAEntityId: 'clan-ai',
      teamAEntityType: 'clan',
      teamB: 'Shinobi X',
      teamBEntityId: 'player-x',
      teamBEntityType: 'player',
    }, s)

    const t = loadTheme('match', s)
    expect(t.teamAEntityId).toBe('clan-ai')
    expect(t.teamAEntityType).toBe('clan')
    expect(t.teamBEntityId).toBe('player-x')
    expect(t.teamBEntityType).toBe('player')
  })

  it('normalizes a bad accent on save', () => {
    const s = memStorage()
    const saved = saveTheme('k', { accent: 'garbage' }, s)
    expect(saved.accent).toBe(DEFAULT_THEME.accent)
    expect(loadTheme('k', s).accent).toBe(DEFAULT_THEME.accent)
  })
})

describe('broadcastTheme — adoptLeagueKit (league defaults for live overlays)', () => {
  const ssl = {
    colors: { primary: '#484878' },
    logoUrl: 'https://cdn.example/ssl-logo.png',
  }

  it('no league → the theme passes through untouched', () => {
    expect(adoptLeagueKit(DEFAULT_THEME, null)).toEqual(DEFAULT_THEME)
    expect(adoptLeagueKit(DEFAULT_THEME, undefined)).toEqual(DEFAULT_THEME)
  })

  it('a never-customized theme adopts the league accent + logo', () => {
    const t = adoptLeagueKit({ ...DEFAULT_THEME }, ssl)
    expect(t.accent).toBe('#484878')
    expect(t.logoUrl).toBe('https://cdn.example/ssl-logo.png')
    // Nothing else moves — teams/names stay the host's own.
    expect(t.teamA).toBe(DEFAULT_THEME.teamA)
    expect(t.tournamentName).toBe(DEFAULT_THEME.tournamentName)
  })

  it('explicit host overrides always win', () => {
    const custom = { ...DEFAULT_THEME, accent: '#2f81f7', logoUrl: 'https://host.example/me.png' }
    const t = adoptLeagueKit(custom, ssl)
    expect(t.accent).toBe('#2f81f7')
    expect(t.logoUrl).toBe('https://host.example/me.png')
  })

  it('reads server-shaped league rows (logo_url) too', () => {
    const t = adoptLeagueKit({ ...DEFAULT_THEME }, { logo_url: 'https://cdn.example/row.png' })
    expect(t.logoUrl).toBe('https://cdn.example/row.png')
    expect(t.accent).toBe(DEFAULT_THEME.accent) // no league primary given
  })

  it('a TKO-orange league primary or junk color is a no-op', () => {
    expect(adoptLeagueKit({ ...DEFAULT_THEME }, { colors: { primary: '#ff7a18' } }))
      .toEqual(DEFAULT_THEME)
    expect(adoptLeagueKit({ ...DEFAULT_THEME }, { colors: { primary: 'not-a-color' } }))
      .toEqual(DEFAULT_THEME)
  })

  it('is pure — the input theme object is not mutated', () => {
    const input = { ...DEFAULT_THEME }
    adoptLeagueKit(input, ssl)
    expect(input).toEqual(DEFAULT_THEME)
  })
})
