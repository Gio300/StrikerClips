-- ============================================================
-- Shinobi Village — pending migrations
--
-- 008 (rename default server) was applied programmatically via PostgREST PATCH
--     using the service-role key. No action needed.
--
-- 009 (reels.layout column) is now OPTIONAL — the frontend encodes layout
--     into combined_video_url via the `shinobi-layout://` scheme so the app
--     works without it. Apply this only when you want to clean up the data
--     model (it's a no-op for existing reels: existing rows default to 'concat'
--     and the resolveLayout() helper still falls back to URL-marker decoding).
--
-- To apply 009:
--   1. Open https://supabase.com/dashboard/project/siwcdegiavwcvgjegiww/sql/new
--   2. Paste the block below, click Run
-- ============================================================

alter table public.reels
  add column if not exists layout text not null default 'concat';

do $$
begin
  alter table public.reels drop constraint if exists reels_layout_check;
  alter table public.reels add constraint reels_layout_check
    check (layout in ('concat', 'grid', 'side-by-side', 'pip'));
exception when others then null;
end $$;

-- Optional: backfill `layout` from existing combined_video_url markers.
update public.reels
set layout = substring(combined_video_url from 'shinobi-layout://(.+)$')
where combined_video_url like 'shinobi-layout://%'
  and layout = 'concat';

-- And clear the marker once layout is canonical:
update public.reels
set combined_video_url = null
where combined_video_url like 'shinobi-layout://%';
