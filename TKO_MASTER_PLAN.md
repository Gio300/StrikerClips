# TKO.cam — Master Build Plan & Principles

**Purpose of this file:** one shared source of truth so work can move between AI assistants
(Claude and ChatGPT) and human sessions without losing the thread. Read this first, follow
the principles, do the phases **in order**, and update the "Status" boxes as things ship.
Last updated: 2026-07-27.

---

## 0. North Star

TKO.cam is a **multi-angle** Shinobi Striker (Naruto 4v4) highlight, live-streaming,
tournament, and creator-economy platform. The unique edge is **seeing one match from
several players' cameras at once** — no one else does this. Everything we build should
protect and amplify that edge, drive **YouTube growth**, and grow **in-app engagement**.

Two repos + one PC pipeline:
- `StrikerClips/` — the web app + API (Vite/React/TS front, Node/Express/TS server). Deploys to Cloud Run service `killcam` (project reelone-498406). Serves tko.cam + tko.cam/app.
- `killcam_clips/` — the Python auto-merge pipeline that runs on the **home PC** (2× RTX A5000).
- The PC also runs Ollama (local models) for vision + text.

---

## 1. Principles (do not violate)

1. **Quality over quantity.** We do NOT auto-merge every match. We produce a *good number*
   of *genuinely great* videos per day — the best multi-angle moments (a kill seen from
   3+ angles, clutch replays). Volume for its own sake hurts YouTube and the brand.
2. **Protect the PC.** The home PC is the auto-merge engine. Never overclock it. One match
   at a time, NVENC (never CPU) encoding, throttled pace, and **delete sources after a
   confirmed upload** so the disk never fills. Health is monitored hourly (see Phase 6).
3. **Ephemeral by default.** Auto pipeline: download → scan → render → upload → **delete**.
   Keep only a small dedup ledger so we never re-produce the same match.
4. **Two formats, one funnel — never scatter.** Every produced match yields TWO videos:
   a **vertical short** (reels/Shorts, top-of-funnel) and a **horizontal grid** (the full
   multi-angle watch). The short points at the full. We never post the same full match twice.
5. **Local AI, used surgically.** Vision (qwen2.5-VL) and text (llama3.3) run locally on the
   A5000s. Use them where they're uniquely good, cache results, and never in a hot per-frame
   loop. They confirm/enhance; deterministic signals (clock, audio, kill-OCR) do the heavy lifting.
6. **Don't break what works.** The pipeline is LIVE and producing. Change behind flags,
   validate on real cached clips before touching the scheduled autopilot, keep a rollback.
7. **Secrets stay secret.** No assistant pastes a live secret key (`sk_live`, service keys,
   API keys) into code or files. The human sets those via env files / Secret Manager. We wire
   the plumbing; the human fills the value.

---

## 2. Current Status Snapshot (ground truth for both AIs)

**Live & working (app, deployed):** power levels + auto-upload→power credit, clan tags +
search, messaging, immersive reel player, artifact tags, Oracle voting + betting economy,
wagering (sweeps-only), TKO-BETA code, guided Live flow, creator dashboard + profile Stats,
role-based Live invites, Ask TKO (Gemini 2.5 Pro on the app).

**Live & working (PC pipeline):** hourly autopilot discovers same-match groups and produces
a **vertical dynamic single-feed** video (`render_dynamic`) and uploads to the TKO YouTube
channel. Same-match detection = in-game **clock** (K=clock+t) + **audio** cross-correlation.

**Built this session, ready/among-flagged:**
- `killcam_clips/tko_synccheck.py` — sync CERTIFIER; reuses production alignment, reports
  per-angle REF/STRONG/CLOCK/LOOSE/DROP + PASS/FLAG. Proves each merge is actually synced.
- `killcam_clips/tko_roster.py` — same-game by **player roster** read with qwen2.5-VL
  (Ollama). Reads gamertags off frames, fuzzy-matches, caches per video. Confirms "same game"
  independent of clock/audio; also audits groupings. **Validated: qwen-VL reads names well.**
