# TKO App/Site Analysis — improvement map (proposal only, no changes made)

Scope note: this is FLOW / FUNCTIONALITY / DATA / AI analysis. It does NOT propose
UI restyling — the visual style stays as-is. Nothing here is implemented yet.

## 0. Direct answers to your questions

- **Hammy's timezone:** YES — if he fixes the clock/timezone on his capture system
  so recordings are stamped with the correct real time, his clips will time-align
  with the squad automatically through the normal matcher path (no audio-anchor
  needed). His clips are ~19–20h off purely because his device clock is wrong.
  Fixing it at the source is the cleanest permanent fix; the audio+screens anchor
  we built is the safety net for when a player's clock is wrong and can't be fixed.

- **Live tournament vs play-and-upload:** the code today only records a battle
  `winner` + `status` and awards on that — it is format-agnostic, so BOTH are
  possible, but neither flow is actually built yet. We should let the host pick the
  format at creation (see §2).

## 1. The unifying principle you already found: "Live-style" flows everywhere

The Live section works because it's **simple buttons that target intent, then a
guided config** (`/live?do=golive`, `/live?do=multi`). Most other sections jump
straight to a form or a raw page. The single highest-leverage change across the
whole app is to make every creator action follow the Live pattern:

  pick intent (button) -> configure (guided) -> confirm -> go.

Apply it to: Create Tournament, Create Match, Create Highlight/Reel, Go Live,
Host, Stat-Check, Boards/Chat spaces. Same mental model everywhere = far less
confusion, and each flow can hand its config to the AI (see §4).

## 2. Tournament system — the big buildout (design)

Today: real brackets exist server-side (`tournament_battles` w/ round, players,
winner, status; server derives bracket depth; winning grants a round-scaled
advancement artifact + trophy/ledger; Final = King). Missing pieces you named:

**A. Tournament creation flow (Live-style).** Buttons to pick the tournament TYPE
first (1v1 ladder, 4v4 clan, King-of-the-hill, open bracket, invitational), then
configure: size/seeding, LIVE vs PLAY-AND-UPLOAD, single/double elim, where it's
held (channel/clan/venue), schedule, and the RULES (free text). This mirrors Live.

**B. Rules -> AI.** Store the stated rules on the tournament and feed them to Ask
TKO so anyone can ask "what are the rules of this tournament / when's my match /
what do I win." (Ties to §4.)

**C. Bracket auto-seeding.** Verify/implement create -> auto-generate the round-1
battles from the entrant list. (Unverified today — likely the missing link.)

**D. KO detection + scorer credit (reuse the video pipeline).** The same gold "K.O."
banner detection that drives highlights can watch a battle's stream and: (1) detect
the KO, (2) read WHO scored it (roster OCR we already have in tko_roster), (3)
count it. Feed that into: battle result auto-reporting (sets `battle.winner`,
closing the manual gap), and a **KO/score stat** on player profiles. Host still
confirms by default; auto-detect becomes a strong suggestion the host one-taps.

**E. Live bracket overlay + animation.** A bracket SCREEN that can be brought up on
the live stream and updates in real time — a line/slot animates as each result
lands (fighter advances, artifact pops). This is a new view fed by
`tournament_battles`; it's an overlay/scene, not a restyle.

**F. Host & multi-host flow (like Live).** Host picks: tune into each fight IN
ORDER (sequential program), or let them all play out then review each. And, like
the Live style, OTHER hosts can tune in to COMMENTATE a fight (guest casters on a
battle). Reuse the Live control-room + program concepts.

**G. Tournament "style" preset.** Just like a live style, a tournament STYLE that
targets the tournament type (visual scenes, lower-thirds, bracket overlay, intro),
selected then configured. (Scenes/overlays — not a UI restyle of the app.)

## 3. Stats we're not counting yet
- **KOs and who scored them** (from D above) -> profile stat + leaderboard.
- Tournament record (W/L, rounds reached, artifacts won, King count).
- These make profiles and Rankings much richer and feed Oracle/prediction markets.

## 4. Ask TKO — make it actually helpful (context-aware)
Today PublicAskTko sends basically just the question — no page, no account, no
tournament context. Upgrade (now that the model is smarter):
- Pass the **current route/page** and the **signed-in account** (username, power,
  clan, entitlement) so answers are personal and situated.
- Pass **page-specific context**: on a tournament page, include that tournament's
  rules/schedule/bracket state; on a profile, that player's stats; on Live, the
  stream state. Then "Ask TKO" genuinely helps instead of answering generically.
- Keep the private-data guardrails (never expose another user's private info).

## 5. Section-by-section (flow/functionality only)
- **Video/Reels/Watch scroll:** vertical feed now good; still depends on YouTube for
  app playback (self-host verticals so the app never waits on a cap — separate note).
- **Matches / Create Match:** move to the Live button->configure flow.
- **Tournaments:** §2 (the big one).
- **King / Board:** surface the advancement-artifact + King lineage as a visible
  journey; tie to the bracket overlay.
- **Live / Host / Director / Program:** the reference flow — extend its multi-host
  + program concepts to tournaments.
- **Clans / Chat:** clan-owned tournaments + clan prestige from tournament results.
- **Stat-Check / Submit-Result:** fold auto KO-detection in as the suggested result;
  human confirms.
- **Store / Rewards / Redeem:** wire event artifacts from tournaments into the
  trophy closet + store display.
- **Creator Dashboard / Rankings:** add the new KO + tournament stats.

## 6. Suggested priority
1. Ask TKO context-awareness (page + account + per-tournament rules) — high impact, self-contained.
2. Tournament creation flow (Live-style) + rules field + auto-seed bracket.
3. KO detection + scorer credit (reuse pipeline) -> auto-suggest battle results + KO stat.
4. Live bracket overlay + advancement animation.
5. Multi-host commentary + tournament style presets.
6. Roll the Live button->configure pattern into the remaining create flows.

Deployment reality: several of these touch the StrikerClips server/app (where Codex
is active). Sequence around that; none require a UI restyle.
