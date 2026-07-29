import { useEffect } from 'react'
import { adrollAdvId, adrollPixId } from '@/lib/adConfig'

/**
 * AdRoll Smart Pixel v2 loader.
 *
 * ─── OWNER: set your AdRoll ids (do NOT hardcode them here) ─────────────────
 *   VITE_ADROLL_ADV_ID   your AdRoll advertiser id
 *   VITE_ADROLL_PIX_ID   your AdRoll pixel id
 * Both are read via src/lib/adConfig.ts. Until BOTH are set this component
 * renders nothing and injects no script — it is completely inert.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Mount this once, high in the tree (see Layout.tsx). When both ids are present
 * it injects the standard AdRoll snippet: it sets window.adroll_adv_id /
 * adroll_pix_id / adroll_version = '2.0' and async-loads
 * https://s.adroll.com/j/<adv_id>/roundtrip.js.
 */
export function AdRollPixel() {
  useEffect(() => {
    // Inert until BOTH AdRoll ids are configured — never inject with empty ids.
    if (!adrollAdvId || !adrollPixId) return
    // Guard against a double-mount injecting the pixel twice.
    if (document.getElementById('__adroll_pixel')) return

    const w = window as unknown as {
      adroll_adv_id?: string
      adroll_pix_id?: string
      adroll_version?: string
    }
    w.adroll_adv_id = adrollAdvId
    w.adroll_pix_id = adrollPixId
    w.adroll_version = '2.0'

    const script = document.createElement('script')
    script.id = '__adroll_pixel'
    script.type = 'text/javascript'
    script.async = true
    script.src = `https://s.adroll.com/j/${adrollAdvId}/roundtrip.js`
    const first = document.getElementsByTagName('script')[0]
    if (first?.parentNode) {
      first.parentNode.insertBefore(script, first)
    } else {
      document.head.appendChild(script)
    }
  }, [])

  return null
}