- Hourly scheduled task `tko-automerge-qa` — now a **PC HEALTH watchdog** (GPU temp/util,
  disk, autopilot alive + errors, Ollama up). Warns before breakdown.
- `run_autopilot.bat` now loads `killcam_clips/tko_secrets.bat` if present (for the two env
  vars below).

**Known findings (important):**
- The **horizontal multi-angle grid renderer already exists** as `render()` in
  `tko_auto_render.py` (hstack/2×2/4-col → 1920×1080). The vertical short is `render_dynamic`.
  So "two videos" is mostly WIRING, not new rendering.
- **Dynamic sign-up matching + power-credit were silently OFF**: the autopilot launcher never
  set `TKO_API_BASE` / `TKO_SERVICE_KEY`, so every run fell back to the static 4 channels and
  skipped power credit. Fix = create `killcam_clips/tko_secrets.bat` with those two values.
- "Hammy" (GT-WHATDAWUT) is real but hard: his audio doesn't correlate (~100s off) and his
  in-game clock drifts ~64s, so he gets discovered then dropped at the sync gate. Roster match
  is the intended fix (confirm same-game by identity, then loosen the sync gate for him).
- **Visual banner/gauge matching does NOT lock** on real data (tested) — abandoned as a sync
  signal. Roster (identity) is the visual signal that works.

---

## 3. AI Division of Labor (the "brains")

| Job | Tool | Why | Notes |
|---|---|---|---|
| Same-game / roster (identity) | **qwen2.5-VL** (Ollama, local) | Reads gamertags; only signal that proves "same lobby" | Cache per video. Rescue/audit only, not hot loop. |
| Best-moment / angle selection | **deterministic scorer** (local) | kill-OCR + angle coverage + audio/visual energy already computed | NOT an LLM job. Fast, local. |
| Titles + descriptions | **llama3.3** (Ollama, local) | Good text, free, offline | Feed it match metadata (who, kills, event). |
| Hype lines / match "script" | **llama3.3 + the project's saved sayings** → **ElevenLabs** VO | Real AI host voice; reuse the hype-line library already given to the project | Add to existing `tko_reactions.py`. Commentary = toggle (on for app users, off otherwise). |
| Nemotron 3 Ultra (NVIDIA API) | **not for video** | Cloud call — won't offload the PC; wrong shape for angle-picking | Only consider for heavy text reasoning; needs explicit human go + key. |

---

## 4. Video Formats & Placement (the funnel)

- **Vertical short (1080×1920)** — `render_dynamic`, dynamic single-feed of the best moment(s).
  → App **reel scroll** (TikTok-style) + **YouTube Short** + (later) IG Reels / TikTok / FB.
  Tapping it opens the full video.
- **Horizontal grid (1920×1080)** — `render`, synchronized 2-up / 2×2 squad view.
  → App **player walls + news feed** + the **full YouTube upload**. This is the watch-time /
  ad-revenue video and the clearest showcase of multi-angle.
- **Live** = horizontal control-room (host cam + stream chat, already in the app). Auto-cut a
  vertical short from the live's best moment for Shorts/reels. Not two full live videos.

---

## 5. Auto-Merge Prioritization (what gets made, and how much)

We produce a capped number of videos/day, chosen by a **priority score**, not first-come:
- **User tier** (paid tiers + beta rank higher; free tier excluded from auto-upload).
- **In-app engagement** (active creators/hosts, followers, recent activity).
- **Moment quality** (multi-angle coverage of a kill, replay intensity, clutch/multi-kills).
- **PC budget** (a daily cap + one-at-a-time so the machine stays cool and the disk stays clear).
User-initiated "make my clip now" bypasses the queue and renders in the **cloud** (see Phase 8).

---

## 6. PC Health & Safeguards  — STATUS: hourly watchdog LIVE

- Hourly task checks GPU temps/util, disk free, `tko_auto` size + cached-clip count, autopilot
  freshness + errors, Ollama reachability. Warns at GPU >80°C / disk <50GB / growing clip pile.
