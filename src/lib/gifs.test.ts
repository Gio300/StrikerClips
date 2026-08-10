import { describe, expect, it } from 'vitest'
import {
  GIF_PREFIX,
  encodeGifMessage,
  gifProvider,
  gifRequestUrl,
  gifsEnabled,
  isGifMessage,
  normalizeGiphy,
  normalizeTenor,
  parseGifMessage,
  searchGifs,
} from './gifs'

const TENOR = 'https://media.tenor.com/abc123/party.gif'
const TENOR_STILL = 'https://media.tenor.com/abc123/party-still.png'
const GIPHY = 'https://media.giphy.com/media/xyz/giphy.gif'

describe('provider selection — nothing exists without a key', () => {
  it('is null with no key, so the GIF button never renders', () => {
    expect(gifProvider({})).toBeNull()
    expect(gifProvider({ tenor: '', giphy: '' })).toBeNull()
    expect(gifProvider({ tenor: '   ' })).toBeNull()
    expect(gifsEnabled(null)).toBe(false)
  })

  it('prefers Tenor when both keys are set (one attribution, not two)', () => {
    expect(gifProvider({ tenor: 't', giphy: 'g' })?.id).toBe('tenor')
    expect(gifProvider({ giphy: 'g' })?.id).toBe('giphy')
  })

  it('searchGifs resolves to [] with no provider — chat is never affected', async () => {
    await expect(searchGifs('cat', { provider: null })).resolves.toEqual([])
  })
})

describe('request safety parameters', () => {
  /** A 13+ audience (src/lib/age.ts MIN_AGE_YEARS) is not where you relax this. */
  it('asks each network for its strictest content rating', () => {
    const tenor = gifRequestUrl({ id: 'tenor', key: 'k', label: 'Tenor' }, 'cat')
    expect(tenor).toContain('contentfilter=high')
    expect(tenor).toContain('q=cat')
    const giphy = gifRequestUrl({ id: 'giphy', key: 'k', label: 'GIPHY' }, 'cat')
    expect(giphy).toContain('rating=pg-13')
  })

  it('falls back to the trending endpoint when the query is empty', () => {
    expect(gifRequestUrl({ id: 'tenor', key: 'k', label: 'Tenor' }, '')).toContain('/v2/featured')
    expect(gifRequestUrl({ id: 'giphy', key: 'k', label: 'GIPHY' }, '')).toContain('/gifs/trending')
  })
})

describe('encode / parse round trip', () => {
  it('round-trips a full GIF', () => {
    const body = encodeGifMessage({ url: TENOR, poster: TENOR_STILL, width: 200, height: 150, alt: 'party' })
    expect(body.startsWith(GIF_PREFIX)).toBe(true)
    expect(parseGifMessage(body)).toEqual({
      url: TENOR, poster: TENOR_STILL, width: 200, height: 150, alt: 'party',
    })
    expect(isGifMessage(body)).toBe(true)
  })

  it('survives a missing poster and missing dimensions', () => {
    const parsed = parseGifMessage(encodeGifMessage({ url: GIPHY }))
    expect(parsed?.url).toBe(GIPHY)
    expect(parsed?.poster).toBe('')
    expect(parsed?.width).toBe(0)
    expect(parsed?.alt).toBe('GIF')
  })

  it('strips the delimiters out of alt text so a title cannot break the encoding', () => {
    const body = encodeGifMessage({ url: TENOR, alt: 'a|b]]c\nd' })
    expect(parseGifMessage(body)?.url).toBe(TENOR)
    expect(parseGifMessage(body)?.alt).not.toContain('|')
  })
})

/**
 * THE SECURITY STORY. stripLeadingMarkers() guards the START of a user line, but
 * a GIF marker IS the whole line — so anyone can type one. The renderer, not the
 * composer, is the gate: parseGifMessage only ever returns an https URL on an
 * allowlisted provider host, so a forged marker can embed a Tenor/Giphy asset
 * and nothing else. Everything below falls through to plain text.
 */
