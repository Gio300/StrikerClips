# TKO — Economy, Chat, Clans & Villages (authoritative design)

Single source of truth for the social + economic layer of TKO (tko.cam): **Chat spaces,
Clans, Villages, the two-currency economy, the Artifact system, and the give-back
engine (clan/village month grants + the Orb of Osuvox).** It reconciles with the code
already shipped — `src/lib/tiers.ts`, `wallet.ts`, `assets.ts`, `badges.ts`,
`predictions.ts`, `ledger.ts`, `entitlements.ts`, `payments.ts` and `db/schema.sql` —
and with `docs/money-model.md`, `docs/giving-and-prestige.md`,
`docs/sweepstakes-economics.md`, `docs/build-plan.md`.

Where the founder left a number open, this doc **picks a value and shows the math**. All
numbers are config-ready and editable; none of this is legal advice (the sweeps/prize
layer still needs counsel sign-off per `terms-and-conditions-DRAFT.md`).

---

## 0. First principles (what stays true everywhere)

1. **Two currencies, never conflated** (mirrors `wallet.ts`):
   - **Tokens** = prepaid utility credit the user **buys from TKO**. This is the *medium
     of exchange* — you pay for everything in Tokens (artifacts, clan join/dues,
     subscriptions to user offerings). Never cashable.
   - **Sweeps** = the *value / prize* currency. It measures what an Artifact is *worth*,
     and it's what giveaways, milestone rewards and special artifacts **grant**. Earned
     free (daily bonus, milestones, wins), never sold directly, prize-redeemable only
     where legal.
2. **Platform fee = 20%.** TKO takes 20% of every user→user money-moving action (clan
   fees/dues, subscriptions to user offerings, marketplace artifact sales). **TKO
   subscription tiers and official TKO artifacts are 100% TKO.**
3. **Entitlements are the settlement layer.** Anything that "grants a membership" writes
   through the *same* mechanism redeem codes already use (`reelone_tier` +
   `reelone_tier_expires`, see `entitlements.ts`) — extended with a `grants` overlay so a
   clan/village-wide grant doesn't have to rewrite 100 user records.
4. **Prestige, not payouts.** Consistent with `giving-and-prestige.md`: nothing here pays
   cash to a user. Sweeps buy *standing and perks*, not money.

### Pegs & constants (config)

| Constant | Value | Source / rationale |
|---|---|---|
| `1 Sweep` | **$0.01** | fixed baseline (`sweepstakes.ts` `POINT_VALUE_USD`) |
| `1 Token` (face) | **$0.01** | matches the no-bonus Starter pack (100 tokens / $0.99 ≈ 1¢); used for all split & payout accounting |
| Token pack bonuses | up to ~50% | volume discount on big packs = a **marketing cost**, not a change to the 1¢ face used for splits |
| `PLATFORM_FEE` | **0.20** | founder spec |
| Membership retail / mo | ad_free **$1.99**, Pro **$4.99**, Elite **$9.99**, Legend **$29.99** | `money-model.md` / `tiers.ts` |
| Tier keys ↔ names | `''`=Free, `ad_free`, `pro`=Pro, `supporter`=Elite, `creator`=Legend | `tiers.ts` (unchanged) |

> **Why Token face = Sweep = $0.01.** Keeping both at 1¢ makes every split, payout and
> give-back computation a clean multiply, and it's the rate at which Stripe Connect pays
> creators out of the token pool (§3). Bonus tokens on large packs mean TKO collected
> *less* than 1¢/token in cash on those — that gap is a customer-acquisition cost, and
> §3 notes the conservative handling so a payout can never exceed cash actually received.

---

## 1. When Tokens vs Sweeps are used (the rule that removes all ambiguity)

