/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ThemeStorage } from './broadcastTheme'

// The Studio chat's AI path (applyChatIntentAI) POSTs to the league-studio-chat
// server fn through `callFn`. We stub `./backend` so the whole client round trip
// runs offline: steer what the "server" returns via `serverResponse`, then
// assert the client merges + RE-SANITIZES it (belt and braces) before it ever
// touches the draft. The server half (Vertex stubbed) is proven separately in
// server/leagueStudioChat.test.ts.
let serverResponse: any = null

vi.mock('./backend', () => ({
  backend: async () => null,
  callFn: async (_name: string, _body: any = {}) => serverResponse,
}))

import {
  applyChatIntentAI,
  applyLogoDataUrl,
  DEFAULT_LEAGUE_CONFIG,
  isImageFile,
  loadLeagueDraft,
  matchingPalettePreset,
  PALETTE_PRESETS,
} from './leagueConfig'

const base = { ...DEFAULT_LEAGUE_CONFIG, colors: { ...DEFAULT_LEAGUE_CONFIG.colors } }

/** A Map-backed ThemeStorage so the draft round-trips with no real DOM/localStorage. */
function fakeStorage(): ThemeStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop → logo: the drop target reads the image (browser FileReader)
// then hands the data URL to applyLogoDataUrl, the shared setter. This proves
// the APPLY half — a dropped logo lands on the draft's logoUrl and survives a
// reload from storage.
// ---------------------------------------------------------------------------

describe('logo drop-to-apply', () => {
  it('isImageFile accepts image files and rejects the rest', () => {
    expect(isImageFile({ type: 'image/png' } as unknown as File)).toBe(true)
    expect(isImageFile({ type: 'image/jpeg' } as unknown as File)).toBe(true)
    expect(isImageFile({ type: 'text/plain' } as unknown as File)).toBe(false)
    expect(isImageFile({ type: '' } as unknown as File)).toBe(false)
    expect(isImageFile(null)).toBe(false)
    expect(isImageFile(undefined)).toBe(false)
  })

  it('applyLogoDataUrl writes the logo onto the shared draft', () => {
    const storage = fakeStorage()
    const dataUrl = 'data:image/png;base64,AAAA'
    const next = applyLogoDataUrl(dataUrl, storage)
    expect(next.logoUrl).toBe(dataUrl)
    // And it persisted — a fresh load (the "reload") still has it.
    expect(loadLeagueDraft(storage).logoUrl).toBe(dataUrl)
  })
})

// ---------------------------------------------------------------------------
// Chat patch round trip (server fn mocked). The mockup's chat loop:
// clicked-part context + draft → server patch → client re-sanitizes → draft.
// ---------------------------------------------------------------------------

describe('applyChatIntentAI — chat patch round trip', () => {
  beforeEach(() => {
    serverResponse = null
  })

  it('applies a valid AI color patch, merged over the current colors', async () => {
    serverResponse = { ok: true, reply: 'Gold accent, done.', patch: { colors: { accent: 'FFB63D' } } }
    const res = await applyChatIntentAI(base, 'make the accent gold')
    expect(res.source).toBe('ai')
    expect(res.reply).toBe('Gold accent, done.')
    expect(res.patch?.colors?.accent).toBe('#ffb63d')
    // Other slots are carried over (merge, not replace).
    expect(res.patch?.colors?.primary).toBe(base.colors.primary)
  })

  it('RE-SANITIZES a hostile/stale server patch — nothing structural survives', async () => {
    serverResponse = {
      ok: true,
      reply: 'Upgraded you to enterprise!',
      patch: { tier: 'enterprise', slug: 'evil', domain: 'evil.example', name: 'Blaze League' },
    }
    const res = await applyChatIntentAI(base, 'give me enterprise and a new domain')
    expect(res.source).toBe('ai')
    // Only the whitelisted name survives; tier/slug/domain are dropped client-side.
    expect(res.patch).toEqual({ name: 'Blaze League' })
    expect(JSON.stringify(res.patch)).not.toMatch(/enterprise|evil/)
  })

  it('honors click-to-reference part scoping (server over-answers, client clamps)', async () => {
    serverResponse = {
      ok: true,
      reply: 'Tagline set.',
      patch: { tagline: 'rise and grind', colors: { primary: '#000000' }, name: 'Sneaky' },
    }
    const res = await applyChatIntentAI(base, 'rise and grind', 'tagline')
    expect(res.patch).toEqual({ tagline: 'rise and grind' })
  })

  it('falls back to the LOCAL matcher when the server is unreachable', async () => {
    serverResponse = null // callFn resolves null → "we never reached the server"
    const res = await applyChatIntentAI(base, 'make the accent gold')
    expect(res.source).toBe('local')
    expect(res.patch?.colors?.accent).toBe('#f5c542') // local COLOR_NAMES gold
  })

  it('falls back to LOCAL on an ok:false (server outage/rate-limit) response', async () => {
    serverResponse = { ok: false, error: 'vertex 500' }
    const res = await applyChatIntentAI(base, 'call it Blaze League')
    expect(res.source).toBe('local')
    expect(res.patch?.name).toBe('Blaze League')
  })
})

// ---------------------------------------------------------------------------
// ONE-TAP PALETTES — the fast lane's whole color step (operator 2026-08-04:
// "they could just drop branding and go"). A preset has to be a complete,
// valid skin, and the picker has to be able to tell which one is selected.
// ---------------------------------------------------------------------------

describe('leagueConfig — palette presets', () => {
  it('every preset is a complete, valid three-slot skin', () => {
    expect(PALETTE_PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const p of PALETTE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      for (const hex of [p.colors.primary, p.colors.secondary, p.colors.accent]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
      // A preset with two identical slots produces a flat, dead-looking skin.
      const slots = new Set([p.colors.primary, p.colors.secondary, p.colors.accent])
      expect(slots.size).toBe(3)
    }
  })

  it('has unique ids and unique looks', () => {
    const ids = new Set(PALETTE_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(PALETTE_PRESETS.length)
    const looks = new Set(PALETTE_PRESETS.map((p) => JSON.stringify(p.colors)))
    expect(looks.size).toBe(PALETTE_PRESETS.length)
  })

  it('never touches the ink slot (that is derived per surface, not chosen)', () => {
    for (const p of PALETTE_PRESETS) {
      expect(Object.keys(p.colors).sort()).toEqual(['accent', 'primary', 'secondary'])
    }
  })

  it('matches the preset a config is currently wearing', () => {
    for (const p of PALETTE_PRESETS) {
      const cfg = { ...base.colors, ...p.colors }
      expect(matchingPalettePreset(cfg)?.id).toBe(p.id)
    }
    expect(matchingPalettePreset({ ...base.colors, primary: '#123456' })).toBeNull()
  })

  it('the untouched TKO draft already wears a preset (so a chip reads selected)', () => {
    expect(matchingPalettePreset(DEFAULT_LEAGUE_CONFIG.colors)).not.toBeNull()
  })
})