describe('a forged marker cannot embed anything but a provider asset', () => {
  const FORGERIES = [
    `${GIF_PREFIX}1x1|https://evil.example.com/track.gif|||]]`,
    `${GIF_PREFIX}1x1|http://media.tenor.com/x.gif|||]]`,          // not https
    `${GIF_PREFIX}1x1|javascript:alert(1)|||]]`,
    `${GIF_PREFIX}1x1|data:image/gif;base64,R0lGOD|||]]`,
    `${GIF_PREFIX}1x1|https://media.tenor.com.attacker.net/x.gif|]]`, // suffix trick
    `${GIF_PREFIX}1x1|//media.tenor.com/x.gif|]]`,
    `${GIF_PREFIX}nonsense]]`,
  ]

  it('returns null for every off-allowlist or malformed payload', () => {
    for (const body of FORGERIES) {
      expect(parseGifMessage(body), body).toBeNull()
      expect(isGifMessage(body), body).toBe(false)
    }
  })

  it('refuses to ENCODE an off-allowlist host rather than posting an unrenderable body', () => {
    expect(() => encodeGifMessage({ url: 'https://evil.example.com/x.gif' })).toThrow()
    expect(() => encodeGifMessage({ url: '' })).toThrow()
  })

  it('drops an off-allowlist POSTER while keeping a legitimate GIF', () => {
    const body = encodeGifMessage({ url: TENOR, poster: 'https://tracker.example.com/p.png' })
    expect(parseGifMessage(body)?.poster).toBe('')
  })

  it('only treats the WHOLE body as a GIF — a marker with text around it is text', () => {
    const inner = encodeGifMessage({ url: TENOR })
    expect(parseGifMessage(`look at this ${inner}`)).toBeNull()
    expect(parseGifMessage(`${inner} lol`)).toBeNull()
    expect(parseGifMessage('just a normal message')).toBeNull()
    expect(parseGifMessage('')).toBeNull()
    // Whitespace around the whole marker is fine.
    expect(parseGifMessage(`  ${inner}  `)?.url).toBe(TENOR)
  })

  it('never throws on hostile input', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(parseGifMessage(v as unknown as string)).toBeNull()
    }
  })
})

describe('provider payload normalization is total — malformed rows are dropped, never thrown', () => {
  it('reads a Tenor v2 response', () => {
    const hits = normalizeTenor({
      results: [
        {
          id: '1',
          content_description: 'cat party',
          media_formats: {
            tinygif: { url: TENOR, dims: [200, 150] },
            tinygifpreview: { url: TENOR_STILL },
          },
        },
        { id: '2', media_formats: { tinygif: { url: 'https://evil.example.com/x.gif' } } },
        { id: '3' },
        'garbage',
      ],
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ url: TENOR, poster: TENOR_STILL, width: 200, height: 150, alt: 'cat party' })
  })

  it('reads a Giphy v1 response', () => {
    const hits = normalizeGiphy({
      data: [
        {
          id: 'g1',
          title: 'dance',
          images: {
            fixed_height_small: { url: GIPHY, width: '100', height: '80' },
            fixed_height_small_still: { url: 'https://media.giphy.com/media/xyz/still.gif' },
          },
        },
        { id: 'g2', images: {} },
      ],
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ url: GIPHY, width: 100, height: 80, alt: 'dance' })
  })

  it('returns [] for anything that is not a response', () => {
    for (const v of [null, undefined, {}, { results: 'nope' }, { data: 5 }, 'x']) {
      expect(normalizeTenor(v)).toEqual([])
      expect(normalizeGiphy(v)).toEqual([])
    }
  })
})

describe('searchGifs degrades quietly', () => {
  const provider = { id: 'tenor' as const, key: 'k', label: 'Tenor' }

  it('returns [] on a non-ok response', async () => {
    const hits = await searchGifs('cat', {
      provider,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    })
    expect(hits).toEqual([])
  })

  it('returns [] when the network throws', async () => {
    const hits = await searchGifs('cat', {
      provider,
      fetchImpl: async () => { throw new Error('offline') },
    })
    expect(hits).toEqual([])
  })

  it('returns normalized hits on success', async () => {
    const hits = await searchGifs('cat', {
      provider,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ results: [{ id: '1', media_formats: { tinygif: { url: TENOR, dims: [10, 10] } } }] }),
      }),
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].url).toBe(TENOR)
  })
})