- Baseline (2026-07-27): GPUs idle ~30°C, disk 932GB free of 4TB.
- Safeguards to enforce in the pipeline: NVENC only, one match at a time, ephemeral cleanup,
  daily render cap.

---

## 7. Build Phases (DO IN THIS ORDER)

> Convention: each phase has an owner-agnostic checklist and a **Done =** line. Any AI can pick
> up the next unchecked item. Mark `[x]` when shipped and add a one-line note.

### Phase A — Turn on what's already built  *(fast, high value)*
- [ ] Human creates `killcam_clips/tko_secrets.bat` → `set TKO_API_BASE=https://tko.cam` +
      `set TKO_SERVICE_KEY=...`. (Launcher already loads it.)
- [ ] Confirm next autopilot run logs "active roster: N channels (live…)" and posts power credit.
- **Done =** new sign-ups (paid/beta) auto-matched + power credited, verified in the log.

### Phase B — Best-moment scorer (read-only side test)  *(safe, proves the pivot)*
**CREATIVE SPEC (operator, 2026-07-27) — the product is FOOTBALL REPLAYS.** A cool moment is
NOT just a loud spot. It is: a knockout AND the buildup leading into it, a big ultimate /
tailed-beast blast (Kurama mouth blast), a long-range or clutch hit, a base/barrier/FLAG STEAL or
objective capture, or 2-player teamwork. The magic is seeing that ONE play from TWO+ angles
(e.g. GIO up top + MRJERRY under the bridge both catch the long-range Kurama ult) and having it
EXPLAINED with excitement. Video rhythm = show the play, then a synced multi-angle REPLAY with
hype commentary, like a sports broadcast.
- [x] `killcam_clips/tko_moments.py`: audio-energy peaks = cheap candidates; **qwen2.5-VL scores
      each candidate frame 0-10 for highlight-ness + type** (knockout/ultimate/longrange/objective/
      teamwork/boring), temp-0 + CACHED = consistent. The old KO-tracker pixel reader FAILS during
      live gameplay (reads allies as KO'd all match) — do NOT rely on it; VL is the consistent judge.
      Validated: VL scored a real K.O. frame 8/10 (read the "K.O." text) vs boring 2/10.
- [ ] Add a WINDOW around each pick (buildup start -> climax), the moment TYPE, and WHICH angles saw
      it, so the renderer can build the play + multi-angle replay.
- [ ] Fold in the shared global EVENT BANNERS (objective/flag/base steals fire the same banner on
      every screen) as extra candidates + cross-angle sync anchors.
- **Done =** scorer reliably surfaces KOs+buildups, ults, long-range hits, and objective steals,
      each tagged with the angles that caught it.

### Phase C creative addition — FOOTBALL-REPLAY structure
Each highlight = live play -> "REPLAY" multi-angle (side-by-side or A-then-B, slowed) -> hype
commentary (llama3.3 + saved sayings -> ElevenLabs) naming the play. Then next play. This is the
render target, fed by Phase B's per-moment {window, type, angles}.

**PROVEN STYLE (operator loved it, 2026-07-27): `killcam_clips/tko_spot.py`** — the commercial
engine IS the target look for the highlight videos: logo-SLAM intro, beat-cut editing on the best
moments, impact SFX (whoosh/boom) on cuts, phonk/action music bed, TKO branding + watermark,
tagline outro. Operator notes to carry into the highlight render:
  - SCREEN SHAKE is EVENT-TRIGGERED, not constant — fire it only on powerful moments (KO / ultimate
    / big hit), which Phase B's scorer/VL already flags. Calm frames stay steady.
  - ADD VOICES — layer the commentary (tkoReactions.json phrase for the moment TYPE + llama3.3 for
    the specific play -> ElevenLabs) over the beats.
So: tko_spot's assembly + Phase B's scored moments (drive the cuts, the shake triggers, and the
commentary) = the new default look for produced highlights. Retire the plain dynamic cut.

### Commentary phrases — ALREADY EXIST (use these, don't invent)
`StrikerClips/server/tkoReactions.json` = ~130 tagged lines (tags: knockout, replay, objective,
base, flag, teamwork, mvp, momentum, opening, closing, victory, brand, crowd, analyst; delivery:
hype/shout/scream/sing/calm/scared). Commentator pipeline: VL moment TYPE -> pick a phrase with the
matching tag -> ElevenLabs voice in that delivery style -> lay over the replay. Brand lines tie to
the multi-angle hook ("Every angle saw that knockout", "Eight angles up. Nowhere to hide", "Instant
replay. Put that back on screen") and "made_highlight" = "That just made the highlight reel."
llama3.3 fills SPECIFIC play details (names/jutsu: "GIO with the Kurama blast from up top!"); the
phrase library supplies the flavor/energy. tko_reactions.py already picks + caches ElevenLabs VO.

**NAME + CLAN CALLOUTS (operator, 2026-07-27) — the recognition hook.** People want to hear THEIR
name and THEIR CLAN in the commentary; being called out is the reward that makes them replay/share.
We already know the lead player + clan per beat (angle label "GIO // AI CLAN" + channel_id->user +
the roster reader's gamertags), so llama3.3 composes a NAMED line ("GIO from AI CLAN with the
knockout!") and ElevenLabs voices it. PACING MATTERS — do NOT name-drop every beat; land the big
named calls on the biggest moments and mix in generic hype between for ups-and-downs rhythm. This
needs fresh ElevenLabs TTS (per-name); the pre-rendered generic reaction clips fill the gaps.
Feeds the "YOU GOT PICKED" payoff (featured card uses the same name).

### Phase B2 — THUMBNAIL generator (the click driver — high priority)
Thumbnails win the click before the video matters. Auto-pick the single highest-VL frame (the ult/
KO/dodge — most emotional + lit-up), and generate an EMOTIONAL, LIT-UP thumbnail: crop to the
action, punch color/contrast/glow, add the player name + a hot tag ("KURAMA BLAST", "STOLEN!"),
TKO brand mark. ComfyUI can stylize/relight it (Phase E). One per video (16:9) + one vertical.

### Feedback loop — the algorithm gets smarter over time
Log every produced video's {moment types, lead players, thumbnail style} + pull its YouTube
performance (views / watch-time / CTR) on a schedule. Feed back to WEIGHT the Phase-B scorer and
the thumbnail choices toward what actually gets played. Start simple (a JSON ledger + a weekly
pull), grow into a real ranking model. This is how "look for the main points over time" compounds.

### "YOU GOT PICKED" — the emotional payoff (make players feel chosen)
Being featured is the reward. When a player lands in a produced highlight: fire a notification
("You made the TKO highlight reel!"), show a "FEATURED: <player>" card on-screen in the video +
the made_highlight line, credit power, and surface it on their profile/wall. This is what makes
players share it and come back — bake it into the auto-poster + app notifications (ties to the
"wire ALL notifications" backlog item).

### Phase C — Quality auto-merge + two videos + ephemeral
- [ ] Producer emits BOTH: vertical short (`render_dynamic`) + horizontal grid (`render`),
      distinct filenames/titles, both uploaded, power credited **once**.
- [ ] Put the horizontal grid on the same robust `_compute_starts` sync the short uses.
- [ ] Render only the **best moments** (from Phase B), not the whole match.
- [ ] Delete source + intermediate files after a confirmed upload (ephemeral).
- [ ] Daily render cap + priority queue (Phase 5 factors).
- **Done =** each qualifying match → 1 short + 1 full, best-moment-focused, disk stays flat.

### Phase D — Roster same-game + keep Hammy
- [ ] Wire `tko_roster.py` into discovery: roster overlap confirms same-game.
- [ ] When roster confirms same-game, loosen the render sync gate so a drifting angle (Hammy)
      is kept and best-effort synced.
- **Done =** a real match keeps all valid angles incl. Hammy, verified by `tko_synccheck.py`.

### Phase E — ComfyUI intros/splash + user reel creation
- [ ] Reinstall ComfyUI on the PC; generate dynamic intro/splash screens for auto-merge videos.
- [ ] User reel builder in-app: choose a splash screen, or OBS-style presets, or upload an image.
- [ ] AI host commentary toggle (llama3.3 + ElevenLabs hype lines) — on for app users, off otherwise.
- **Done =** auto videos have branded intros; users can assemble their own reels with choices.

### Phase F — Titles/host voice quality
- [ ] llama3.3 titles + descriptions from match metadata.
- [ ] Expand `tko_reactions.py` with the project's saved hype-line library → ElevenLabs.
- **Done =** every upload has a sharp title + optional hype VO.

### Phase G — Social distribution (Swoosh → TKO IG/FB, then TikTok)
**Swoosh = the Meta app "Swoosh Care"** (Meta App ID `1572385294429582`; currently a TEST version
"tko test app" on developers.facebook.com). It already has the needed use cases configured:
"Manage everything on your Page" (FB Page publishing), "Manage messaging & content on Instagram"
(IG content publishing), the Marketing API / Meta Ads Manager stack (advertising), Threads API,
and Live Video API. So the vehicle exists — this is config + review + wiring, not a new app.
- [ ] Connect the **TKO Facebook Page** + a **TKO Instagram Business/Creator** account (IG must be
      Business/Creator and linked to the Page).
- [ ] Permissions needed: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`,
      `instagram_content_publish`, `instagram_basic`. Ads side already covered by Marketing API.
- [ ] **Business Verification + App Review** (both flagged pending on the dashboard) — required for
      these publish permissions in production. START THIS EARLY; it gates everything and takes days.
- [ ] Publish a LIVE (non-test) version of the app once review passes.
- [ ] Auto-uploader posting flows:
      - IG Reel: `POST /{ig-user-id}/media` (video container, `media_type=REELS`) → `POST /{ig-user-id}/media_publish`.
      - FB Page video: `POST /{page-id}/videos`.
      - YouTube already wired. Post the VERTICAL short to YT Shorts + IG Reels + FB; the FULL to YT + FB.
- [ ] Store the long-lived Page/IG tokens as secrets (never in code — see Principle 7).
- [ ] TikTok app + bot (separate lift; strict Content Posting API + app review).
- **Done =** one produced short fans out to YouTube + IG + FB automatically.
- Note: the app is under human's Meta account and is READ-only to assistants; the human performs
  verification/review steps and connects the Page/IG. Assistants build the posting code + wiring.

### Phase H — Cloud render for user clips
- [ ] Decide GPU path (Cloud Run GPU / GPU VM / serverless GPU like Modal/Replicate).
- [ ] "Make my clip now" renders in the cloud (instant), auto videos stay on the PC.
- **Done =** users get instant clips without touching the PC's queue.

---

## 8. Cross-AI Working Agreement (Claude ⇄ ChatGPT)

- **This file is the contract.** Before starting, read §1 principles and §2 status. After
  shipping, tick the box and add a one-line note with the date.
- **Ground truth is the code + logs**, not memory. Verify a file/flag still exists before relying on it.
- **Validate on real cached clips** before changing the scheduled autopilot. Keep changes behind
  env flags where possible.
- **Never** handle live secrets (see Principle 7). Wire env/Secret Manager; the human fills values.
- Note that a concurrent AI ("Sol 5.6"/ChatGPT/Codex) may edit the same repo — pull/re-read before large edits.
- Keep the vertical/horizontal split and the "quality over quantity" cap intact — those are product decisions, not implementation details.

---

## 9. Open Decisions / Needs From Human

- [ ] `tko_secrets.bat` values (to switch on dynamic sign-up + power credit).
- [x] Swoosh identified = Meta app "Swoosh Care" (App ID 1572385294429582), a test app on
      developers.facebook.com with FB Page + IG content-publishing + Marketing API use cases already added.
- [ ] Human to: start Business Verification + App Review, connect the TKO FB Page + IG Business account.
- [ ] Daily auto-merge video **cap** target (e.g., 10–20/day?).
- [ ] Confirm the hype-line library location so llama3.3/ElevenLabs can use it.
- [ ] Go/no-go on cloud GPU for user clips (cost).
