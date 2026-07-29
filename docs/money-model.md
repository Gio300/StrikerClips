# KillCam Money Model

Starter numbers — all editable. Two revenue engines: **memberships** (users pay KillCam) and **creator monetization** (viewers pay creators, KillCam takes a cut). Ads are a third, smaller engine for free users.

---

## 1. Membership tiers (what users pay KillCam)

| Tier | Price | Who it's for | Key perks |
|------|-------|--------------|-----------|
| **Free** | $0 | Everyone | Watch, make clips, chat, follow, join clans. Sees ads. |
| **Ad-Free** | **$1.99/mo** | Casual users | Everything in Free, with **ads removed**. |
| **Pro** | **$4.99/mo** | Active players | Go live on your **profile**, full clip tools, no ads, better AI clip detection. |
| **Elite** | **$9.99/mo** | Clan leaders / hosts | Everything in Pro + stream on your **clan page**, **host tournaments**, the host **control room** (multi-cam + Program view). |
| **Legend** | **$29.99/mo** | Creators / pros | Everything in Elite + **front-page** live placement, the **best AI**, guest/multi-host — and **the ability to charge your own viewers** (creator monetization, below). |

Annual option (2 months free): Pro $69, Elite $149, Legend $299.

**Legend is the "top tier" that unlocks charging viewers.** You can't sell to your audience unless you're Legend — that's the incentive to climb.

---

## 2. Creator monetization (Legend only)

Legends charge their own viewers. **Split: creator keeps 80%, KillCam 20%.** Stripe processing (~2.9% + 30¢) comes off the top before the split. All through **Stripe Connect** (Stripe's payout product — still just Stripe).

### The charge menu creators pick from
Creators choose a preset price (keeps fees, tax, and UI predictable — no free-text amounts):

| Charge type | What it is | Preset options creator picks |
|-------------|-----------|------------------------------|
| **Pay-per-view ticket** | One live stream / event | $0.99, $2.99, $4.99, $9.99, $19.99, $49.99 |
| **Channel subscription** | Monthly sub to that creator | $2.99, $4.99, $9.99, $24.99 |
| **Tips / cheers** | Viewer-chosen support | $1, $5, $10, $25, $100 |
| **Paid tournament entry** | Buy-in to their bracket | $1, $5, $10, $25, $50, $100 |

### What a creator actually nets (example)
Viewer pays **$9.99** PPV → Stripe takes ~$0.59 → $9.40 left → creator gets **80% = $7.52**, KillCam gets **$1.88**.

---

## 3. Stripe status & payouts — honest

- **Is Stripe "up to par" for this?** Not yet for KillCam. A live Stripe catalog exists on the shared TensorVerse account, but the **billing backend isn't deployed for KillCam** and **Stripe Connect (creator payouts) isn't set up**. This is the backend build we've had parked.
- **Immediate payouts?** Yes, technically — Stripe Connect **Instant Payouts** send money to a creator's eligible debit card in minutes, for a ~**1.5% fee** (min ~$0.50). Default is **standard** payout (rolls out in ~2 business days, free). Plan: offer both — free standard, or instant for the small fee (creator or KillCam absorbs it).
- **Creators set their own prices?** Yes — from the preset menu above, once Connect + backend are live.
- **What has to happen first:** deploy the billing backend → each creator completes a one-time **Stripe Connect onboarding** (identity/bank KYC — required by law to pay them) → gate paid streams behind a token so only payers can watch (a public YouTube link can't be paywalled).

---

## 4. Ads (free-tier engine)

- **Free users watch a short ad to unlock some views** (a "watch a quick ad to continue" interstitial). Pro and up = no ad breaks. The UI slot for this already exists in the app; real paid ads need an ad network + approval.
- **When to turn ads on:** once free-tier daily active users reach the **low thousands**. Below that, ad networks pay pennies and approval is hard — subscriptions out-earn ads early, so lead with subs.
- **How much ads actually make (honest ranges):**
  - Display banners (gaming): ~**$1–$5 per 1,000 views** (RPM)
  - Video pre-roll: ~**$5–$15 RPM**
  - So **100,000 monthly ad views ≈ $100–$1,500/mo**, depending on format and country. Real, but modest until real scale.
- **Which network:** web → **Google AdSense / Ad Manager**; in-app Android → **AdMob**; video pre-roll → an instream partner later. Start with AdSense + AdMob (easiest approval, best fill).

---

## Bottom line
- **Live now:** memberships can be sold on the **web** via Stripe (keeps Apple/Google's 30% out of it). Free "share a link, anyone watches" already works.
- **Needs the backend:** creator charging + payouts, paywalled streams, real ad serving, cross-device chat/feeds.
- **Sequence:** finish free product + memberships (web Stripe) → deploy backend → Stripe Connect + paid streams → ads once traffic justifies it.
