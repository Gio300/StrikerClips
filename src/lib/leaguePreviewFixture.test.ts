import { describe, it, expect } from 'vitest'
import {
  buildPreviewFixture,
  DEFAULT_PREVIEW_VERTICAL,
  normalizePreviewVertical,
  PREVIEW_FIXTURE,
  PREVIEW_VERTICALS,
  previewHue,
  previewVertical,
} from './leaguePreviewFixture'

// The preview's five screens (home / reels / live / tournament / standings)
// are driven by this ONE fake fixture. These tests are the "fixture render"
// proof — that the data every screen reads is present and well-formed, so a
// brand-new league with zero real members still sees a populated app.

describe('leaguePreviewFixture — the fake preview data', () => {
  it('has players for the live strip + live angles', () => {
    expect(PREVIEW_FIXTURE.players.length).toBeGreaterThanOrEqual(4)
    for (const p of PREVIEW_FIXTURE.players) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.initial.length).toBe(1)
      expect(typeof p.live).toBe('boolean')
    }
    // At least one live player so the gradient ring shows in the demo.
    expect(PREVIEW_FIXTURE.players.some((p) => p.live)).toBe(true)
  })

  it('has reels for the home feed + Watch screen', () => {
    expect(PREVIEW_FIXTURE.reels.length).toBeGreaterThan(0)
    for (const r of PREVIEW_FIXTURE.reels) {
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.subtitle.length).toBeGreaterThan(0)
      expect(r.length).toMatch(/^\d+:\d{2}$/)
    }
  })

  it('has a ranked standings table', () => {
    const rows = PREVIEW_FIXTURE.standings
    expect(rows.length).toBeGreaterThan(1)
    rows.forEach((row, i) => {
      expect(row.rank).toBe(i + 1) // 1..n, in order
      expect(row.abbr.length).toBeGreaterThan(0)
      expect(row.wins).toBeGreaterThanOrEqual(0)
      expect(row.losses).toBeGreaterThanOrEqual(0)
    })
  })

  it('has a bracket of rounds, each with matches, and one live match', () => {
    expect(PREVIEW_FIXTURE.bracket.length).toBeGreaterThan(0)
    let liveMatches = 0
    for (const round of PREVIEW_FIXTURE.bracket) {
      expect(round.name.length).toBeGreaterThan(0)
      expect(round.matches.length).toBeGreaterThan(0)
      for (const m of round.matches) {
        expect(m.a.length).toBeGreaterThan(0)
        expect(m.b.length).toBeGreaterThan(0)
        if (m.live) liveMatches++
      }
    }
    expect(liveMatches).toBeGreaterThan(0)
  })

  it('has a live match with multi-angle cameras', () => {
    const { live } = PREVIEW_FIXTURE
    expect(live.title.length).toBeGreaterThan(0)
    expect(live.teamA.length).toBeGreaterThan(0)
    expect(live.teamB.length).toBeGreaterThan(0)
    expect(live.angles.length).toBeGreaterThanOrEqual(2)
  })
})

// THE SALES BAR (operator 2026-08-04): the mockup has to read as a THRIVING
// league, not a wireframe. These are the floors that keep it that way — if a
// future edit thins the fixture back out to five names and two clips, this
// suite fails before the prospect ever sees it.