| Situation | Currency | Why |
|---|---|---|
| Buy anything (artifact, clan join fee, dues, subscribe to a user's tournament/clan) | **Tokens** | Tokens are the spend rail |
| Buy a TKO membership tier | **Cash (Stripe)** | Subscriptions are real recurring billing, not token spend |
| An Artifact's stated *worth* / power rating | **Sweeps** | Sweeps is the unit of value |
| Giveaways, daily bonus, milestone rewards, Orb grant | **Sweeps** (+ entitlement) | Prize/value layer |
| Predictions (Oracle) reward | cosmetic Artifact + badge progress | no currency (see `predictions.ts`) |

Mnemonic: **you *pay* in Tokens; things are *worth*, and prizes *pay out*, in Sweeps.**

---

## 2. The split table (every money-moving action)

`PLATFORM_FEE = 20%`. "Creator/Clan share" is credited to that party's **payout balance**
(withdrawable via Stripe Connect once KYC'd — `build-plan.md` M3); TKO share is recognized
revenue.

| Action | Paid in | Creator / Clan share | TKO share | Notes |
|---|---|---:|---:|---|
| **Join a clan (one-time fee)** | Tokens | **80%** | **20%** | Clan share → clan treasury |
| **Recurring clan dues** | Tokens | **80%** | **20%** | Charged monthly to `dues_period` |
| **Subscribe to a user's tournament / clan / offering** | Tokens | **80%** | **20%** | Recurring; same split as dues |
| **Buy a user-made Artifact (primary sale)** | Tokens | **80%** creator | **20%** | Marketplace-routed (§6) |
| **Buy a user-made Artifact (resale)** | Tokens | **80%** seller | **20%** | *Optional* 10% original-creator royalty is taken **out of the seller's 80%** (seller nets 70%, creator 10%, TKO 20%) — config flag `royaltyPct` |
| **Buy an official TKO Artifact** (clan pack, Orb, TKO-shop item) | Tokens | — | **100%** | TKO is the seller |
| **Subscribe to a TKO tier** (ad_free / Pro / Elite / Legend) | Cash | — | **100%** | "Higher-tier TKO subscriptions go 100% to TKO" |
| **Buy a Token pack** | Cash | — | **100%** (− Stripe) | Front-end margin; bonus tokens = marketing cost |
| **Daily free Sweeps / giveaway / milestone grant** | — | — | — | No money moves (Sweeps only) |

**Stripe fee handling.** Real-cash flows (token packs, TKO subs, and any true creator
*cash* payout) carry Stripe's ~2.9% + 30¢, taken **off the top before the split**
(`money-model.md`). In-app **Token** spends carry **no** per-transaction Stripe fee — the
cash was already collected once at pack purchase. This is a real advantage of routing
dues/subs/marketplace through Tokens: only one Stripe touch per user, at top-up.

---

## 3. Payout-safety note (so TKO never pays out more than it took)

Because big token packs sell tokens below 1¢ face, TKO must not let clan/creator payouts
exceed cash received. Rule: **payout balances accrue at token face (1¢), but a payout can
never exceed `cash_received_for_tokens_spent`.** Implementation: track a running
`tko_cash_realized` per token top-up (actual USD ÷ tokens granted = the *real* cents/token
for that batch); when tokens are spent, the payee's withdrawable USD is credited at the
*spender's realized rate*, capped at 1¢. In practice this is ≤1¢/token and self-protects.
For v1 (pre-Connect) all shares are bookkeeping entries in `platform_ledger`; no USD leaves
until Connect + KYC are live.

---

## 4. Chat: Spaces → Categories → Channels → Messages/Threads

A "chat" is **not one room** — it's a **Space** (Discord-server-like) that contains a
**main channel** plus grouped channel areas. This maps cleanly onto the existing
`servers` + `channels` + `messages` tables — a Space **is** a `servers` row.

### 4.1 Data model

```
Space (servers row)
 ├─ kind: 'clan' | 'open' | 'official'
 ├─ visibility: 'public' | 'private'
 ├─ Category (server_categories)        e.g. "INFO", "WAR ROOM", "OFF-TOPIC"
 │   └─ Channel (channels)              type: text | clips | announcement | voice
 │       └─ Message (messages)
 │           └─ Thread (messages.parent_message_id)   ← lightweight threads
 └─ Members (server_members) w/ rank & permissions
```

- **Categories** are new (`server_categories`): a `channels.category_id` groups channels
  into Discord-like areas. The **main chat** is the default channel flagged
  `is_default = true`.
- **Threads** are `messages.parent_message_id` (self-FK) — no new table needed; a reply
  under a root message forms a thread. Keeps the model small.

### 4.2 The three Space kinds

| Kind | Who owns it | Visibility | Who can read | Who can post / create channels |
|---|---|---|---|---|
| **Clan** | a clan (its `server_id`) | `private` (members) or `public` (read-only preview) | members; public preview shows main channel read-only to non-members | rank-gated (§5.2) — post = Member+, create channel = Officer+ |
| **Open** | any user (creator = owner) | `public` | anyone signed in | owner sets: anyone / followers / approved; owner + mods create channels |
| **Official (TKO chats)** | TKO (platform) | `public` | everyone (incl. logged-out read on some) | **post:** everyone in community channels, TKO-staff-only in announcement channels; **create channel:** TKO staff only |

- **Clan vs Open:** a clan Space is bound to a clan entity (dues, 100-member cap, ranks);
  an Open Space is a free-standing public community with no membership economy — its
  "join" is just a follow, no fee.
- **TKO-official** is seeded like today's `KillCam Community` server (`schema.sql` seed):
  `#announcements` (staff-post), `#general`, `#find-a-clan` (feeds Clan Discovery §5.3),
  `#tournaments`, `#help`.

### 4.3 Posting permission resolution

`canPost(space, channel, member)` = `space.kind` rule **∩** `channel.min_rank` (clan) or
`channel.post_policy` (open/official). Announcement channels are always
`min_rank='officer'` (clan) or staff-only (official). Free users **can** use clans & chat
(it's a `FREE_FEATURES` item in `tiers.ts` — do not gate basic chat behind a tier).

---

## 5. Clans

A clan is a `servers` row (`kind='clan'`) with an economy attached. Extends the existing
`servers` (has `clan_tag`, `owner_id`, `join_mode`, `total_points`) + `server_members`.

### 5.1 Clan config (new columns on `servers`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `max_members` | int | **100** | hard cap (founder spec) |
| `is_recruiting` | bool | false | shows in Discovery |
| `join_fee_tokens` | int | 0 | one-time fee to join (0 = free) |
| `dues_tokens` | int | 0 | recurring dues amount |
| `dues_period` | text | 'none' | 'none' \| 'monthly' |
| `rules` | text | null | clan-set rules (shown on join) |
| `village_id` | uuid | null | village this clan belongs to (§6) |
| `treasury_tokens` | int | 0 | accrued 80% clan share |

### 5.2 Ranks & duties (permission matrix)

`server_members.rank` ∈ `leader | officer | recruiter | member` (replaces the loose
`role` default `'member'`; `owner_id` maps to the single **Leader**).

| Capability | Leader | Officer | Recruiter | Member |
|---|:--:|:--:|:--:|:--:|
| Edit clan profile / rules / dues | ✅ | — | — | — |
| Set who's recruiting / spots | ✅ | ✅ | ✅ | — |
| Approve / invite / kick members | ✅ | ✅ | ✅ (approve/invite only) | — |
| Assign ranks (≤ own rank) | ✅ | ✅ (≤ recruiter) | — | — |
| Create / delete channels & categories | ✅ | ✅ | — | — |
| Post announcements | ✅ | ✅ | — | — |
| Spend treasury / activate clan Artifacts | ✅ | ✅ (if `officer_can_spend`) | — | — |
| Post in normal channels | ✅ | ✅ | ✅ | ✅ |
| Wield a village Artifact (Orb) | Leader may nominate to village vote (§6) | — | — | — |

Permissions live in a code table `CLAN_RANK_PERMS: Record<Rank, Set<Cap>>` (mirrors the
`FEATURE`/`canUse` pattern in `tiers.ts`) — DB stores only the rank string.

### 5.3 Clan Discovery ("find a clan")

A Discovery surface lists clans where `is_recruiting = true`, showing:
- **Spots left** = `max_members − current_member_count` (clamped ≥0). Full clans (0 spots)
  auto-drop from Discovery even if `is_recruiting`.
- **Fee** = `join_fee_tokens` (or "Free"), **dues** = `dues_tokens`/`dues_period`.
- **Join button** → if fee > 0, runs the **Join-clan split** (§2, 80/20) debiting the
  user's Tokens; on success inserts `server_members` at rank `member` and credits the
  clan treasury 80%. Fails closed on insufficient tokens or a full clan (race-checked
  against `max_members`).

---

## 6. Villages

A **Village** forms from **≥2 clans, each with ≥50 members** → a village is **≥100 people
across ≥2 clans**. It's a super-container for cross-clan identity, chat and the biggest
give-back perks.

### 6.1 Formation rule (enforced)

`canFormVillage(clans)` = `clans.length ≥ 2` **AND** every founding clan has
`member_count ≥ 50`. A clan may belong to **one** village at a time (`servers.village_id`).
Adding a clan later requires the same `≥50` gate (prevents a 3-person clan piggy-backing
onto village perks). If a member clan drops below 50, it keeps village membership but is
flagged `under_strength` and can't trigger new village grants until it recovers (grace
window, config `VILLAGE_UNDERSTRENGTH_GRACE_DAYS = 14`).

### 6.2 Structure & leadership

```
Village
 ├─ Council = the Leaders of all member clans (one seat each)
 ├─ Village Chief = elected by Council (majority); breaks ties, wields village Artifacts
 ├─ village Space (servers row, kind='official'-style but owned by the village)
 │   └─ cross-clan channels: #village-hall, #war-council (Council only), #alliance-chat
 └─ member clans (village_clans)
```

- **Chief** term: config `VILLAGE_CHIEF_TERM_DAYS = 30`, re-electable. Chief (or a Council
  majority vote) is the **only** wielder of village-scope Artifacts like the Orb (§7.4).
- **Village treasury** (`villages.treasury_tokens`): clans may contribute from their
  treasuries; funds village Artifact purchases.

### 6.3 Village-level perks

| Perk | What it does |
|---|---|
| **Village banner & tag** | rendered across all member clan pages + in chat identity |
| **Cross-clan chat** | the village Space (shared channels for all member clans) |
| **Village leaderboard** | aggregate `total_points` across member clans (front-page eligible) |
| **Alliance tournaments** | village-only brackets; pooled pot, bigger milestone trophies |
| **Village Artifacts** | clan packs' big brother — village-wide grants incl. the **Orb of Osuvox** (§7.4) |

---

## 7. Artifacts (the digital art with system value)

Artifacts are the evolution of today's `assets.ts` `DigitalAsset` (jersey/banner/emote/
badge_skin). An Artifact is a piece of user-made (or TKO-made) digital art that carries a
**system value in Sweeps** and optionally a **perk** that applies to a user, clan, or
village. Sales route through **one centralized shop/marketplace** (because artifacts carry
power, peer-to-peer trading is disallowed — everything clears through TKO's marketplace so
the 20% fee and anti-abuse checks always apply).

### 7.1 Artifact shape (extends `DigitalAsset`)

| Field | Meaning |
|---|---|
| `kind` | `cosmetic` \| `power` \| `clan_pack` \| `special` \| `trophy` (supersedes the 4 cosmetic kinds; cosmetics keep their sub-kind) |
| `scope` | `user` \| `clan` \| `village` — who the perk applies to |
| `value_sweeps` | **system worth / power rating** — fixed at mint by rarity tier (below) |
| `price_tokens` | current buy price (primary = creator-set; resale = seller-set) |
| `perk_type` | `none` \| `sub_month` \| `sweeps_grant` \| `cosmetic` \| `clan_perk` \| `village_perk` |
| `perk_payload` | jsonb, e.g. `{tier:'creator', days:30}` or `{sweeps:1000}` |
| `duration_days` | perk lifetime once activated (0 = permanent cosmetic) |
| `is_official` | true = TKO-minted (100% TKO on sale) |
| `supply` / `edition` | mint cap for scarcity (null = unlimited) |

### 7.2 How value is set & discovered

- **`value_sweeps` (power) is fixed at mint** by a **rarity tier**, so an artifact's
  *power* can't be pumped by wash-trading:

  | Rarity | `value_sweeps` | $ equiv | Typical perk ceiling |
  |---|---:|---:|---|
  | Common | 100 | $1 | cosmetic |
  | Rare | 500 | $5 | ad_free month / small sweeps grant |
  | Epic | 2,500 | $25 | Pro month / clan cosmetic |
  | Legendary | 10,000 | $100 | Elite month / clan pack |
  | Mythic | 50,000 | $500 | Legend month / village perk |

- **Market price floats in Tokens.** On resale the **seller sets `price_tokens`**; the
  shop records `last_sale_tokens` and a rolling **floor**. That floating price is the
  *discovered market value*; the fixed `value_sweeps` is the *power*. Perks key off
  `value_sweeps` (mint rarity), **never** off resale price — this is the anti-pay-to-win
  guard.

### 7.3 How an Artifact applies to a profile (the activation → entitlement hook)

Activation is the mechanism that updates a user's (or clan's/village's) entitlements. It
**reuses the redeem-code entitlement path** and adds a `grants` overlay so scope>user
doesn't rewrite every member.

```
activateArtifact(ownershipId):
  a = artifact(ownership)
  switch a.perk_type:
    sub_month  -> insert entitlement_grants(scope=a.scope, subject=owner|clan|village,
                     tier=payload.tier, expires_at = max(now, current_expiry)+payload.days)
    sweeps_grant -> for each subject member: addSweeps(member, payload.sweeps)
    clan_perk / village_perk -> insert entitlement_grants(...) and/or set a clan/village flag
    cosmetic   -> mark equipped (no entitlement change)
  mark ownership.activated_at, active=true; schedule expiry at expires_at
```

**Entitlement resolution changes (`entitlements.ts`).** `entitlementsFromUser` today reads
only `user_metadata`. Extend the resolver to take the **max** effective tier over:
1. `user_metadata.reelone_tier` (+ expiry) — unchanged, redeem codes & Stripe subs,
2. **personal** active `entitlement_grants` (scope=user),
3. **clan** active grants for the user's clan,
4. **village** active grants for the user's village.

Highest non-expired tier wins; a lower-value artifact **never downgrades** a higher active
tier (take the max, extend expiry). This means a clan-wide or village-wide grant is **one
`entitlement_grants` row**, and all members resolve it live — no 100-row rewrite, and it
auto-lapses at `expires_at` exactly like `reelone_tier_expires`.

> Interaction with tiers/redeem: identical semantics to a redeem code, so redeem, Stripe
> sub, and artifact grants stack the same way (max tier, latest expiry). `ad_free` still
> stays out of `isPremium` (it grants no streaming perks — preserved from `tiers.ts`).

### 7.4 Special TKO Artifact — **Orb of Osuvox**

The capstone village artifact. **Official** (`is_official=true`, 100% TKO on purchase),
`kind='special'`, `scope='village'`, Mythic.

- **Effect on activation:** grants the **entire village** top-tier (**Legend/`creator`**)
  subscription for **30 days** *and* a **top-tier Sweeps grant of 1,000 Sweeps ($10) per
  member**. Implemented as: one `entitlement_grants(scope=village, tier='creator',
  +30d)` row **plus** a `sweeps_grant` fan-out to every current village member.
- **Who can wield it:** the **Village Chief** only (or a Council majority vote). Requires
  the village to actually exist (≥2 clans / ≥100 people) — enforced at activation.
- **Cost & acquisition:** two paths —
  1. **Buy** from the TKO shop for **250,000 Tokens ($2,500)**, pooled from the village
     treasury. (Deliberately village-scale; see §8 for why this price is safe.)
  2. **Earn** it as the *ultimate milestone trophy* when a village-scale event clears the
     village threshold in §8 — then it's minted free to the village.

### 7.5 Clan packs (village's little siblings)

Official (`is_official`), `kind='clan_pack'`, `scope='clan'`, activated by Leader/Officer.

| Pack | Price (Tokens / $) | Grants clan-wide (all current members) |
|---|---:|---|
| **Barracks Pack** | 30,000 / $300 | `ad_free` for 30 days to every member + clan banner slot |
| **War Chest Pack** | 60,000 / $600 | **Pro** for 30 days to every member + 500 Sweeps to treasury + 14-day Discovery feature |
| **Recruitment Drive** | 8,000 / $80 | 14-day featured slot in Discovery + 5 join-fee waivers |

(Prices set so TKO's 100% take covers realistic cost with margin — see §8.)

### 7.6 Milestone trophies (minted by achievement, not bought)

`kind='trophy'`, minted automatically when a tournament/village event clears a threshold.
Worth membership perks:

| Trophy | Triggered when | Grants |
|---|---|---|
| **Clan Champion Trophy** | a tournament reaches the **clan threshold** (§8) | 30 days **Pro** for all members of the winning/hosting clan |
| **Village Ascendant Trophy** (ultimate) | a village-scale event clears the **village threshold** (§8) | the **Orb of Osuvox** effect (Legend + 1,000 Sweeps to the whole village) |

Minting = insert an owned `trophy` artifact for the clan/village + auto-activate its
grant. The trophy is also a permanent cosmetic/prestige object on the clan/village page.

---

## 8. Give-back thresholds (the core math)

**Question:** using TKO's 20% take (+ 100% on official sales/subs), at what tournament
player-count / pot size / marketplace volume has TKO earned enough to fund each give-back
**without losing money?**

### 8.1 Assumptions (all config)

- `1 Token = 1 Sweep = $0.01`; `PLATFORM_FEE = 0.20`.
- Give-back membership tiers: **clan-wide = Pro ($4.99)**, **village-wide = Legend
  ($29.99)** (the "top tier"). Top-tier Sweeps grant = **1,000 Sweeps ($10)/member**.
- Reference **paid tournament entry = 500 Tokens ($5)/player**; TKO take = 20% of pot.
- **Two cost bases** (both shown, because they answer "lose money" differently):
  - **Retail (conservative):** cost = full retail value of every membership/Sweep granted,
    i.e. assume *every* granted seat was a lost full-price sale. Safe upper bound.
  - **Realistic (marginal):** an entitlement grant costs TKO ~**$0 in cash** (it's a
    software flag); the *only* real cost is **foregone upgrade revenue** from the fraction
    who *would* have paid — assume **Pro conversion 8%**, **Legend conversion 3%** — plus
    Sweeps liability, which is **~$0** in the prestige model (Sweeps don't cash out;
    `giving-and-prestige.md`). If/when Sweeps are cash-redeemable, add Sweeps at face.
- Representative sizes: **clan = 50 members** (a village-qualifying clan), **village = 100
  people** (the minimum). Tables also show a **100-member clan** worst case.

### 8.2 Cost of each perk

| Perk | Scope size | Retail cost | Realistic cost |
|---|---|---:|---:|
| Clan Champion (Pro 30d) | 50 | 50 × $4.99 = **$249.50** | 8% × $249.50 = **$19.96** |
| Clan Champion (Pro 30d) | 100 | 100 × $4.99 = **$499.00** | **$39.92** |
| Barracks Pack (ad_free 30d) | 50 | 50 × $1.99 = **$99.50** | 5% × $99.50 = **$4.98** |
| War Chest (Pro 30d + 500 Sweeps) | 50 | $249.50 + $5 = **$254.50** | $19.96 + ~$0 = **$19.96** |
| Village / Orb (Legend 30d + 1,000 Sweeps/mbr) | 100 | 100 × $29.99 + 100 × $10 = **$3,999** | 3% × $2,999 + ~$0 = **$89.97** |
| Village / Orb | 200 | $5,998 + $2,000 = **$7,998** | **$179.94** |

### 8.3 Funding threshold = revenue needed so TKO take ≥ cost

TKO take on a tournament = `0.20 × pot`. To fund cost `C`, need **pot ≥ C / 0.20 = 5C**.
At $5/entry, **players ≥ pot / $5**. The same `5C` applies to **marketplace GMV** (TKO
takes 20%) and to a clan's **30-day platform-fee contribution** (dues + subs + sales).

| Perk (size) | Cost basis | Cost `C` | Revenue threshold (`5C` gross flow) | Trigger @ $5 entry | Trigger as marketplace GMV |
|---|---|---:|---:|---:|---:|
| **Clan Champion (Pro)** — 50 | Retail | $249.50 | **$1,247.50** | **250 players** | $1,248 GMV |
| Clan Champion (Pro) — 50 | Realistic | $19.96 | **$99.80** | **20 players** | $100 GMV |
| Clan Champion (Pro) — 100 | Retail | $499.00 | $2,495.00 | 499 players | $2,495 GMV |
| **Barracks Pack (ad_free)** — 50 | Retail | $99.50 | $497.50 | 100 players | $498 GMV |
| Barracks Pack — 50 | Realistic | $4.98 | $24.90 | 5 players | $25 GMV |
| **Village / Orb (Legend+Sweeps)** — 100 | Retail | $3,999 | **$19,995** | **≈4,000 players** | $19,995 GMV |
| Village / Orb — 100 | Realistic | $89.97 | **$449.85** | **90 players** | $450 GMV |
| Village / Orb — 200 | Retail | $7,998 | $39,990 | ≈8,000 players | $39,990 GMV |

### 8.4 Recommended triggers (operational)

Marginal cash cost of a grant is ~$0, so triggering on the *retail* threshold is
needlessly steep. Recommendation: **trigger on `2× realistic`** (a 100% safety buffer that
still costs a fraction of one big event's take):

| Trophy / grant | Recommended trigger | = pot / GMV | Retail-safe? |
|---|---|---:|---|
| **Clan Champion Trophy** (Pro, ~50-mbr clan) | tournament hits **40 paid players** *or* clan drives **$200** in 30-day platform flow | $200 pot | funded ~1.6× realistic; 8% of retail |
| **Barracks / Recruitment packs** | sold at their §7.5 token price | 100% TKO take | yes (price > realistic cost) |
| **War Chest Pack** | sold at 60,000 Tokens ($600) | 100% TKO take = $600 | yes — covers $254.50 retail outright |
| **Village Ascendant Trophy / Orb** (100-village) | village-scale event hits **200 paid players** *or* pooled village events drive **$1,000** in 30-day flow | $1,000 pot → $200 TKO take | ~2.2× realistic; not retail-safe, but grant cash cost ≈ $0 |
| **Orb bought outright** | 250,000 Tokens ($2,500), 100% TKO | $2,500 TKO take | covers realistic ($90) ~28×; below retail ($4k) but cash cost ≈ $0 |

**Reading it:** clan packs and the bought Orb are **always cash-positive** (official sale,
100% TKO, priced above realistic cost). Milestone *trophies* are funded by the triggering
event's take; on the realistic basis they're comfortably positive, and because a granted
membership has ~$0 marginal cash cost, TKO never actually goes cash-negative even when a
grant's *retail* value exceeds the take. The retail column exists as the conservative
ceiling for when leadership wants a strictly "every seat = a lost sale" guarantee (use the
retail trigger then).

---

## 9. Implementation plan

Consistent with existing `tiers.ts` / `wallet.ts` / `ledger.ts` / `entitlements.ts` and
`db/schema.sql`. Reconciles the clans that **partially exist** (`servers`,
`server_members`, `channels`, `messages`) rather than replacing them.

### 9.1 New / changed DB tables

**Extend existing:**
- `servers` (+): `kind`, `visibility`, `max_members` (default 100), `is_recruiting`,
  `join_fee_tokens`, `dues_tokens`, `dues_period`, `rules`, `village_id`,
  `treasury_tokens`.
- `server_members` (+): `rank` (`leader|officer|recruiter|member`),
  `dues_paid_through timestamptz`. Backfill `role → rank`; `owner_id → leader`.
- `channels` (+): `category_id`, widen `type` to `text|clips|announcement|voice`,
  `is_default`, `min_rank`, `post_policy`.
- `messages` (+): `parent_message_id uuid null references messages(id)` (threads).

**New:**
- `server_categories(id, server_id, name, sort)` — Discord-like areas.
- `villages(id, name, chief_profile_id, treasury_tokens, created_at)`.
- `village_clans(village_id, server_id, joined_at, under_strength bool)` — unique(server_id).
- `artifacts(id, name, kind, scope, rarity, value_sweeps, price_tokens, perk_type,
  perk_payload jsonb, duration_days, is_official, supply, created_by, image_url, created_at)`
  — supersedes the localStorage `assets` catalog.
- `artifact_ownership(id, artifact_id, owner_type user|clan|village, owner_id, source
  buy|reward|grant|trophy, acquired_at, activated_at, active, expires_at)`.
- `artifact_listings(id, artifact_id, seller_id, price_tokens, status open|sold|cancelled,
  last_sale_tokens, created_at)` — the marketplace/resale rail.
- `entitlement_grants(id, scope user|clan|village, subject_id, tier, expires_at,
  source_artifact_id, granted_by, created_at)` — the overlay `entitlements.ts` reads.
- `platform_ledger(id, action_type, payer_id, payee_type, payee_id, gross_tokens,
  tko_tokens, payee_tokens, royalty_tokens, created_at)` — the split audit trail (server
  counterpart to `ledger.ts`).
- `clan_dues_payments(id, server_id, user_id, kind join|dues|sub, gross_tokens, created_at)`.

### 9.2 Split / ledger logic

One pure function, mirroring the `canUse`/`predictionQuota` style:

```ts
// PLATFORM_FEE = 0.20
function applySplit(action, grossTokens, opts): Split {
  const officialOrTkoSub = action === 'buy_official' || action === 'tko_sub'
  const tko    = officialOrTkoSub ? grossTokens : Math.round(grossTokens * PLATFORM_FEE)
  const payee  = grossTokens - tko
  const royalty = opts.royaltyPct ? Math.round(payee * opts.royaltyPct) : 0
  return { tko, payee: payee - royalty, royalty }
}
```

Server flow per money action: check payer token balance → `addToWallet(payer,{tokens:-g})`
→ credit payee's `treasury_tokens` / creator payout balance by `payee` → write
`platform_ledger`. Reuses `wallet.ts` for the debit; payout accrues per §3.

### 9.3 Artifact activation → entitlement hook

`activateArtifact()` as in §7.3, writing `entitlement_grants`. Extend
`entitlementsFromUser` (or a new `resolveEntitlements(user, grantsCtx)`) to take the **max**
tier across `user_metadata` + personal/clan/village active grants, each honoring
`expires_at`. Keep the pure/testable shape of `entitlements.ts` (inject the grants context,
default `now`). Redeem codes, Stripe subs, and artifact grants then all settle identically.

### 9.4 Chat model wiring

Categories + threads + rank-gated posting per §4. `canPost(space, channel, member)` is a
pure helper (like `canStreamTo` in `tiers.ts`). Seed the **TKO-official** Space by
extending the existing `KillCam Community` seed with `#find-a-clan`, `#tournaments`,
`#help`, and a staff-only `#announcements`.

### 9.5 Phased build order

1. **Currency & split foundation** — `applySplit` + `platform_ledger`; wire token packs
   to real Stripe (build-plan M2/M4). *Nothing social ships value until this exists.*
2. **Clans v2** — extend `servers`/`server_members`; ranks + `CLAN_RANK_PERMS`;
   join-fee/dues via `applySplit`; **Clan Discovery** page (recruiting + spots left).
3. **Chat Spaces** — `server_categories`, threads, `min_rank`/`post_policy`; three Space
   kinds; seed TKO-official channels.
4. **Artifacts v2** — migrate `assets` → `artifacts` table; marketplace listings/resale
   (centralized, 20% split); **activation → `entitlement_grants`**; extend the
   entitlement resolver.
5. **Villages** — formation gate (≥2 clans / ≥50 each), Council + Chief, village Space &
   treasury, village-scope grants.
6. **Special artifacts & give-back engine** — clan packs, milestone-trophy mint triggers
   wired to tournament size / pot / marketplace volume using the §8 thresholds, and the
   **Orb of Osuvox** (buy path + ultimate-trophy path).

Rationale: money plumbing first (everything downstream moves Tokens), then the social
containers (clans → chat), then the value objects that ride on them (artifacts), then the
aggregate (villages), then the capstone give-back that depends on all of the above.

---

## 10. Open decisions for the founder (flagged, with a default chosen)

| Question | Default chosen here | Change by editing |
|---|---|---|
| Is "full membership" in clan give-backs Pro or Elite? | **Pro ($4.99)** | §8.1 tier constants |
| Optional original-creator resale royalty? | **10%, out of seller's 80%**, config-off by default | `royaltyPct` |
| Orb outright price | **250,000 Tokens ($2,500)** | §7.4 |
| Milestone trigger basis | **2× realistic** (buffer, ~$0 cash risk) | §8.4 |
| Top-tier Sweeps grant size | **1,000 Sweeps ($10)/member** | §8.1 |
| Village Chief term / under-strength grace | **30 / 14 days** | §6 |
```
