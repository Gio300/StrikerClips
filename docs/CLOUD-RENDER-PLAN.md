# Cloud render plan — get TKO rendering off the PC

**Goal:** the multi-angle render pipeline must run whether or not the user's
Windows machine is on. Today the full-quality render (1080p H.264 via
`h264_nvenc`, ~5-min / ~450 MB videos, assembled from 2–4 audio-synced YouTube
angles) runs locally on the user's NVIDIA GPU through `tko_auto_render.py` /
`tko_autopilot.py`. This document is the concrete, costed plan to move that to
the cloud.

**Pricing basis:** July 2026 published rates, US regions (AWS `us-east-1`, GCP
`us-central1`). Sources listed at the end. All per-video math assumes the render
job profile in the task: ~2–3 min of active GPU encode + download of 2–4 angles
+ upload of one ~450 MB output ≈ **6–10 min of wall-clock per job** (use 8 min as
the working figure). On a GPU you pay for the whole window even though the GPU is
only hot for 2–3 min of it; that idle-but-paid time is why CPU-only stays
competitive per-video and why serverless/scale-to-zero matters.

---

## TL;DR recommendation

1. **Now (low volume): keep it on GCP Cloud Run, CPU `libx264`, as a Job +
   Scheduler.** This is *already built and deploy-ready* in this repo
   (`Dockerfile.worker`, `server/renderWorker.run.ts`, `deploy-worker.ps1`,
   `docs/RENDER-WORKER-DEPLOY.md`). It reads the same `render_jobs` queue in
   Cloud SQL, scales to zero between ticks, costs **~$0.05/video**, and has **no
   dependency on the PC**. Ship this first — it decouples from the machine today.
2. **When you want NVENC / the full pipeline speed: add a GPU to the *same*
   Cloud Run worker** (`--gpu 1 --gpu-type nvidia-l4`). One flag, same DB wiring,
   same queue, scales to zero, **~$0.16/video all-in**. NVENC (`h264_nvenc`)
   runs on the L4.
3. **Only move to a dedicated GPU VM (AWS `g4dn` spot / always-on) once monthly
   volume passes ~2,000–3,000 videos**, where a cheap steady spot GPU beats
   per-job serverless. Below that it's more ops for no savings.

Egress note up front: **uploading to YouTube from GCP is Google-network → Google
traffic and is effectively free.** That single fact makes GCP the right home and
removes the biggest hidden cost (450 MB out per video).

---

## 1. GPU options with current pricing + $/video

$/video below = (instance $/hr) × (8 min ÷ 60) = $/hr × 0.133, i.e. the full
8-min job window. Spin-up/boot overhead is called out separately because it only
bites if you launch a fresh VM per job instead of draining a batch.

### AWS EC2 GPU (us-east-1)

| Instance | GPU | Spec | On-demand $/hr | Spot $/hr | $/video on-demand | $/video spot |
|---|---|---|---|---|---|---|
| `g4dn.xlarge` | 1× T4 (16 GB) | 4 vCPU / 16 GB | **$0.526** | **~$0.23** | $0.070 | **$0.031** |
| `g5.xlarge` | 1× A10G (24 GB) | 4 vCPU / 16 GB | **$1.006** | **~$0.442** | $0.134 | $0.059 |

- `g4dn.xlarge` (T4) is the right AWS size for this workload — a T4 does
  `h264_nvenc` 1080p far faster than realtime; the A10G in `g5` is overkill for a
  5-min composite and costs ~2×.
- Spot is ~55–65% off and **safe for this workload**: renders are idempotent and
  the queue already retries (`failJob` re-queues up to 3 attempts). A spot
  reclaim just puts the job back to `pending`.
- **Boot overhead:** a fresh EC2 GPU instance takes ~1.5–3 min to boot + pull the
  container before it can render. If you launch one VM *per video* you pay for
  that (~$0.01–0.02 extra/video on spot) and add latency. Amortize it by draining
  the whole queue per launch.
- **Egress:** YouTube upload from AWS is billed egress — 100 GB/mo free, then
  **$0.09/GB**. At 450 MB/video that's ~$0.04/video *once you're past the 100 GB
  free tier* (~222 videos/mo). This is the tax for hosting the worker off-Google.

### GCP GPU (us-central1)

