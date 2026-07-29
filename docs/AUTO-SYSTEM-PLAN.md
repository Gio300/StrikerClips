# TKO Auto-System — what the auto-worker and auto-live actually do (2026-07-24)

Source of truth for the self-running video system. Guiding principle (founder):
**the system runs itself** — match, render, voice, post, and update the app with
no one supervising. Everything below is what "auto-worker" (already-happened
matches) and "auto-live" (real-time broadcasts) are responsible for.

---

## A. AUTO-WORKER — already-happened matches → YouTube (unattended)

The Cloud Run Job `tko-render-worker` runs every 5 min. Each run:

1. **Claim** the next `pending` render_job (atomic, so parallel runs never double-process).
2. **Resolve sources** — for each clip in the job, download the angle: `yt-dlp`
   for YouTube-hosted uploads (the dominant path — members connect YouTube),
   direct download for uploaded files.
3. **Assemble** the multi-angle video. NOT a static 2×2 grid by default (see §C):
   - **Director cut (default):** auto-switch to the angle with the action
     (low-health target, the kill, the ult), holding each cut to the beat.
   - Clock-align all angles to the same in-game instant first (the detector reads
     the match clock off each upload).
   - Intro sting + final **K.O. replay** on the finishing blow.
4. **Voice (ElevenLabs):** lay an **urban caster VO** over kills and big moments —
   "he got him," "that's a wrap," reacting to ults/clutches. This is the
   background the founder wants to HEAR — never ship a silent grid.
5. **Upload** to the TKO YouTube channel (resumable upload, OAuth refresh token).
6. **Write back** the `youtube_id` + URL onto the match + clips, mark job `done`.
7. **Notify** every participant: "your multi-angle video is live" + link.
8. **App feed:** the new video appears in the app's **Recent videos** feed
   automatically (home + the participants' profiles).

### Auto-post rules (who/what posts)
- **Matched (≥2 angles of one match)** by a **paid member with YouTube connected**
  → auto-assembled + auto-posted to the TKO stream/channel.
- **Solo / unmatched clip** → does NOT post to the stream unless the user
  explicitly posts it themselves.
- **Free users** may upload but must watch an ad to do so (AdMob, §E).

### No host? Don't waste the real estate (founder rule, NEW)
When an auto-merged video has **no host commentary**, do **not** render an empty
host slot / host lane. Instead show the clip in **director-cut default** (auto-
switching angles) with the **ElevenLabs urban VO** doing the calling. The host
lane only appears when a host actually claimed the match (§D).

---

## B. AUTO-LIVE — real-time broadcasts

1. **Ingest** angles live (players streaming, or a host — §D).
2. **Delay buffer:** run a short delay so the AI can cut to the right part of the
   action *before* it reaches the viewer.
3. **Director cut in real time:** auto-focus the low-health target, cut replays to
   the beat — nobody at a switcher.
4. **Live VO:** ElevenLabs caster reacting live on kills/big moments.
5. Viewer can switch to the 2×2 quad manually, but default is the director cut.

---

## C. THE VIEW — director cut is the default, always

- **Default = director cut** (auto-switching angles to the action). A constant
  2×2 grid is shown ONLY if the viewer explicitly switches to it.
- Phones get one focused feed + a swipeable angle strip (quad hidden below tablet).
- Live carries the delay so the cut leads the action.

## D. HOST LANE (built — feat/host-flow)

- A host enters `/host` (gated by founder host code). Two modes:
  - **Host a live match** — connect OBS (obs-websocket) or use the phone camera/mic.
  - **Add commentary to an already-happened match** — record over an existing reel.
- Produces the **"with host"** version. Versions are user-pickable:
  **with host / without host**, **with chat / without chat** — baked into the
  video naming + the player's version picker.
- If NO host claims a match → the without-host director cut (§A rule) is the only
  version; no empty host UI.

## E. MONETIZATION HOOKS (tie-ins, tracked elsewhere)
- **AdMob:** paid users see no ads; free users see ads + must watch one to upload.
- **YouTube channel monetization** on the TKO channel.
- **Stripe:** every signup gets a free week of Basic (card on file, 7-day trial);
  competitors get a free month. (Verify functional — separate task.)
- **Facebook auto-poster (thisbot):** auto-post finished videos to Facebook.

## F. INTEGRITY / STATS (develop over time)
- AI stat check (done). Track ult/jutsu + boost timing; flag inconsistency
  (anti-cheat / anomaly detection). Batch is fine, not real-time.

---

## Build status / checklist
- [x] Worker deployed (Cloud Run Job + 5-min Scheduler), self-heals its schema.
- [x] Queue mechanics (claim/complete/fail/notify), atomic, tested.
- [x] Source resolution (yt-dlp / download), basic ffmpeg composite.
- [x] Host lane (/host, OBS + phone, past-match commentary, with-host versions).
- [ ] **Director-cut assembly** in the worker (currently xstack grid) — §A/§C.
- [ ] **ElevenLabs urban VO** baked into the worker output — §A.4.
- [ ] **No-host → director-cut default** wired end to end — §A rule.
- [ ] **Recent videos feed** in the app auto-updates on `done` — §A.8.
- [ ] First real auto-match video posted to YouTube (proof).
- [ ] Auto-live delay + real-time director cut + live VO — §B.
- [ ] Stripe multi-user charge dry-run verified — §E.
- [ ] Versioning labels (with/without host, with/without chat) in the picker — §D.
