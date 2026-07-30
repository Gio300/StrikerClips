# TKO — Giving & Prestige Model (supersedes cash sweepstakes)

**The pivot (2026-07-20):** TKO no longer pays cash back for predictions or tournaments. It rewards **giving and prestige**, not betting and winning. No money is paid out to players. The product is a patronage, cosmetics, and reputation platform closer to creator subscriptions and a team gear shop. `docs/sweepstakes-economics.md` (cash-prize model) is **superseded** by this.

## Core idea
Users build prominent pages by **helping each other**. You gain standing by giving — supporting clans, sponsoring tournaments, sharing pages, repping teams — and by being a sharp **predictor** of which clans and tournaments will rise or fall. The reward is **prestige and badges**, not cash.

## Currencies (no cash payouts, ever)
- **Tokens** — bought utility currency. Spend on **team gear** (digital assets), profile customization, features. No cash value.
- **Sweeps / Give Points** — free points you earn and **give**: support a clan, sponsor a tournament, boost a page. Earning + giving builds prestige. Not cashable, never pays out.

## Prestige: Sponsor status + badges
A new **Sponsor** account level (Bronze → Silver → Gold → Platinum) earned by cumulative giving — prestige for the giver. Badge families (shown in chat next to name + power level, and on the PowerBar):
- **Sponsor** (giving tiers) · **Giver** — Patron (donated to a clan), Benefactor (sponsored a tournament), Herald (shared/boosted pages).
- **Oracle** — Seer / Oracle / Prophet, for accurately calling the rise & fall of clans and tournaments (prediction skill = prestige, not cash).
- **Role** — Organizer (runs tournaments), Influencer.

## Chat identity
Every chat line shows: **[badge] username · PL power**. Prestige is always visible — givers and accurate predictors carry their standing everywhere. (Built: badge system + wired into stream, tournament, clan, and reel-comment chats + the PowerBar.)

## Team digital-asset marketplace
Teams/clans **design and upload their own** digital assets (jerseys, banners, emotes). Supporters **buy them with Tokens** to rep the team. Money supports the scene and the team's prominence — no wagering. (Built: `/shop` "Team Shop" — browse, buy, My Locker, and a team upload form.)

## How clans & tournaments benefit from givers
- **Donate to a clan** → boosts the clan's page/visibility, earns you Patron/Sponsor prestige.
- **Sponsor a tournament** → funds/features it, earns Benefactor prestige and organizer goodwill.
- Organizers and influencers are surfaced via their badges.

## Legal note
Because nothing pays out cash, this is not gambling and not a sweepstakes-for-prizes. Standard consumer-purchase terms still apply (digital goods, refunds, auto-renewal disclosures). Have counsel review the Terms once, but the heavy gambling/geofencing/KYC burden of the cash model is gone.

## Still to build (next)
- Donation-to-clan + sponsor-a-tournament flows (spend Give Points → record contribution → grant prestige/badge).
- The prediction-for-prestige scoring (accuracy → Oracle badges).
- Wiring earned badges into `user_metadata.badges` server-side so they show for everyone (today the badge display is live but the earning backend is pending).
