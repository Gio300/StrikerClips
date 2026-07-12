/**
 * AdRoll retargeting pixel.
 *
 * Loads only when both IDs are configured (runtime or build). The pixel builds
 * retargeting audiences from the high-dwell surfaces (clip rooms, clan pages,
 * leaderboards) — that audience is what we resell against. Advertiser + pixel
 * IDs come from the AdRoll dashboard (Settings → Pixel).
 *
 * Configure via Cloud Run env (ADROLL_ADV_ID / ADROLL_PIX_ID) or .env.local
 * (VITE_ADROLL_ADV_ID / VITE_ADROLL_PIX_ID).
 */
import { ADROLL_ADV_ID, ADROLL_PIX_ID } from './runtimeConfig'

let loaded = false

export function isAdRollEnabled(): boolean {
  return Boolean(ADROLL_ADV_ID && ADROLL_PIX_ID)
}

export function initAdRoll(): void {
  if (loaded || typeof window === 'undefined' || typeof document === 'undefined') return
  if (!isAdRollEnabled()) return
  loaded = true

  const w = window as unknown as Record<string, unknown> & { adroll?: any }
  ;(w as any).adroll_adv_id = ADROLL_ADV_ID
  ;(w as any).adroll_pix_id = ADROLL_PIX_ID
  ;(w as any).adroll_version = '2.0'
  ;(w as any).__adroll_loaded = true

  const adroll: any = ((w as any).adroll = (w as any).adroll || [])
  adroll.f = ['setProperties', 'identify', 'track']
  const roundtripUrl = `https://s.adroll.com/j/${ADROLL_ADV_ID}/roundtrip.js`
  for (let a = 0; a < adroll.f.length; a++) {
    const n = adroll.f[a]
    adroll[n] =
      adroll[n] ||
      (function (fn: string) {
        return function (...args: unknown[]) {
          adroll.push([fn, args])
        }
      })(n)
  }
  const e = document.createElement('script')
  const o = document.getElementsByTagName('script')[0]
  e.async = true
  e.src = roundtripUrl
  o?.parentNode?.insertBefore(e, o)

  try {
    adroll.track('pageView')
  } catch {
    /* no-op */
  }
}

/** Track a custom event (e.g. a room join or a clan-page view) for audiences. */
export function adrollTrack(event: string, data?: Record<string, unknown>): void {
  if (!isAdRollEnabled()) return
  const adroll = (window as unknown as { adroll?: any }).adroll
  if (adroll && typeof adroll.track === 'function') {
    try {
      adroll.track(event, data)
    } catch {
      /* no-op */
    }
  }
}