| Option | GPU | Spec | On-demand $/hr | Spot $/hr | $/video on-demand | $/video spot |
|---|---|---|---|---|---|---|
| `g2-standard-4` VM | 1× L4 (24 GB) | 4 vCPU / 16 GB | **~$0.85** | **~$0.30–0.40** | $0.113 | ~$0.047 |
| `n1-standard-4` + T4 | 1× T4 (16 GB) | 4 vCPU / 15 GB | **~$0.54** | **~$0.15–0.20** | $0.072 | ~$0.024 |
| **Cloud Run GPU (L4)** | 1× L4 | 4 vCPU / 16 GB min | **~$1.18 all-in** | n/a (scales to zero) | **~$0.16** | — |

- `n1 + T4` spot is the cheapest raw GPU on GCP (~$0.024/video) — GPU add-on
  ~$0.35/hr on-demand, ~$0.08/hr spot, plus the n1 base.
- **Cloud Run GPU (L4)** bills per-second: GPU ≈ $0.0001867/GPU-s (~$0.67/hr) +
  the required 4 vCPU / 16 GB (~$0.51/hr) ≈ **$1.18/hr all-in**, but **scales to
  zero** — you pay only for the seconds a render is actually running, no idle
  cost, no VM lifecycle to manage. That convenience is why its per-video number
  ($0.16) is higher than a raw spot VM yet it's the recommended GPU path.
- **Egress:** GCP → YouTube is Google-to-Google → **~$0 egress.** This is the
  decisive advantage over AWS for this app.

---

## 2. CPU-only fallback (no GPU) — realistic time + $/video

**This path already exists in the repo.** `server/renderWorker.run.ts`'s
`composite()` uses `-c:v libx264 -preset veryfast -crf 20`, and
`Dockerfile.worker` + `deploy-worker.ps1` already target Cloud Run. So "CPU
fallback" isn't new work — it's the current deploy-ready worker.

**Time per video (CPU):** decoding 2–4 angles, scaling each to 960×540, xstack
into a grid, and `libx264 veryfast` encoding ~5 min of 1080p output on 2 vCPU
runs roughly **10–15 min wall-clock** (the multi-input decode/scale dominates,
not the encode). Bumping to 4 vCPU roughly halves that to ~6–8 min but doubles
the per-second rate, so total cost is ~flat. Quality at `veryfast/crf 20` is
fine for YouTube; you just lose the NVENC speed and the advanced pipeline
(intro / K.O. replays / caster VO — see §5).

**$/video (Cloud Run, CPU):** at GCP Cloud Run rates (vCPU $0.000024/vCPU-s, mem
$0.0000025/GiB-s):

- 2 vCPU / 2 GiB × 900 s (15 min): vCPU $0.043 + mem $0.005 ≈ **$0.048/video**
- 4 vCPU / 4 GiB × 450 s (7.5 min): vCPU $0.040 + mem $0.005 ≈ **$0.045/video**

Plus request/CPU-idle overhead that's negligible, and **$0 egress to YouTube**.
Cloud SQL is already running for the app, so the queue read is free.

**Small CPU VM alternative:** an `e2-standard-4` (~$0.134/hr) or AWS
`c7g.xlarge` (~$0.145/hr) doing 15 min/video = ~$0.03–0.04/video, but you then
own an always-on or lifecycle-managed VM for no savings over serverless Cloud
Run. Not worth it at low volume — **Cloud Run Job is the better CPU fallback.**

**Verdict on CPU:** cheapest per-video of everything (~$0.05) and already built.
The only reasons to add GPU are (a) render latency — 10–15 min vs 2–3 min — and
(b) running the heavier Python pipeline fast. At a handful of matches, CPU is the
correct answer *today*.

---

## 3. Recommended architecture (spin-up-on-demand → drain → spin-down)

The current design is already the right one. It needs no schema change.

```
auto-match (server/autoMatch.ts) groups ≥2 angles
        │
        ▼
render_jobs row -> status 'pending'         (Cloud SQL: reelone-498406 killcam)
        │
Cloud Scheduler tick (every 2–5 min)  ──►  runs Cloud Run JOB (--once)
        │                                        │  (container scales up from zero)
        │                                        ▼
        │                             claimNextJob() atomic claim  ──┐
        │                             yt-dlp download 2–4 angles     │  loop until
        │                             ffmpeg composite (CPU or GPU)  │  queue empty
        │                             upload to TKO YouTube channel  │
        │                             completeJob(): stamp link,     │
        │                               notify every participant  ◄──┘
        ▼
queue empty  ──►  container exits  ──►  $0 until the next tick
```

