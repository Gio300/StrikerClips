-- 019_partial_angle_sources.sql
-- Preserve every source upload and the exact interval where it contributes to
-- a produced match. Partial recordings remain valid angles.

alter table public.match_versions
  add column if not exists source_angles jsonb not null default '[]'::jsonb;
