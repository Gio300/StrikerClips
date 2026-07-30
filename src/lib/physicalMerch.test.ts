import { describe, expect, it } from 'vitest'
import {
  minimumPhysicalPriceCents,
  physicalMerchSplit,
  TSHIRT_SIZES,
} from './physicalMerch'

describe('physical merchandise economics', () => {
  it('splits only the margin left after fulfillment costs', () => {
    const split = physicalMerchSplit({
      salePriceCents: 2999,
      manufacturingCents: 1200,
      shippingCents: 500,
      paymentFeeCents: 120,
      refundReserveCents: 179,
    }, 80)

    expect(split.distributableMarginCents).toBe(1000)
    expect(split.creatorShareCents).toBe(800)
    expect(split.platformShareCents).toBe(200)
  })

  it('never creates a negative creator or platform balance', () => {
    const split = physicalMerchSplit({
      salePriceCents: 999,
      manufacturingCents: 1200,
      shippingCents: 500,
      paymentFeeCents: 80,
      refundReserveCents: 100,
    }, 80)

    expect(split.distributableMarginCents).toBe(0)
    expect(split.creatorShareCents).toBe(0)
    expect(split.platformShareCents).toBe(0)
  })

  it('calculates the minimum safe shirt price', () => {
    expect(minimumPhysicalPriceCents({
      manufacturingCents: 1200,
      shippingCents: 500,
      paymentFeeCents: 120,
      refundReserveCents: 180,
    }, 1000)).toBe(3000)
  })

  it('ships the standard first-pass T-shirt size run', () => {
    expect(TSHIRT_SIZES).toEqual(['S', 'M', 'L', 'XL', '2XL'])
  })
})