describe('leaguePreviewFixture — it has to look ALIVE', () => {
  it('carries a real roster, not a handful of names', () => {
    expect(PREVIEW_FIXTURE.players.length).toBeGreaterThanOrEqual(10)
    const names = new Set(PREVIEW_FIXTURE.players.map((p) => p.name))
    expect(names.size).toBe(PREVIEW_FIXTURE.players.length)
    const ids = new Set(PREVIEW_FIXTURE.players.map((p) => p.id))
    expect(ids.size).toBe(PREVIEW_FIXTURE.players.length)
  })

  it('fills a clip GRID with view counts and authors', () => {
    expect(PREVIEW_FIXTURE.reels.length).toBeGreaterThanOrEqual(6)
    for (const r of PREVIEW_FIXTURE.reels) {
      expect(r.views.length).toBeGreaterThan(0)
      expect(r.likes.length).toBeGreaterThan(0)
      expect(r.author.length).toBeGreaterThan(0)
    }
    // Exactly one trending tile — more than one and the badge means nothing.
    expect(PREVIEW_FIXTURE.reels.filter((r) => r.hot).length).toBe(1)
  })

  it('shows a table with MOVEMENT — arrows, streaks and form', () => {
    const rows = PREVIEW_FIXTURE.standings
    expect(rows.length).toBeGreaterThanOrEqual(8)
    expect(rows.some((r) => r.move === 'up')).toBe(true)
    expect(rows.some((r) => r.move === 'down')).toBe(true)
    for (const r of rows) {
      expect(r.streak).toMatch(/^[WL]\d+$/)
      expect(r.form.length).toBe(5)
    }
    // Points follow the standings order (a table that makes sense).
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].points).toBeLessThanOrEqual(rows[i - 1].points)
    }
  })

  it('is caught MID-tournament: played rounds, one live, one still to come', () => {
    const rounds = PREVIEW_FIXTURE.bracket
    expect(rounds.length).toBeGreaterThanOrEqual(3)
    expect(rounds.some((r) => r.status === 'done')).toBe(true)
    expect(rounds.some((r) => r.status === 'live')).toBe(true)
    expect(rounds.some((r) => r.status === 'upcoming')).toBe(true)
    const all = rounds.flatMap((r) => r.matches)
    expect(all.filter((m) => m.live).length).toBe(1)
    expect(all.filter((m) => m.upcoming).length).toBeGreaterThan(0)
  })

  it('has a viewer count, a clock and per-angle audiences', () => {
    const { live } = PREVIEW_FIXTURE
    expect(live.viewers).toBeGreaterThan(0)
    expect(live.watching).toContain(String(live.viewers).slice(0, 1))
    expect(live.clock).toMatch(/^\d+:\d{2}$/)
    expect(live.angles.length).toBe(4)
    for (const a of live.angles) expect(a.viewers.length).toBeGreaterThan(0)
  })

  it('has an activity feed and enough chat to keep the ticker moving', () => {
    expect(PREVIEW_FIXTURE.activity.length).toBeGreaterThanOrEqual(5)
    for (const a of PREVIEW_FIXTURE.activity) {
      expect(a.text.length).toBeGreaterThan(0)
      expect(a.when.length).toBeGreaterThan(0)
    }
    expect(PREVIEW_FIXTURE.chat.length).toBeGreaterThanOrEqual(6)
  })

  it('carries the "this has users" counters', () => {
    const s = PREVIEW_FIXTURE.stats
    for (const v of [s.members, s.clipsThisWeek, s.matchesPlayed, s.hoursWatched]) {
      expect(v.length).toBeGreaterThan(0)
    }
  })
})

// GAME-AGNOSTIC (operator 2026-08-04): "I need to advertise something other
// than 1 video game with people I know." The default mockup must not read as
// any one title, and a prospect must be able to swap the whole sample league
// into their own competition's language.

