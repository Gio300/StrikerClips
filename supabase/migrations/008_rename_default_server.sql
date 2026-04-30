-- Rename the seeded default server from "StrikerClips Community" to "Shinobi Village".
-- Idempotent: safe to re-run.

update public.servers
set name = 'Shinobi Village'
where id = '00000000-0000-0000-0000-000000000001';
