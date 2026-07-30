-- TKO marketplace storefront ownership.
--
-- User listings are either personal creator inventory or inventory sold for a
-- clan. The API validates clan leadership and computes the 80/20 Token split;
-- these columns only describe where a verified listing belongs.

alter table public.assets
  add column if not exists seller_type text not null default 'creator';

alter table public.assets
  add column if not exists clan_id uuid references public.servers(id) on delete set null;

update public.assets
set seller_type = case
  when origin in ('seed','reward','prize') or created_by is null then 'official'
  else coalesce(nullif(seller_type,''), 'creator')
end;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assets_seller_type_check'
  ) then
    alter table public.assets
      add constraint assets_seller_type_check
      check (seller_type in ('official','creator','clan'));
  end if;
end $$;

create index if not exists idx_assets_seller
  on public.assets(seller_type, clan_id, created_at desc);

create table if not exists public.post_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists idx_post_comments_post
  on public.post_comments(post_id, created_at);

create table if not exists public.post_likes (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(post_id, user_id)
);
create index if not exists idx_post_likes_post
  on public.post_likes(post_id);
