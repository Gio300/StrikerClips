/**
 * Creator-commerce money rules.
 *
 * All values are integer USD cents. Keeping the arithmetic here pure makes the
 * browser preview, API validation, webhook fulfilment, and audit tests agree.
 *
 * Free Give Points (`wallets.sweeps`) are deliberately absent. Only paid,
 * dollar-backed Sweeps Credits may use the discounted marketplace path.
 */

export const CREATOR_PRICE_CENTS = [
  199,
  299,
  499,
  999,
  1499,
  1999,
  2999,
  4999,
  9999,
] as const

export const PAID_SWEEPS_DISCOUNT_PERCENT = 30
export const CREATOR_ACTIVE_ACCOUNT_FEE_CENTS = 200
export const EXTERNAL_COST_SELLER_PERCENT = 100

export type CreatorSellerTier = 'pro' | 'supporter' | 'creator'

export const SELLER_SHARE_PERCENT: Record<CreatorSellerTier, number> = {
  pro: 50,
  supporter: 65,
  creator: 80,
}

export type CreatorPaymentMethod = 'cash' | 'paid_sweeps'

export type CreatorSplit = {
  listPriceCents: number
  buyerChargeCents: number
  discountCents: number
  sellerShareCents: number
  platformShareCents: number
}

export function normalizeCents(value: unknown): number {
  const cents = Number(value)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0
}

export function isCreatorPriceCents(value: unknown): boolean {
  const cents = normalizeCents(value)
  return (CREATOR_PRICE_CENTS as readonly number[]).includes(cents)
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(normalizeCents(cents) / 100)
}

/**
 * The active seller membership sets the creator share. TKO's retained share is
 * before Stripe fees, refunds, disputes, chargebacks, and taxes.
 */
export function sellerSharePercent(tier: string | null | undefined): number {
  return SELLER_SHARE_PERCENT[tier as CreatorSellerTier] ?? 0
}

/** Elite and Legend each receive one basic creator-channel pass per month. */
export function hasIncludedCreatorPass(tier: string | null | undefined): boolean {
  return tier === 'supporter' || tier === 'creator'
}

/**
 * Allocate documented third-party seller costs. The seller reimburses the
 * platform for 100% of Stripe processing, payout, active-account, and
 * information-return filing costs. This is never the seller's income-tax
 * liability, customer sales tax, or TKO's corporate income tax.
 */
export function sellerExternalCostAllocation(totalFeeCents: number): {
  totalFeeCents: number
  sellerFeeCents: number
  platformFeeCents: number
} {
  const total = normalizeCents(totalFeeCents)
  const seller = Math.floor((total * EXTERNAL_COST_SELLER_PERCENT) / 100)
  return {
    totalFeeCents: total,
    sellerFeeCents: seller,
    platformFeeCents: total - seller,
  }
}
export function cashCreatorSplit(
  listPriceCents: number,
  sellerTier: CreatorSellerTier = 'creator',
): CreatorSplit {
  const list = normalizeCents(listPriceCents)
  const seller = Math.floor((list * sellerSharePercent(sellerTier)) / 100)
  return {
    listPriceCents: list,
    buyerChargeCents: list,
    discountCents: 0,
    sellerShareCents: seller,
    platformShareCents: list - seller,
  }
}

/**
 * Paid Sweeps Credits purchase: the buyer pays 70% of list price, then the
 * seller's membership share is applied to that discounted value.
 *
 * Legend example: $10.00 list -> $7.00 credits -> $5.60 seller / $1.40 TKO.
 */
export function paidSweepsCreatorSplit(
  listPriceCents: number,
  sellerTier: CreatorSellerTier = 'creator',
): CreatorSplit {
  const list = normalizeCents(listPriceCents)
  const buyer = Math.round((list * (100 - PAID_SWEEPS_DISCOUNT_PERCENT)) / 100)
  const seller = Math.floor((buyer * sellerSharePercent(sellerTier)) / 100)
  return {
    listPriceCents: list,
    buyerChargeCents: buyer,
    discountCents: list - buyer,
    sellerShareCents: seller,
    platformShareCents: buyer - seller,
  }
}

export function creatorSplit(
  listPriceCents: number,
  method: CreatorPaymentMethod,
  sellerTier: CreatorSellerTier = 'creator',
): CreatorSplit {
  return method === 'paid_sweeps'
    ? paidSweepsCreatorSplit(listPriceCents, sellerTier)
    : cashCreatorSplit(listPriceCents, sellerTier)
}
