import { describe, expect, it } from 'vitest'
import { createAuthorCache } from './chatAuthors'

/**
 * HALVING THE REQUEST VOLUME.
 *
 * Every chat surface resolved message authors by reading `profiles` for the
 * `user_id`s in a batch — on the opening backfill AND on every incremental
 * tick. A room with any traffic therefore spent a SECOND request every 5
 * seconds re-reading the identity of the same handful of speakers, against a
 * 5-connection pool. These tests pin the two properties that make that cost
 * disappear: a known author is never re-requested, and neither is a known
 * ABSENT one.
 */

type Author = { username: string }

const found = (...names: string[]) =>
  new Map(names.map((name) => [name, { username: name.toUpperCase() } as Author]))

describe('createAuthorCache', () => {
  it('asks for every id the first time', () => {
    const cache = createAuthorCache<Author>()
    expect(cache.missing(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('NEVER re-asks for an author it already resolved — the whole point', () => {
    const cache = createAuthorCache<Author>()
    const wanted = cache.missing(['a', 'b'])
    cache.fill(wanted, found('a', 'b'))

    // Tick after tick after tick, the same speakers cost nothing.
    for (let tick = 0; tick < 50; tick += 1) {
      expect(cache.missing(['a', 'b', 'a'])).toEqual([])
    }
    expect(cache.get('a')).toEqual({ username: 'A' })
  })

  it('asks only for the ids it has never seen', () => {
    const cache = createAuthorCache<Author>()
    cache.fill(cache.missing(['a']), found('a'))
    expect(cache.missing(['a', 'b', 'c'])).toEqual(['b', 'c'])
  })

  it('REMEMBERS ABSENCE, so a profile-less author is not re-requested forever', () => {
    // A deleted account or a bot line has no profiles row. Without negative
    // caching it stays "missing" on every tick — exactly the cost this removes.
    const cache = createAuthorCache<Author>()
    const wanted = cache.missing(['ghost'])
    cache.fill(wanted, new Map())

    expect(cache.missing(['ghost'])).toEqual([])
    expect(cache.get('ghost')).toBeNull()
    expect(cache.size()).toBe(1)
  })

  it('distinguishes known-absent (null) from never-seen (undefined)', () => {
    const cache = createAuthorCache<Author>()
    cache.fill(['ghost'], new Map())
    expect(cache.get('ghost')).toBeNull()
    expect(cache.get('stranger')).toBeUndefined()
  })

  it('dedupes and drops nullish ids — a bot line has no user_id', () => {
    const cache = createAuthorCache<Author>()
    expect(cache.missing(['a', 'a', null, undefined, '', 'b'])).toEqual(['a', 'b'])
    expect(cache.get(null)).toBeUndefined()
    expect(cache.get(undefined)).toBeUndefined()
  })

  it('lets a later batch fill in an author an earlier one could not', () => {
    // The degrade path: a failed profiles read leaves the cache UNFILLED, so
    // the id stays missing and the next batch resolves it.
    const cache = createAuthorCache<Author>()
    expect(cache.missing(['a'])).toEqual(['a'])
    // …read failed, nothing filled…
    expect(cache.missing(['a'])).toEqual(['a'])
    cache.fill(['a'], found('a'))
    expect(cache.missing(['a'])).toEqual([])
    expect(cache.get('a')).toEqual({ username: 'A' })
  })

  it('a FAILED read must not be filled — that would blank a sender for the whole room', () => {
    // The caller only calls fill() when the profiles read succeeded. Pinned
    // here because getting it wrong is invisible until someone's name is
    // permanently "someone": fill() cannot tell a genuinely absent profile from
    // one a failed request simply did not return.
    const cache = createAuthorCache<Author>()
    const wanted = cache.missing(['a', 'b'])
    // …read fails, caller skips fill…
    expect(cache.missing(wanted)).toEqual(['a', 'b'])
    expect(cache.get('a')).toBeUndefined()
    // …and the retry resolves them normally.
    cache.fill(wanted, found('a', 'b'))
    expect(cache.get('a')).toEqual({ username: 'A' })
  })

  it('is per-room: a fresh cache knows nothing', () => {
    const first = createAuthorCache<Author>()
    first.fill(first.missing(['a']), found('a'))
    const second = createAuthorCache<Author>()
    expect(second.missing(['a'])).toEqual(['a'])
    expect(second.size()).toBe(0)
  })

  it('collapses a busy room to ZERO profile reads once everyone has spoken', () => {
    const cache = createAuthorCache<Author>()
    const speakers = ['gio', 'kai', 'rin']
    let reads = 0

    // 200 ticks of a busy room: the same three people talking. Each tick
    // carries two of them, so it takes two batches to meet all three.
    let firstQuietTick = -1
    for (let tick = 0; tick < 200; tick += 1) {
      const batch = [speakers[tick % 3], speakers[(tick + 1) % 3]]
      const wanted = cache.missing(batch)
      if (wanted.length > 0) {
        reads += 1
        cache.fill(wanted, found(...wanted))
      } else if (firstQuietTick === -1) {
        firstQuietTick = tick
      }
    }
    // Bounded by the number of distinct speakers, NOT by the number of ticks —
    // that is the whole property. Before the cache this was 200 reads.
    expect(reads).toBe(2)
    expect(firstQuietTick).toBe(2)
    expect(cache.size()).toBe(speakers.length)
  })
})
