# TKO Live Ingest & Remix — plan (capture at OUR ingest, not the device)

## The principle
Today the video pipeline pulls players' YouTube uploads — fuzzy re-recordings of their
screens. For LIVE (a hosted tournament, a go-live), **TKO is the one providing the
stream, the background, and the overlays** — the feed already flows through our system
even when the host uses OBS. So we capture the **clean, source-quality feed at our
ingest** and composite OUR production on top. Never re-record the device.

Two huge wins fall out of this:
1. **Perfect sync for free.** All angles land in one room, server-timestamped — the
   clock-offset / "Hammy" problem simply doesn't exist for live content.
2. **It shows the APP doing its thing** — our branded scoreboard, bracket, lower-thirds,
   background — which is exactly the promo material we want to remix everywhere.

## The framework: LiveKit (Ingress + Egress)
Matches the onesimusRTC stack + AWS. LiveKit gives us all four pieces:
- **Ingress**: accepts **OBS via RTMP or WHIP**, hardware encoders (SRT/RTMP), or a
  browser via WHIP/WebRTC, and publishes it as a track into a LiveKit room. So however a
  host streams, it lands in our room at source quality.
- **The room**: every player's angle + host cams, all time-synced.
- **Egress (record/distribute), server-side, headless-Chrome based:**
  - **Track Egress** → each angle recorded as its own clean MP4 → cloud bucket. These
    are the multi-angle inputs for the highlight producer (pristine + already synced).
  - **Room Composite Egress with a CUSTOM WEB TEMPLATE** → a headless page renders OUR
    React overlays (bracket, scoreboard, names, background) over the feeds → one branded
    **program** MP4/HLS. This is the watch feed and the master to remix.
  - **RTMP-out Egress** → optionally restream the branded program to Twitch/YouTube Live
    at the same time.
- Auto-uploads egress output to a GCS/S3 bucket.

## End-to-end flow
1. Host taps **Go Live** (or a tournament battle starts) → TKO creates a LiveKit **room**
   + mints ingress/publish tokens.
2. Host streams in — **OBS → RTMP/WHIP → Ingress**, or the in-app browser publisher →
   room. Each player angle is a track.
3. **Track Egress** writes clean per-angle MP4s to the bucket; **Room Composite Egress**
   renders the branded program (overlays/bracket/background) for the live watch feed +
   optional Twitch/YouTube restream.
4. A small **bucket → producer bridge** hands the per-angle MP4s to the existing
   `killcam_clips` multi-angle producer. Because they're pristine and synced, it makes
   vertical + horizontal cuts instantly and at full quality.
5. Those cuts post everywhere (app scroll, YouTube, Facebook) — the same routing we
   already have — now showcasing a real, branded live event.

## Why not just keep pulling YouTube
- Quality: source encode vs a screen re-recording.
- Sync: server-timestamped vs guessing from filename clocks.
- Branding: our overlays are IN the capture, so every clip promotes the app.
- Speed: no wait for a player to upload; we already hold the feed.

## Capture tiers — for influencers who run their OWN setup
Many creators already stream from their own OBS to their own YouTube/Twitch and won't
route solely through us. So the go-live flow offers tiers, best-to-fallback — every one
still ends in clean-ish, branded, remixable multi-angle content:

1. **Stream through TKO (cleanest).** OBS/browser points at our LiveKit Ingress URL. We
   hold the source encode; per-angle Track Egress + branded composite as above.
2. **Add TKO as a SECOND OBS output (keep their setup).** They keep streaming to their own
   channel and add our RTMP ingest as an additional stream target (one line in OBS, or a
   built-in restream). We still receive the full-quality source feed in parallel. Lowest
   friction for established influencers.
3. **Pull their PUBLIC live (zero change for them).** They just give us their YouTube/Twitch
   channel/stream link. LiveKit Ingress accepts a URL/HLS input, so we ingest their public
   broadcast into a room, RECORD it, composite our branding, remix, and optionally restream.
   Slightly lower quality (their encode), but they change nothing — this is the "record the
   live, then produce/restream" path.
4. **VOD after the fact.** Once their stream ends, pull the VOD and remix (same as we do for
   uploads today) — the last-resort catch-all.

The Go Live UI surfaces this as: "Stream through TKO" -> "Add TKO as a second output" ->
"Just paste your channel link and we'll capture it." Tiers 2–3 are what make this work for
influencers at scale without forcing them off their own tooling.

## Alternatives considered (if we want more managed ops)
- **Cloudflare Stream** or **Mux** — ingest (RTMP/SRT/WHIP) + recording + delivery in one
  managed API; simplest ops, but multi-angle compositing is on us.
- **Amazon IVS** — ultra-low-latency + auto-record to S3; great delivery, weaker on
  custom multi-track compositing.
- **Ant Media Server** — self-host RTMP/WebRTC + recording.
LiveKit wins here because we need **multi-angle in one room + custom-branded compositing**,
and we already run it.

## Fit with the current app (additive, no UI restyle)
- **Go Live** button → create room + ingress token (replaces/augments the current
  `getUserMedia`-only path in `useCameraStream.ts`).
- **Director / Program** view = the Room Composite Egress layout template (our overlays).
- **Tournament battle = a room**; the animated bracket overlay (see TKO_APP_ANALYSIS.md)
  is part of the composite template and reads `tournament_battles`.
- **Guest hosts/casters** simply join the room to commentate (the multi-host ask).
- **Ask TKO** already page-aware — on a live/tournament page it can explain what's happening.

## Phased rollout
1. **Stand up LiveKit Ingress+Egress** on the existing AWS infra. Prove: OBS → RTMP →
   room → Track Egress → clean MP4 in the bucket.
2. **Bucket → producer bridge**: auto-produce vertical + horizontal from one live session.
3. **Custom composite template** with TKO overlays/bracket = branded program + watch feed.
4. **Wire Go Live + tournaments** to spin rooms; add multi-host + optional Twitch/YT restream.

## Boundaries with Codex
LiveKit deploy, Ingress/Egress config, and the bucket→producer bridge are new infra +
pipeline-side (safe to build in parallel). The app-side Go-Live/room wiring is additive
and can be staged so it doesn't disturb current live UI.
