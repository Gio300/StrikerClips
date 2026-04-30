# ReelOne YouTube auto-uploader

Browser side: a creator clicks **Upload to ReelOne YouTube** on a finished
reel. We insert a row into `public.pending_uploads`. That's it.

Server side: a small Node worker (`scripts/youtube-uploader.ts`) polls the
queue, downloads each source clip with `yt-dlp`, bakes a multi-angle
composite with `ffmpeg`, and uploads to OUR YouTube channel via the
**googleapis YouTube v3** OAuth flow. The resulting `youtube_video_id` is
written back to the row so the UI can switch the embed from the user's
original to the monetized re-upload.

This split is intentional:

- The browser stays cheap — no FFmpeg-WASM, no Google login popup, no slow
  upload from a phone tether.
- The worker can run anywhere — your laptop, a $5/mo VPS, a cron job on a
  Raspberry Pi. It only needs network and disk.

## One-time prerequisites

1. Install **yt-dlp** (already on your PC for the Kmhg promo):
   ```bash
   pipx install yt-dlp   # or: brew install yt-dlp
   ```
2. Install **ffmpeg**:
   ```bash
   choco install ffmpeg   # Windows
   # or: brew install ffmpeg
   # or: sudo apt install ffmpeg
   ```
3. Create a Google Cloud project and enable the **YouTube Data API v3**:
   <https://console.cloud.google.com/apis/library/youtube.googleapis.com>.
4. Configure an OAuth consent screen (External). Add your YouTube channel
   as a test user.
5. Create OAuth credentials of type **Desktop app**. Save the
   `client_id` and `client_secret`.
6. Get a **refresh token** by running the OAuth Playground:
   - Open <https://developers.google.com/oauthplayground/>.
   - Click the gear ⚙ → "Use your own OAuth credentials" → paste your
     `client_id` / `client_secret`.
   - In the left sidebar, paste these scopes (one per line):
     ```
     https://www.googleapis.com/auth/youtube.upload
     https://www.googleapis.com/auth/youtube
     ```
   - Click **Authorize APIs** and sign in with the channel that should host
     the uploaded reels.
   - Click **Exchange authorization code for tokens**.
   - Copy the `refresh_token`.

## Worker setup

In `.env.local` (or a separate file you load with `--env-file`):

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # Service role; bypasses RLS
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN=...
# Optional:
YOUTUBE_CHANNEL_ID=UC...
FFMPEG_PATH=ffmpeg
YT_DLP_PATH=yt-dlp
```

Run it once to drain the queue:

```bash
npm run youtube-uploader -- --once
```

Or run it as a long-lived worker (it polls every 30 s when idle):

```bash
npm run youtube-uploader
```

## What the worker does, step by step

For each `queued` row:

1. Set status → `processing`, increment `attempts`.
2. Fetch the reel + its clips.
3. If `combined_video_url` already points at a baked mp4 (e.g. you composed
   a "Highlight Ultra" reel), download that directly.
4. Otherwise:
   - Download every YouTube clip with `yt-dlp` at ≤1080p.
   - For 1 clip → re-encode with libx264 / aac (YouTube-friendly settings).
   - For 2–4 clips → arrange a 2x2 grid using `ffmpeg -filter_complex
     xstack=` and mix audio with `amix=`.
5. Resumable upload to YouTube. Title = reel title (capped at 95 chars),
   description = reel description + an attribution line linking back to the
   original creator's profile and the reel page.
6. Set status → `uploaded`, write the new `youtube_video_id` back.

If anything throws, the row is marked `failed` with the error message.
The unique partial index on `(reel_id) WHERE status IN ('queued','processing')`
prevents two workers from racing on the same reel.

## Cost & rate limits

- YouTube API quota: 10,000 units/day by default. Every video upload costs
  ~1,600 units, so a free-tier project gets ~6 uploads/day. Apply for a
  quota increase once you start running paid tier features.
- yt-dlp + ffmpeg: zero $ — runs on whatever box runs the worker.

## Operating notes

- **Channel ownership**: this uploads to the channel of whichever Google
  account you authorized. Make a dedicated YouTube channel for ReelOne and
  authorize that one.
- **Privacy**: the worker uses `privacyStatus: 'public'`. Switch to
  `unlisted` if you want manual review before videos appear in search.
- **Made for kids**: hardcoded to `false`. If you upload kid-targeted
  content, fix this — YouTube enforces COPPA on the upload side.
- **Premium tier**: when you wire up the second-track unlisted ad-free
  upload promised in the marketing copy, just call `youtubeUpload` twice
  (once with `privacyStatus: 'public'`, once `unlisted`) and store both
  ids on the reel row.