describe('leaguePreviewFixture — game-agnostic verticals', () => {
  it('ships several verticals, each with its own words and names', () => {
    expect(PREVIEW_VERTICALS.length).toBeGreaterThanOrEqual(5)
    const ids = new Set(PREVIEW_VERTICALS.map((v) => v.id))
    expect(ids.size).toBe(PREVIEW_VERTICALS.length)
    for (const v of PREVIEW_VERTICALS) {
      expect(v.teams.length).toBe(8)
      expect(v.clipTitles.length).toBe(6)
      expect(v.chat.length).toBeGreaterThanOrEqual(6)
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.hint.length).toBeGreaterThan(0)
    }
  })

  it('covers the leagues the operator wants to sell to', () => {
    const ids = PREVIEW_VERTICALS.map((v) => v.id)
    for (const wanted of ['esports', 'shooter', 'soccer', 'racing', 'fighting', 'hoops']) {
      expect(ids).toContain(wanted)
    }
  })

  it('the DEFAULT mockup is not about one specific game', () => {
    const blob = JSON.stringify(buildPreviewFixture(DEFAULT_PREVIEW_VERTICAL)).toLowerCase()
    // The flagship league's own vocabulary must never leak into the neutral
    // sample — that is exactly the "1 video game with people I know" problem.
    for (const banned of ['shinobi', 'striker', 'naruto', 'ssl']) {
      expect(blob).not.toContain(banned)
    }
  })

  it('swapping the vertical really swaps the league (teams AND vocabulary)', () => {
    const esports = buildPreviewFixture('esports')
    const soccer = buildPreviewFixture('soccer')
    expect(soccer.vertical.unit).not.toBe(esports.vertical.unit)
    expect(soccer.vertical.matchWord).not.toBe(esports.vertical.matchWord)
    expect(soccer.standings.map((r) => r.team)).not.toEqual(esports.standings.map((r) => r.team))
    expect(soccer.reels.map((r) => r.title)).not.toEqual(esports.reels.map((r) => r.title))
    // …but the SHAPE never changes: it is one app, not six.
    expect(soccer.reels.length).toBe(esports.reels.length)
    expect(soccer.standings.length).toBe(esports.standings.length)
    expect(soccer.bracket.length).toBe(esports.bracket.length)
  })

  it('every vertical builds a complete, well-formed league', () => {
    for (const v of PREVIEW_VERTICALS) {
      const fx = buildPreviewFixture(v.id)
      expect(fx.vertical.id).toBe(v.id)
      expect(fx.standings.length).toBe(8)
      expect(fx.reels.length).toBe(6)
      expect(fx.live.angles.length).toBe(4)
      expect(fx.bracket.flatMap((r) => r.matches).filter((m) => m.live).length).toBe(1)
    }
  })

  it('is deterministic — the same id always yields the same league', () => {
    expect(buildPreviewFixture('racing')).toEqual(buildPreviewFixture('racing'))
  })

  it('coerces junk vertical ids to the default instead of throwing', () => {
    expect(normalizePreviewVertical('nonsense')).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(normalizePreviewVertical(null)).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(normalizePreviewVertical(42)).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(normalizePreviewVertical('  SOCCER ')).toBe('soccer')
    expect(previewVertical('nope').id).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(buildPreviewFixture('nope').vertical.id).toBe(DEFAULT_PREVIEW_VERTICAL)
  })
})

describe('leaguePreviewFixture — generated avatars/thumbnails', () => {
  it('previewHue is stable and inside the hue-rotate window', () => {
    expect(previewHue('Zephyr')).toBe(previewHue('Zephyr'))
    for (const seed of ['a', 'Zephyr', 'STM', 'esports-reel-3', '']) {
      const h = previewHue(seed)
      expect(h).toBeGreaterThanOrEqual(-45)
      expect(h).toBeLessThan(45)
      const tight = previewHue(seed, 40)
      expect(tight).toBeGreaterThanOrEqual(-20)
      expect(tight).toBeLessThan(20)
    }
  })

  it('spreads hues across the roster so avatars do not look cloned', () => {
    const hues = new Set(PREVIEW_FIXTURE.players.map((p) => p.hue))
    expect(hues.size).toBeGreaterThanOrEqual(PREVIEW_FIXTURE.players.length - 1)
  })

  it('spreads CLIP hues too — sequential seeds must not collapse to one swatch', () => {
    const hues = PREVIEW_FIXTURE.reels.map((r) => r.hue)
    expect(new Set(hues).size).toBe(hues.length)
    // A grid where every tile is within a couple of degrees reads as one block.
    expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(20)
  })

  it('keeps clip hues INSIDE the brand family (a feed must look branded)', () => {
    for (const r of PREVIEW_FIXTURE.reels) {
      expect(Math.abs(r.hue)).toBeLessThanOrEqual(30)
    }
  })
})