- **Spin-up on demand:** Cloud Scheduler → Cloud Run Job (`renderWorker.run.ts
  --once`). Container starts only when there's a tick; if the queue is empty it
  exits in seconds. Between ticks you pay nothing (scale to zero).
- **Drain the queue:** `drainQueue()` processes every `pending` job in one launch,
  so boot cost is paid once per batch, not per video.
- **Spin down:** `--once` exits after draining. No idle instance.
- **Retry / interruption safety:** `failJob()` re-queues up to 3 attempts. A spot
  reclaim, a crash, or a YouTube hiccup just leaves the row `pending` for the
  next tick. This is what makes spot GPUs safe here.
- **CPU vs GPU is one env flag.** Add `RENDER_ENCODER` (default `libx264`) to
  `composite()`; set it to `h264_nvenc` only in the GPU image/deploy. Same code,
  same queue, same DB — the encoder is the only difference.

**Always-on vs on-demand:** keep it on-demand (scale-to-zero) until volume is
high and steady. An always-on GPU is only worth it when you'd otherwise be
spinning up almost continuously. Crossover math:
- Always-on `g4dn.xlarge` **spot** ≈ $0.23/hr × 730 ≈ **$168/mo** (interruptible)
  or **on-demand ≈ $384/mo**; 1-yr reserved ≈ ~$230/mo.
- Always-on **Cloud Run GPU** (min-instances=1) ≈ $1.18/hr × 730 ≈ **$861/mo** —
  don't do this; it defeats the point of serverless.
- On-demand AWS spot per-video ≈ $0.038. Always-on spot ($168) only wins past
  **~4,400 videos/mo**. So stay on-demand well beyond the 1,000/mo horizon.

### Rough monthly cost by volume

Includes render compute + YouTube-upload egress. Cloud SQL is a pre-existing
fixed cost and excluded.

| Path | 10 vids/mo | 100 vids/mo | 1,000 vids/mo | Notes |
|---|---|---|---|---|
| **Cloud Run CPU (`libx264`)** — *recommended now* | **~$0.50** | **~$5** | **~$50** | $0 egress (Google→YouTube); 10–15 min/video |
| **Cloud Run GPU (L4)** — *recommended when NVENC needed* | ~$1.60 | ~$16 | ~$160 | $0 egress; 2–3 min/video; scale-to-zero |
| GCP `n1`+T4 **spot** VM, on-demand launch | ~$0.24 | ~$2.40 | ~$24 + lifecycle ops | $0 egress; you manage VM/preemption |
| AWS `g4dn` **spot**, on-demand launch | ~$0.40 | ~$4 | ~$38 + **~$31 egress** | egress: 450 GB−100 free = 350 GB × $0.09 ≈ $31/mo at 1k |
| AWS `g4dn` **always-on** spot | ~$168 | ~$168 | ~$168 + $31 egress | only sensible >~4,400/mo |

The GCP `n1`+T4-spot column is the theoretical cheapest at scale, but the savings
vs Cloud Run GPU at 1,000/mo (~$24 vs ~$160) come with real ops cost: a managed
instance group, preemption handling, boot orchestration, and a GPU quota
request. Not worth it until you're clearly past ~1,000/mo and the $140/mo
delta matters.

---

## 4. Data egress

Each video uploads ~450 MB outbound to YouTube. Downloads (yt-dlp pulling the 2–4
source angles) are *inbound* and free on both clouds.

- **GCP (worker on GCP) → YouTube:** Google-network to Google-service. Effectively
  **$0 egress.** At 1,000 videos/mo that's ~450 GB out that costs nothing. This is
  the single biggest reason to keep the worker on GCP.
- **AWS (worker on AWS) → YouTube:** billed internet egress. **100 GB/mo free**,
  then **$0.09/GB** (first 10 TB tier). That's ~222 free videos/mo, then
  ~$0.04/video. At 1,000/mo ≈ **$31/mo** of pure egress tax — more than the AWS
  compute itself on spot.
- **Cross-cloud gotcha:** if you ran the worker on AWS but keep the queue in GCP
  Cloud SQL, the DB round-trips are tiny (kilobytes) so egress there is
  negligible — the 450 MB YouTube upload is the only egress that matters, and it's
  AWS→internet either way.

