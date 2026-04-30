-- Add layout column to reels so we can render multi-angle YouTube reels
-- without needing to download/transcode the videos. Existing reels default to 'concat'.

alter table public.reels
  add column if not exists layout text not null default 'concat';

-- Constrain to known layouts. Drop first in case we re-run the migration.
do $$
begin
  alter table public.reels drop constraint if exists reels_layout_check;
  alter table public.reels add constraint reels_layout_check
    check (layout in ('concat', 'grid', 'side-by-side', 'pip'));
exception when others then null;
end $$;
