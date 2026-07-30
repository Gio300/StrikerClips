import { callFn } from '@/lib/backend'

/**
 * Client helper for reporting a Shinobi Conquest battle result to the server.
 *
 * A verified battle outcome (a found-video match or a decided scheduled match)
 * calls this; the server (`/fn/conquest-battle`) applies the rivalry rules,
 * moves the territory when the win earns it, and tells us whether land was
 * captured — so the caller can fire the "New land unlocked" celebration.
 *
 * Reporting is authorized server-side to a member of the WINNING clan, so this
 * can't be used to hand yourself someone else's land.
 */
export interface ConquestBattleReport {
  winnerClanId: string
  loserClanId?: string | null
  territoryId: string
  /** Dedupe key (the match id) so one battle never counts twice. */
  matchKey?: string | null
}

export interface ConquestBattleOutcome {
  ok: boolean
  recorded: boolean
  captured: boolean
  territoryId: string
  ownerClanId: string | null
  marginToCapture: number
  reason: string
}

export async function reportConquestBattle(input: ConquestBattleReport): Promise<ConquestBattleOutcome | null> {
  try {
    const res = (await callFn('conquest-battle', {
      winnerClanId: input.winnerClanId,
      loserClanId: input.loserClanId ?? null,
      territoryId: input.territoryId,
      matchKey: input.matchKey ?? null,
    })) as ConquestBattleOutcome | null
    return res ?? null
  } catch {
    return null
  }
}
