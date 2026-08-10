/**
 * Mobile-store builds use the same account data and earned entitlements as the
 * website, but must not expose web checkout, real-money competition, sideload
 * installers, or third-party advertising pixels.
 *
 * Keep the policy in one place so a release cannot accidentally enable one of
 * those surfaces by setting an unrelated provider key.
 */
export function mobileStoreBuildEnabled(value: unknown): boolean {
  return String(value ?? '').trim() === '1'
}

export function storeBuildPolicy(value: unknown) {
  const mobileStoreBuild = mobileStoreBuildEnabled(value)
  return {
    mobileStoreBuild,
    digitalCheckout: !mobileStoreBuild,
    wageringUi: !mobileStoreBuild,
    thirdPartyAdTech: !mobileStoreBuild,
    sideloadUpdates: !mobileStoreBuild,
    webPushPrompts: !mobileStoreBuild,
  } as const
}

const POLICY = storeBuildPolicy(import.meta.env.VITE_MOBILE_STORE_BUILD)

export const IS_MOBILE_STORE_BUILD = POLICY.mobileStoreBuild
export const DIGITAL_CHECKOUT_ENABLED = POLICY.digitalCheckout
export const WAGERING_UI_ENABLED = POLICY.wageringUi
export const THIRD_PARTY_AD_TECH_ENABLED = POLICY.thirdPartyAdTech
export const SIDELOAD_UPDATES_ENABLED = POLICY.sideloadUpdates
export const WEB_PUSH_PROMPTS_ENABLED = POLICY.webPushPrompts
