import { describe, expect, it } from 'vitest'
import {
  CREATOR_PRICE_CENTS,
  CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
  SELLER_SHARE_PERCENT,
  cashCreatorSplit,
  creatorSplit,
  hasIncludedCreatorPass,
  isCreatorPriceCents,
  paidSweepsCreatorSplit,
  sellerExternalCostAllocation,
} from './creatorCommerce'

describe('creator commerce', () => {
  it('accepts only the approved price packages', () => {
    for (const cents of CREATOR_PRICE_CENTS) expect(isCreatorPriceCents(cents)).toBe(true)
    expect(isCreatorPriceCents(0)).toBe(false)
    expect(isCreatorPriceCents(1000)).toBe(false)
    expect(isCreatorPriceCents(19.99)).toBe(false)
  })

  it('applies the Pro, Elite, and Legend seller shares without losing a cent', () => {
    expect(SELLER_SHARE_PERCENT).toEqual({ pro: 50, supporter: 65, creator: 80 })
    expect(cashCreatorSplit(1000, 'pro').sellerShareCents).toBe(500)
    expect(cashCreatorSplit(1000, 'supporter').sellerShareCents).toBe(650)
    const legend = cashCreatorSplit(1999, 'creator')
    expect(legend).toEqual({
      listPriceCents: 1999,
      buyerChargeCents: 1999,
      discountCents: 0,
      sellerShareCents: 1599,
      platformShareCents: 400,
    })
    expect(legend.sellerShareCents + legend.platformShareCents).toBe(legend.buyerChargeCents)
  })

  it('applies the 30% paid-Sweeps discount before the membership split', () => {
    expect(paidSweepsCreatorSplit(1000, 'pro')).toEqual({
      listPriceCents: 1000,
      buyerChargeCents: 700,
      discountCents: 300,
      sellerShareCents: 350,
      platformShareCents: 350,
    })
    expect(paidSweepsCreatorSplit(1000, 'supporter').sellerShareCents).toBe(455)
    expect(paidSweepsCreatorSplit(1000, 'creator').sellerShareCents).toBe(560)
  })

  it('rounds odd-cent packages deterministically and remains balanced', () => {
    const split = creatorSplit(199, 'paid_sweeps', 'pro')
    expect(split.buyerChargeCents).toBe(139)
    expect(split.discountCents).toBe(60)
    expect(split.sellerShareCents).toBe(69)
    expect(split.platformShareCents).toBe(70)
    expect(split.sellerShareCents + split.platformShareCents).toBe(split.buyerChargeCents)
  })

  it('includes one channel pass only with the top two paid tiers', () => {
    expect(hasIncludedCreatorPass('pro')).toBe(false)
    expect(hasIncludedCreatorPass('supporter')).toBe(true)
    expect(hasIncludedCreatorPass('creator')).toBe(true)
    expect(CREATOR_ACTIVE_ACCOUNT_FEE_CENTS).toBe(200)
  })

  it('charges documented external seller costs fully to the seller', () => {
    expect(sellerExternalCostAllocation(299)).toEqual({
      totalFeeCents: 299,
      sellerFeeCents: 299,
      platformFeeCents: 0,
    })
  })
})
