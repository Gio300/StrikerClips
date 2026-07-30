/**
 * Physical merchandise economics for forged artifacts.
 *
 * Creator shares are calculated from the margin remaining after manufacturing,
 * shipping, payment processing, and a refund reserve. Paying a percentage of
 * gross revenue would let a high-cost shirt create a loss for TKO.
 */

export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const
export type TshirtSize = (typeof TSHIRT_SIZES)[number]

export type PhysicalMerchCosts = {
  salePriceCents: number
  manufacturingCents: number
  shippingCents: number
  paymentFeeCents: number
  refundReserveCents: number
}

export type PhysicalMerchSplit = PhysicalMerchCosts & {
  creatorSharePercent: number
  distributableMarginCents: number
  creatorShareCents: number
  platformShareCents: number
}

const safeCents = (value: unknown): number => {
  const cents = Number(value)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0
}

const safePercent = (value: unknown): number => {
  const percent = Number(value)
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, Math.floor(percent)))
}

export function physicalMerchSplit(
  costs: PhysicalMerchCosts,
  creatorSharePercent: number,
): PhysicalMerchSplit {
  const salePriceCents = safeCents(costs.salePriceCents)
  const manufacturingCents = safeCents(costs.manufacturingCents)
  const shippingCents = safeCents(costs.shippingCents)
  const paymentFeeCents = safeCents(costs.paymentFeeCents)
  const refundReserveCents = safeCents(costs.refundReserveCents)
  const sharePercent = safePercent(creatorSharePercent)
  const distributableMarginCents = Math.max(
    0,
    salePriceCents
      - manufacturingCents
      - shippingCents
      - paymentFeeCents
      - refundReserveCents,
  )
  const creatorShareCents = Math.floor(
    (distributableMarginCents * sharePercent) / 100,
  )

  return {
    salePriceCents,
    manufacturingCents,
    shippingCents,
    paymentFeeCents,
    refundReserveCents,
    creatorSharePercent: sharePercent,
    distributableMarginCents,
    creatorShareCents,
    platformShareCents: distributableMarginCents - creatorShareCents,
  }
}

export function minimumPhysicalPriceCents(
  costs: Omit<PhysicalMerchCosts, 'salePriceCents'>,
  minimumMarginCents: number,
): number {
  return safeCents(costs.manufacturingCents)
    + safeCents(costs.shippingCents)
    + safeCents(costs.paymentFeeCents)
    + safeCents(costs.refundReserveCents)
    + safeCents(minimumMarginCents)
}
