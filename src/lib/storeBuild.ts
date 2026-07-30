/**
 * Store-distributed mobile builds deliberately exclude checkout for digital
 * goods, virtual currency, subscriptions, creator tips, and marketplace items.
 *
 * Existing entitlements and items remain usable. Physical merchandise may use
 * a normal card checkout because it is consumed outside the app.
 */
export const IS_MOBILE_STORE_BUILD =
  String(import.meta.env.VITE_MOBILE_STORE_BUILD ?? '').trim() === '1'

export const DIGITAL_CHECKOUT_ENABLED = !IS_MOBILE_STORE_BUILD
