# KillCam AI Video-Analysis System — Technical Design

Status: spec / research (no code here). Owner-agreed nucleus:
**cheap frame-picker → Gemini Flash reads ~5–15 stills → JSON → Postgres**, run at **upload time**, on GCP/Vertex AI. We never send whole videos to a model. A cheap local/CPU pre-pass narrows thousands of frames to ~10; only those reach Flash. Cost target: **pennies per clip**.

This extends what already ships in the repo: browser-side OCR cue detection (`src/lib/categoryDetector.ts` + `highlightCategories.ts`), audio-energy spikes (`src/lib/highlightDetector.ts`), the describe-search (`describeClip.ts` / `clipSearch.ts`), and the manual `frame_labels` labeler (`src/pages/AILabel.tsx`). Those become the **pre-pass**; Flash becomes the **reader** that turns picked frames into structured battle data.

---

## 1. Architecture

```
 UPLOAD (or LIVE buffered stream, ~N s behind)
        │  file / HLS segment  → GCS (bucket 'videos')
        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  PRE-PASS  (cheap, CPU, no LLM) — the "frame-picker"     │
 │  a. sample 1 frame / 2–3 s                               │
 │  b. audio RMS spikes      (highlightDetector.ts)         │
 │  c. OCR cue match         (categoryDetector.ts)          │
 │  d. template-match banners (gold "K.O.", VICTORY/DEFEAT) │
 │  e. end-of-match scoreboard detector (highest value)     │
 │  → candidate set, deduped & ranked → keep ~5–15 frames   │
 └─────────────────────────────────────────────────────────┘
        │  ~10 stills + timestamps + which detector fired
        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  READER  — Gemini Flash on Vertex AI                     │
 │  frames + per-game frame-profile prompt → strict JSON    │
 └─────────────────────────────────────────────────────────┘
        │  clip analysis JSON  (players, outcome, stats, moments…)
        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  POSTGRES  (db/schema.sql)                               │
 │  battle_records ─┬─ clip_moments                         │
 │                  └─ match_signatures (dedup)             │
 │  → feeds: power_ratings/ranking · describe-search        │
 │           · moment extraction (clips) · anti-cheat flags │
 └─────────────────────────────────────────────────────────┘
```

Design rule: the pre-pass is allowed to be noisy (over-select). Flash is the judge. The only thing we must not do is send Flash more than ~15 frames per clip — that is where cost lives.

---

## 2. Per-game "frame profile"

A **frame profile** is a small config (JSON, sibling to the existing `public/game-profiles/<id>.json` idea referenced in `highlightCategories.ts`) that answers, for one game: *which few frames actually tell the story of a match, and how do we cheaply find them?* Each entry defines a **frame type** with a detector and a value tier.

```
{
  gameId, displayName,
  frameTypes: [
    { id, tier, detector: {kind, cues?|templateRef?|audio?},
      maxFrames, promptHint }
  ],
  flashBudget: { minFrames, maxFrames }   // e.g. 5..15
}
```

`detector.kind` ∈ `ocr_cue` | `template_match` | `audio_spike` | `sample`. The picker runs every detector, tags each candidate frame with the frame-type that fired, then fills the Flash budget **tier-first** (always include the scoreboard if found; then banners; then spikes; then plain samples to reach `minFrames`).

### Shinobi Striker profile (concrete)

| frame type | tier | detector | why it matters |
|---|---|---|---|
| `scoreboard` (end results/stats screen) | 1 (highest) | ocr_cue: `RESULT`,`RESULTS`,`PLAYTIME`,`GRADE`,`SCORE` + `VICTORY`/`DEFEAT`; template-match the results layout | single most valuable frame: all players, K/D, win/loss, points. Reuses the `closing` cues already in `highlightCategories.ts`. |
| `ko_banner` (gold "K.O.") | 2 | template_match on the gold K.O. sprite (scale/position-tolerant); OCR fallback `KO`,`K.O` | confirms a kill moment + rough who/when |
| `buff_reveal` (death → triangle/loadout screen) | 2 | ocr_cue on the post-death jutsu/loadout panel (`SECRETTECHNIQUE`,`SUBSTITUTION`, ninjutsu slot labels) + template of the triangle panel | shows the player's equipped buffs/loadout — the frame anti-cheat needs |
| `ultimate` (Ougi/awakening) | 3 | ocr_cue: `ULTIMATE`,`NINJUTSU`,`OUGI`,`AWAKENING` | moment tagging + power-play detection |
| `flag`/scroll | 3 | ocr_cue: `FLAG`,`SCROLL`,`CAPTURE` | objective moments |
| `audio_peak` | 4 | audio RMS z-spike | catches un-templated big moments |

Building a profile for a new game = capture a handful of reference screenshots, crop the banner/scoreboard templates, list the OCR cue strings, assign tiers. No model training. Template refs live in GCS; OCR cues live in the JSON. This is intentionally the same shape the shipped OCR path already consumes, so the browser detector and the server picker share one config.

