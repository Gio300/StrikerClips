import { useEffect } from 'react'
import { adrollAdvId, adrollPixId } from '@/lib/adConfig'
import { useAdsHidden } from '@/hooks/useAdsHidden'
import { THIRD_PARTY_AD_TECH_ENABLED } from '@/lib/storeBuild'

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
 *
 * ENTITLEMENT: "gets rid of ads" has to mean the AD TECH too, not just the
 * boxes. A retargeting pixel on a subscriber is the same product promise
 * broken, one layer down — and unlike a rendered slot they cannot even see it
 * to complain. So this waits for useAdsHidden() to resolve and never injects
 * for anyone entitled to ad-free, from either ladder.
 */
export function AdRollPixel() {
  const { adsHidden, resolved } = useAdsHidden()

  useEffect(() => {
    if (!THIRD_PARTY_AD_TECH_ENABLED) return
    // Inert until BOTH AdRoll ids are configured — never inject with empty ids.
    if (!adrollAdvId || !adrollPixId) return
    // Never retarget someone who paid not to be advertised at, and never guess:
    // hold until the entitlement is known. Injection is irreversible.
    if (!resolved || adsHidden) return
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
  }, [adsHidden, resolved])

  return null
}
