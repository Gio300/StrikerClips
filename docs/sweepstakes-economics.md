# KillCam Sweepstakes Economics — 60/40 Fixed-Prize Model

The money model for predictions/tournaments. Built so the math settles at **platform keeps ~60%, distributes ~40% as prize value** across many games — via fixed guaranteed prizes, never a percentage rake on a match. (This structure needs attorney sign-off before going live — see `terms-and-conditions-DRAFT.md`. Not legal advice.)

## Core constants
- **1 Sweeps Point = $0.01 USD** (100 points = $1.00 cash redemption value). Static baseline.
- **Tokens** = bought utility currency, **no cash value**, never redeemable.
- **Sweeps Points** = free promotional bonus + free daily grants; the only thing redeemable for prizes.

## Rule 1 — Package point allocation (front-end margin)
Free bonus Sweeps Points per pack = **40% of the cash price**:

`bonusSweeps = round(priceUsd × 0.40 / 0.01) = priceUsd × 40`

| Pack | Price | Tokens (utility) | Bonus Sweeps | Sweeps cash value | Platform keeps |
|------|-------|------------------|--------------|-------------------|----------------|
| Starter | $0.99 | 100 | 40 | $0.40 | $0.59 (60%) |
| Plus | $4.99 | 550 | 200 | $2.00 | $2.99 (60%) |
| Pro | $9.99 | 1,200 | 400 | $4.00 | $5.99 (60%) |
| Mega | $19.99 | 3,000 | 800 | $8.00 | $11.99 (60%) |

*(Fixed in the Store — the earlier draft over-allocated, e.g. 1,500 pts on $9.99 = $15 of prize value on a $10 sale, which loses money if a top player sweeps the points.)*

## Rule 2 — Tournament fixed guaranteed prizes
Prize pool is a **static, guaranteed** amount (paid regardless of entrant count), sized to ~40% of the expected full-entry points:

`guaranteedPrizePoints = (targetEntrants × entryCostPoints) × 0.40`

Example — 10-player match, 100-point entry:
- Total if full: 10 × 100 = 1,000 points entered
- Guaranteed prize: 1,000 × 0.40 = **400 points** (= $4.00) to the winner
- **Never scales down** if fewer play (pay the full 400 even at 2 players) — this is what keeps it a legal sweepstakes, not pari-mutuel betting.
- The **~600 "burned" points** per full match leave the ecosystem, so players rebuy packs → captures the 60% front-end margin again.

## Rule 3 — What you must NOT do (keeps it legal)
- No "winner gets 80% of the pool" / dynamic pooling → looks like pari-mutuel gambling.
- Prizes stay **fixed and stated upfront** per tournament tier.
- Always offer a **free method of entry** (daily bonus Sweeps Points) so no purchase is necessary.
- Geofence excluded states; age + ID verify on redemption.

## Suggested tournament prize tiers (config-ready)
| Tier | Entry (Sweeps) | Target entrants | Guaranteed prize (Sweeps) | Cash value |
|------|----------------|-----------------|---------------------------|-----------|
| Skirmish | 100 | 10 | 400 | $4 |
| Clash | 250 | 10 | 1,000 | $10 |
| Showdown | 500 | 10 | 2,000 | $20 |
| Championship | 1,000 | 16 | 6,400 | $64 |

## Next build step
A `tournamentPrizeTiers` config (JSON/TS) linking each tournament to a fixed entry cost + guaranteed prize, wired into tournament creation, plus a **daily free bonus Sweeps Points** grant to satisfy the no-purchase-necessary requirement. Redemption + payouts run on Stripe Connect (creator/prize payouts) once the backend billing is wired.