---

## 3. Output JSON schema (per clip)

Flash is prompted to emit exactly this (strict JSON, temperature 0). All fields nullable; `confidence` is mandatory. `timestampSec` is relative to clip start.

```jsonc
{
  "gameId": "shinobi_striker",
  "schemaVersion": 1,
  "players": [
    { "inGameName": "Rekt", "team": "red" | "white" | null,
      "isUploader": true, "profileGuess": null }
  ],
  "outcome": { "result": "win" | "loss" | "draw" | "unknown",
               "uploaderResult": "win" | "loss" | null },
  "stats": [
    { "inGameName": "Rekt", "kills": 12, "deaths": 4, "assists": 3,
      "score": 8200, "points": null, "grade": "S" | null }
  ],
  "moments": [
    { "type": "ko" | "death" | "ultimate" | "flag" | "scroll" | "opening" | "closing",
      "timestampSec": 87.5, "actor": "Rekt", "target": "Auryn" | null,
      "confidence": 0.0 }
  ],
  "buffs": [
    { "inGameName": "Rekt", "loadout": ["Substitution+", "Healing Jutsu"],
      "revealedAtSec": 3.2, "confidence": 0.0 }
  ],
  "matchSignature": {
    "players": ["Rekt","Auryn", "..."], "score": "3-1",
    "matchType": "ninja_world_league" | "survival" | "...",
    "approxDurationSec": 300, "raw": "sorted-players|score|type|dur-bucket"
  },
  "confidence": 0.0,          // overall
  "framesUsed": 9,
  "notes": "free text: occlusion, unreadable scoreboard, etc."
}
```

`matchSignature.raw` is a normalized string (sorted player list + score + type + duration bucketed to ~30s) hashed for dedup. `matchType` reuses the `match_results.match_type` enum already in the schema.

---

## 4. Postgres tables

New tables, aligned with the existing `clips`, `match_results`/`match_result_players`, `power_ratings`, and `frame_labels`. All UUIDs + `references profiles(id)` like the rest of `db/schema.sql`.

```sql
-- One row per analyzed clip/match. The JSON blob is source of truth; hot
-- columns are promoted for querying/ranking.
create table battle_records (
  id            uuid primary key default uuid_generate_v4(),
  clip_id       uuid references clips(id) on delete set null,
  uploader_id   uuid references profiles(id) on delete cascade,
  game          text not null default 'shinobi_striker',
  source        text not null default 'upload',        -- 'upload' | 'live'
  outcome       text check (outcome in ('win','loss','draw','unknown')),
  analysis      jsonb not null default '{}',           -- full schema-§3 JSON
  signature_id  uuid,                                   -- -> match_signatures
  confidence    numeric,
  model         text default 'gemini-flash',
  frames_used   int,
  created_at    timestamptz default now()
);
create index idx_battle_records_uploader on battle_records(uploader_id, created_at desc);

-- Extracted moments -> drives clip extraction + the describe-search.
-- Superset of the manual frame_labels table (same idea, machine-authored).
create table clip_moments (
  id            uuid primary key default uuid_generate_v4(),
  battle_id     uuid not null references battle_records(id) on delete cascade,
  clip_id       uuid references clips(id) on delete set null,
  type          text not null,        -- 'ko'|'death'|'ultimate'|'flag'|...
  t_seconds     numeric not null,
  actor         text, target text,
  confidence    numeric,
  created_at    timestamptz default now()
);
create index idx_clip_moments_battle on clip_moments(battle_id, t_seconds);

-- Loose dedup ledger. Store now, enforce softly later (see §7 honesty note).
create table match_signatures (
  id            uuid primary key default uuid_generate_v4(),
  game          text not null,
  raw           text not null,        -- normalized signature string
  sig_hash      text not null,        -- hash(raw); NOT unique yet, on purpose
  first_battle_id uuid references battle_records(id) on delete set null,
  seen_count    int not null default 1,
  created_at    timestamptz default now()
);
create index idx_match_signatures_hash on match_signatures(game, sig_hash);
```

Ranking still writes through the **existing** `power_ratings` + `match_result_players` trigger (`update_power_ratings_on_match`). `battle_records` for verified matches can populate `match_results` so the shipped Elo/points path is reused rather than duplicated.

---

## 5. Ranking / scoring model

Tiered by evidence quality — better evidence, more weight. Confidence-weighted so a shaky read never moves rank as much as a clean scoreboard.

1. **Tier A — end-stats present** (scoreboard read: K/D, win/loss, points). Authoritative. Feed straight into `power_ratings` via `match_result_players` (role winner/loser, `points`). Elo-ish update as today.
2. **Tier B — win/loss only** (VICTORY/DEFEAT banner, no full stats). Apply a **reduced** rating delta (e.g. ½ the Tier-A K-factor).
3. **Tier C — detected-event-count only** (no outcome; N kills / ultimates from moments). Contributes to a soft "activity" score and ordering, **not** to competitive rating.

