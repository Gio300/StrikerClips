export type PrizePoolCurrency = 'sweeps' | 'cash'

export const DEFAULT_PRIZE_SPLIT_BPS = [7000, 2000, 1000] as const
export const PRIZE_SPLIT_TOTAL_BPS = 10_000

export type PrizePlacement = {
  placement: number
  amount: number
}

/**
 * Split an integer prize pool without minting or losing a unit.
 *
 * Floors are assigned first. Any leftover units are handed out in placement
 * order, which makes the result deterministic and keeps first place favored.
 */
export function splitPrizePool(
  total: number,
  splitBps: readonly number[] = DEFAULT_PRIZE_SPLIT_BPS,
  placementCount = splitBps.length,
): PrizePlacement[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Prize total must be a non-negative safe integer.')
  }
  if (!Number.isSafeInteger(placementCount) || placementCount < 1) {
    throw new Error('At least one placement is required.')
  }

  const active = splitBps.slice(0, placementCount)
  if (active.length !== placementCount) {
    throw new Error('A split is required for every paid placement.')
  }
  if (
    active.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    active.reduce((sum, value) => sum + value, 0) !== PRIZE_SPLIT_TOTAL_BPS
  ) {
    throw new Error('Prize splits must be non-negative integers totaling 10,000 basis points.')
  }

  const placements = active.map((bps, index) => ({
    placement: index + 1,
    amount: Math.floor((total * bps) / PRIZE_SPLIT_TOTAL_BPS),
  }))
  let remainder = total - placements.reduce((sum, item) => sum + item.amount, 0)
  for (let index = 0; remainder > 0; index = (index + 1) % placements.length) {
    placements[index].amount += 1
    remainder -= 1
  }
  return placements
}

/**
 * Split an integer prize pool EVENLY across `winnerCount` placements without
 * minting or losing a unit — the tie-split used when a tournament hits its end
 * time with multiple leaders. Every amount differs by at most 1; the leftover
 * units go to the earliest placements so the result is deterministic.
 *
 * (Not expressible through splitPrizePool's basis points: rounding bps like
 * [3334,3333,3333] drifts amounts apart by far more than one unit on large
 * pots, which would violate "split evenly".)
 */
export function splitPrizePoolEvenly(total: number, winnerCount: number): PrizePlacement[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Prize total must be a non-negative safe integer.')
  }
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 1) {
    throw new Error('At least one winner is required.')
  }
  const base = Math.floor(total / winnerCount)
  const remainder = total - base * winnerCount
  return Array.from({ length: winnerCount }, (_, index) => ({
    placement: index + 1,
    amount: base + (index < remainder ? 1 : 0),
  }))
}

export function parsePrizeSplitBps(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return []
          }
        })()
      : []
  if (!Array.isArray(raw)) return []
  return raw.map(Number)
}