**Conclusion:** egress alone makes GCP the cheaper home for this workload despite
AWS `g4dn` spot having the lowest raw GPU $/hr.

---

## 5. Recommendation + concrete next steps

### Recommendation

**Stay entirely on GCP. Do not add a second cloud.** Reasons: (1) the queue
(`render_jobs`) and DB (Cloud SQL `reelone-498406:us-central1:reelone-db`) are
already there; (2) the worker is already built and Cloud-Run-shaped; (3)
YouTube-upload egress is free from GCP and ~$0.04/video from AWS; (4) Cloud Run
scales to zero so idle cost is $0 at today's low volume.

Two phases, gated on when you actually need NVENC:

- **Phase 1 — CPU, now.** Deploy the existing worker as a Cloud Run **Job +
  Scheduler** (Option A in `docs/RENDER-WORKER-DEPLOY.md`). ~$0.05/video, ~$0.50/mo
  at current volume, PC fully out of the loop. NVENC gives zero benefit here —
  the whole point is decoupling from the machine, and `libx264` on Cloud Run does
  that today.
- **Phase 2 — add GPU when needed.** When render latency (10–15 min) or the full
  Python pipeline (§ below) demands it, add `--gpu 1 --gpu-type nvidia-l4` to the
  *same* worker and flip `RENDER_ENCODER=h264_nvenc`. ~$0.16/video, still
  scale-to-zero, still $0 egress.

**Spot vs on-demand:** on Cloud Run there's no spot knob — scale-to-zero already
gives you "pay only while rendering." *If* you ever move to a raw GPU VM, use
**spot** (renders are retryable; the queue re-queues on reclaim) and launch
on-demand per batch, not always-on.

### The one real gap: two render pipelines

The Cloud Run worker's `composite()` is a **simpler xstack grid** (scale →
2×2 stack → `libx264`). The user's local `tko_auto_render.py` / `tko_autopilot.py`
is the **full pipeline** (NVENC, clock-align, intro, K.O. replays, ElevenLabs
caster VO). Moving rendering off the PC has two flavors:

- **1a (fastest to ship):** accept the grid composite in the cloud for
  auto-matches. Retires the PC immediately; auto-videos are simpler than the
  hand-built ones.
- **1b (quality parity):** containerize the Python pipeline itself (its own
  `Dockerfile`, `python3` + ffmpeg + yt-dlp + the ElevenLabs key as a secret) and
  run *that* as the Cloud Run Job, driven by the same `render_jobs` queue. This is
  the long-term canonical worker. Do it when quality parity matters more than
  speed-to-ship. Note: this Python script was not found in the `StrikerClips`
  repo — it likely lives in `killcam_clips/` or alongside `tko_auto_render.py`;
  locate and containerize it for 1b.