Effective delta = `base_delta * confidence * tier_weight`. Records below a confidence floor (e.g. `< 0.4`) are stored but **not** rating-applied until human/second-pass confirmation. This keeps the existing accumulated-points model intact while letting AI-read matches flow into it safely.

---

## 6. Cost controls

- **Frames, not video.** Never upload video to the model. ~5–15 stills/clip is the hard ceiling (`flashBudget.maxFrames`).
- **Flash, not Pro.** Default to Gemini Flash. Escalate to Pro only when overall `confidence < floor` AND the match is competitively meaningful (ranked/tournament) — a tiny fraction of clips.
- **Analyze once per match.** Check `match_signatures` before calling Flash; on a strong signature hit, reuse the existing `battle_records` and skip the model entirely.
- **Pre-pass is CPU/free.** OCR, audio RMS, and template-match already exist client-side; run them server-side (or reuse the browser result) so the paid step only sees pre-filtered frames.
- **Downscale + crop.** Send scoreboard/banner crops at modest resolution; tokens scale with pixels.
- **Budget guard.** Per-user/day frame quota; overflow queues instead of fanning out.

---

## 7. Stat-check anti-cheat

**Problem.** In tournaments, players "stat-check": show legal buffs/loadout to an organizer, then swap to illegal ones once the match starts. Organizers can't watch everyone simultaneously. The shipped `stat_check_submissions` table is today a manual review queue.

**Approach — verify continuity cheaply, flag anomalies, don't chase perfection.**

Require a **single continuous recording** (no cuts) that contains **both** the buff/loadout reveal **and** the gameplay. Then use the same frame system:

1. **Reveal frame(s).** Picker grabs the `buff_reveal` (death→triangle/loadout) frames; Flash extracts the equipped buffs → `buffs[]`.
2. **In-match spot checks.** Sample a few mid-match `buff_reveal`/HUD frames (post-death loadout screens recur naturally) and confirm the loadout still matches the declared set.
3. **Edit / cut detection.** Cheap signals on the raw file: hard scene-cut detection between sampled frames, timestamp/frame-continuity gaps, resolution/encoder or aspect changes mid-file, and duplicated/looped segments. Any of these = "recording may be spliced."
4. **Decision = flag, not verdict.** If buffs stay consistent and no edit signals fire → auto-`approved` candidate. If loadout changes, or an edit is detected, or a required frame is missing → **flag for human review** with the exact timestamps and frames attached to the `stat_check_submissions` row.

Wire it in by adding to `stat_check_submissions`: `analysis jsonb`, `continuity_ok boolean`, `edit_flags text[]`, `auto_recommendation text` (`pass`/`review`/`fail`). Reviewers see AI reasoning + frames, not raw video scrubbing.

**Honest limits.** This is deterrence and triage, not proof.
- A skilled editor with matching encoder settings and no hard cuts can defeat cut-detection; we catch the lazy 90%, not a determined forger.
- We can only verify what a frame shows — off-screen/menu-only buffs or ones that never surface in a sampled frame can be missed.
- Continuous-recording is a **policy** requirement; enforcement is only as strong as our edit detection.
- Therefore: never auto-**ban**. Worst AI outcome is "flag for human review." Keep a human in the loop for penalties.

---

## 8. Open questions & phasing

**Depends on:** the Postgres backend being live (Cloud SQL, per `server/app.ts`) and Vertex AI / Gemini Flash access enabled on the GCP project (reelone-498406). Both gate anything past Phase 0.

- **Phase 0 (now, no model):** ship the server-side pre-pass reusing existing OCR/audio/template code; write `clip_moments` from it; power the describe-search. Zero LLM cost.
- **Phase 1:** add `battle_records` + Flash reader on upload for Shinobi Striker only; store JSON + `match_signatures` (store, don't enforce). Tier-A ranking into existing `power_ratings`.
- **Phase 2:** anti-cheat continuity checks on `stat_check_submissions`; human-review UI with attached frames.
- **Phase 3:** live path — analyze the buffered/delayed stream (the viewer delay *is* the analysis window); reuse the same picker on HLS segments.
- **Phase 4:** loose dedup enforcement + second-game frame profile.

**Open questions:**
- Scoreboard reliability across match types (survival vs. NWL vs. barrier battle) — do we need per-match-type scoreboard templates?
- In-game-name ↔ `profiles` mapping: fuzzy match, or require players to register their in-game name? Affects ranking attribution.
- Live latency budget: how many frames/segment can we afford at stream cadence without Flash cost spiking?
- Signature collision rate before we dare enforce uniqueness (deliberately deferred).
- Where the pre-pass runs for uploads: reuse the browser result the client already computed, or recompute server-side for trust? (Anti-cheat probably requires server-side.)
