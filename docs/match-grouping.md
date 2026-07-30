# Match grouping — auto-categorize + "bunch clips of the SAME match" (v1)

Status: shipped (zero-cost, client-side). This is the first real layer that turns
a scroll of loose uploads into **bunches** — every angle of one match grouped so
the UI can say *"3 other angles of this match — add all."* It is a metadata +
client-OCR heuristic; the future cloud vision reader (see
[`ai-video-system.md`](./ai-video-system.md)) enhances it without changing the
grouping logic.

## Pieces

| Concern | Where |
|---|---|
| Pure grouping engine (types + rule + confidence + suggestions) | `src/lib/matchGrouping.ts` |
| Unit tests | `src/lib/matchGrouping.test.ts` |
| Auto-categorize on add + source→`ClipMeta` bridges + localStorage scaffold | `src/lib/clipRecords.ts` |
| "Other angles of this match — Add all" UI + per-clip result-screen OCR | `src/pages/CreateHighlight.tsx` |
| Persistence tables | `db/schema.sql` (`match_groups`, `clip_records`) |

## The heuristic

Each clip is normalized to a **`ClipMeta`**: `clipId`, `playerId` (uploader,
also counted as a participant), optional `participants[]`, `recordedAt` /
`uploadedAt` (epoch ms), `durationSec`, an optional **`resultSignature`**
(`outcome` victory/defeat/draw, `kills`/`deaths`/`assists`, `map`/`mode`,
`scoreLine`) read from a result screen, `category`, and an optional `lobbyId`
(host/lobby match id when the platform provides one).

`matchSignature(meta)` produces a stable, normalized fingerprint (sorted
participant handles + outcome + normalized score + mode + map + duration bucket +
lobby), and a `raw` string used for hashing.

**Two clips are the same match (`sameMatch`) when ALL hold:**

1. **Time** — their time-windows (`[recordedAt, recordedAt + durationSec]`,
   falling back to `uploadedAt`, point-windows when no duration) are within the
   **time tolerance** of each other.
2. **Link** — they share **≥1 participant** OR the **same `lobbyId`**.
3. **Compatible result** — signatures don't contradict: outcomes agree
   (victory/defeat pair freely as opposing angles; a draw must be a draw for
   both), score lines are equal **or reversed** (`3-1` ↔ `1-3`), `mode`/`map`
   match when both present, and reported durations are close.

Clips are then clustered with union-find (O(n²) pairwise — fine for a user's
library). Each group gets a **deterministic `matchId`** = FNV-1a hash of
`earliestClipId + mergedSignature.raw`, so re-runs and reordered input yield the
same id. `sharedParticipants` = handles present in ≥2 clips.

### Tolerances (defaults, all overridable via `GroupOptions`)

| Constant | Value | Why |
|---|---|---|
| `timeToleranceMs` | **3 min** | Angles of one match are uploaded/recorded close together; 3 min absorbs clock skew + trim offsets without merging back-to-back matches. |
| `durationToleranceMs` | **90 s** | Same match seen by different players runs roughly the same length; 90 s absorbs different start/stop points. |
| duration bucket | **30 s** | Signature duration is bucketed so near-equal lengths hash identically. |

### Confidence (0..1)

Starts at **0.4** (overlapping time-window got them grouped) and adds: **+0.3**
shared lobby id across all clips, **+0.2** ≥1 shared participant, **+0.1** ≥2
shared participants, **+0.1** when ≥2 clips carry a result signature (else +0.05
when any mode/map/score is known). A lone clip is `0.5` (trivially its own match,
nothing corroborates it). Clamped to 1.

`suggestOtherAngles(target, library)` groups `[target, …library]` and returns the
other clips in the target's group, time-sorted — exactly what powers the bunch
affordance.

## Auto-categorization on add

`src/lib/clipRecords.ts` hooks the add/upload flow:

- When a clip is added in `CreateHighlight` (`addYoutubeClip`), we build a
  normalized `ClipRecord` (reusing `clipSearch.ClipRecord`, which already has
  `matchId`/`category`) — **category inferred from the title** via the existing
  `clipSearch` parser, `youtubeId`/`recordedAt` filled — and upsert it to a
  per-user localStorage store (`kc_clip_records:<userId>`), mirroring
  `assets.ts`/`predictions.ts`. Idempotent, keyed by YouTube id.
- When the user attaches a **match-result screenshot** ("Tag result" on a clip),
  we run the existing **`ocrMatchResult.parseMatchScreenshot`**, turn the read
  into a `ResultSignature`, and overlay it on that clip's `ClipMeta` so grouping
  immediately sharpens. **Graceful on low confidence** — we store whatever was
  read and never block the user.

Source→`ClipMeta` bridges (`libraryVideoToMeta`, `squadClipToMeta`,
`recordToMeta`) map the connected YouTube library, the squad shelf, and stored
records into the engine, parsing opponents out of "vs X" / "@handle" phrasing.

## The "Add all angles" bunch UI

In `CreateHighlight`, a candidate pool of `ClipMeta` is assembled from the user's
connected library + their squad's clips + a demo match, deduped, with OCR result
signatures overlaid. For every clip already in the reel we run
`suggestOtherAngles` over that pool; the union (minus already-added clips) renders
as **"Other angles of this match (N)"** with a one-tap **Add all** button plus
per-angle thumbnails. Adding routes through the real `addYoutubeClip` handler, so
suggestions arrive as **match bunches**, not loose videos.

## How the future vision reader augments this

The cloud reader (Gemini Flash, per `ai-video-system.md`) does not replace the
grouping rule — it **feeds a richer `resultSignature`**: authoritative
outcome/score/K-D-A off the scoreboard, a real player roster, and a server-side
`matchSignature`/`lobbyId`. Higher-fidelity signatures mean `resultsCompatible`
rejects false merges more precisely and `groupConfidence` climbs, while the exact
same `groupClipsByMatch` / `suggestOtherAngles` code — and the `match_groups` /
`clip_records` tables — stay unchanged. v1 is the pre-pass; the reader is the
sharpener.
