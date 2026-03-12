# StrikerClips

Highlight reel platform: combine 4–8 video clips, share matches, and connect via Discord-style boards.

## Tech Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Supabase (Auth, PostgreSQL, Storage, Realtime)
- **Video:** ffmpeg.wasm (client-side concatenation)
- **Hosting:** GitHub Pages

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL migrations in `supabase/migrations/` via the SQL Editor (in order: 001, 002)
3. Create storage buckets `videos` and `avatars` in Storage (or run the migration which inserts them)
4. Enable Auth providers (Email, Google, GitHub) in Authentication > Providers
5. Add your site URL in Authentication > URL Configuration (e.g. `https://yourusername.github.io/StrikerClips`)

### 2. Environment

Copy `.env.example` to `.env.local` and add your Supabase credentials:

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install and Run

```bash
npm install
npm run dev
```

### 4. GitHub Pages Deploy

1. Push to a GitHub repo
2. In repo Settings > Pages, set Source to "GitHub Actions"
3. Add secrets: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Push to `main` to trigger deploy

## Features

- **Clips:** YouTube URLs (with timestamps) or direct file uploads
- **Reels:** Combine 4–8 uploaded clips into one video (ffmpeg.wasm in browser)
- **Matches:** Collections of clips/reels
- **Boards:** Discord-style servers and channels with realtime messages
- **Profiles:** Username, bio, social links

## GitHub Repo Setup

1. Create a new repository on GitHub (e.g. `StrikerClips`)
2. In your project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/StrikerClips.git
   git push -u origin main
   ```
3. In repo Settings > Pages, set Source to "GitHub Actions"
4. Add secrets: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

## License

MIT