Recommended: ship **1a** now (it's basically running `deploy-worker.ps1`), then do
**1b** as a follow-up so cloud output matches the hand-built video — at which
point Phase 2's GPU flag pays off because the Python pipeline is heavier.

### Concrete implementation steps

1. **Phase 1 deploy (CPU, today).** From `StrikerClips/`, run the existing flow
   in `docs/RENDER-WORKER-DEPLOY.md` Option A:
   ```
   gcloud builds submit --tag us-central1-docker.pkg.dev/reelone-498406/killcam/tko-render-worker:latest \
     --project reelone-498406 -f Dockerfile.worker .
   gcloud run jobs create tko-render-worker \
     --image us-central1-docker.pkg.dev/reelone-498406/killcam/tko-render-worker:latest \
     --region us-central1 --project reelone-498406 \
     --set-cloudsql-instances reelone-498406:us-central1:reelone-db \
     --set-env-vars INSTANCE_CONNECTION_NAME=reelone-498406:us-central1:reelone-db,DB_NAME=killcam,DB_USER=postgres,YOUTUBE_CLIENT_ID=<id> \
     --set-secrets DB_PASSWORD=reelone-app-db-password:latest,YOUTUBE_CLIENT_SECRET=youtube-client-secret:latest,YOUTUBE_REFRESH_TOKEN=youtube-refresh-token:latest \
     --memory 4Gi --cpu 4 --task-timeout 3600 --max-retries 1
   ```
   (Bump to `--cpu 4 --memory 4Gi` vs the doc's 2/2 to cut CPU render time to
   ~6–8 min at ~the same cost.) Then the Cloud Scheduler tick (every 5 min).
   `deploy-worker.ps1` scripts all of this; the only manual gate is confirming the
   DB-password secret name, which is `reelone-app-db-password:latest`.
2. **Prove the loop.** `gcloud run jobs execute tko-render-worker --wait` and
   watch it claim a `render_jobs` row, composite, upload, stamp the YouTube link,
   and notify participants. This is the moment the PC is no longer required.
3. **Add the encoder flag.** In `composite()`, read `process.env.RENDER_ENCODER`
   (default `libx264`) and pass it to `-c:v`. Commit; CPU deploy keeps default.
4. **Phase 2 (GPU) when triggered.** Rebuild the image on an NVENC-capable base
   (CUDA-enabled ffmpeg) and redeploy the Job with GPU:
   ```
   gcloud run jobs update tko-render-worker \
     --gpu 1 --gpu-type nvidia-l4 --region us-central1 --project reelone-498406 \
     --set-env-vars ...,RENDER_ENCODER=h264_nvenc
   ```
   (GPU on Cloud Run Jobs may require a quota request and a Tier-1 region —
   `us-central1` qualifies.)
5. **Phase 2b (quality parity, optional).** Locate `tko_auto_render.py` /
   `tko_autopilot.py`, write a `Dockerfile.autopilot` (python3 + CUDA ffmpeg +
   yt-dlp + ElevenLabs secret), have it read `render_jobs` and use the same
   `claim/complete/fail` semantics, and swap it in as the canonical worker image.
6. **Watch the crossover.** Track monthly video count. Stay on Cloud Run
   (CPU or GPU) until you're consistently past ~1,000/mo *and* latency-bound;
   only then evaluate a dedicated `n1`+T4-spot or `g4dn`-spot managed instance
   group. Revisit egress only if you'd ever host off GCP — on GCP it stays ~$0.

### Ties into the existing `render_jobs` queue

No schema change. The queue in `db/schema.sql` already has everything:
`status ∈ (pending, rendering, uploading, done, failed)`, `attempts`,
`match_key` (dedupe), `youtube_id`, `combined_video_url`, `error`. The worker's
`claimNextJob` / `completeJob` / `failJob` (tested in `server/renderWorker.test.ts`)
already do atomic claim, link-stamping, participant notification, and bounded
retry. Cloud (CPU or GPU) changes **where** the container runs and **which
encoder** it uses — the queue contract is untouched. That's what makes this a
low-risk move: the DB, the auto-match producer, and the worker's queue logic all
stay exactly as they are.

---

## Sources (July 2026)

- AWS `g4dn.xlarge` on-demand/spot — [Vantage](https://instances.vantage.sh/aws/ec2/g4dn.xlarge), [DoiT Compute spot us-east-1](https://compute.doit.com/spot/us-east-1/g4dn.xlarge)
- AWS `g5.xlarge` on-demand/spot — [Vantage](https://instances.vantage.sh/aws/ec2/g5.xlarge), [DoiT Compute spot us-east-1](https://compute.doit.com/spot/us-east-1/g5.xlarge)
- AWS data-transfer-out pricing — [EgressCost.com AWS](https://egresscost.com/aws/data-transfer-pricing/)
- GCP GPU VM pricing (L4, T4, `g2`/`n1`) — [Google Cloud GPUs pricing](https://cloud.google.com/compute/gpus-pricing), [Thunder Compute GCP GPU guide](https://www.thundercompute.com/blog/google-cloud-gpu-instances), [`g2-standard-4` CloudPrice](https://cloudprice.net/gcp/compute/instances/g2-standard-4)
- GCP T4 pricing — [Thunder Compute T4 pricing](https://www.thundercompute.com/blog/nvidia-t4-pricing)
- Cloud Run GPU (L4) per-second pricing / scale-to-zero — [Cloud Run pricing](https://cloud.google.com/run/pricing), [Cloudchipr Cloud Run pricing guide](https://cloudchipr.com/blog/cloud-run-pricing)
- GCP egress pricing — [Google Cloud Network Tiers pricing](https://cloud.google.com/network-tiers/pricing), [EgressCost.com GCP](https://egresscost.com/gcp/)
