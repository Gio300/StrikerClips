-- Add unique constraint for channel names per server (ignore if exists)
do $$ begin
  alter table public.channels add constraint channels_server_name_unique unique (server_id, name);
exception when duplicate_object then null;
end $$;

-- Seed default server
insert into public.servers (id, name) 
values ('00000000-0000-0000-0000-000000000001', 'StrikerClips Community')
on conflict (id) do update set name = excluded.name;

-- Seed default channels
insert into public.channels (server_id, name, type) 
values ('00000000-0000-0000-0000-000000000001', 'general', 'text'),
       ('00000000-0000-0000-0000-000000000001', 'highlights', 'clips'),
       ('00000000-0000-0000-0000-000000000001', 'clips', 'clips')
on conflict (server_id, name) do nothing;
