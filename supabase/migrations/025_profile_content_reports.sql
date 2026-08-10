-- Allow a signed-in player to report another player's profile directly.
-- The trusted API still verifies that the profile exists and derives the
-- target owner; clients cannot supply either identity.
alter table public.content_reports
  drop constraint if exists content_reports_target_type_check;

alter table public.content_reports
  add constraint content_reports_target_type_check check (target_type in (
    'profile','post','post_comment','reel','reel_comment','chat_message',
    'dm_message','stream_message','tournament_message','board_message'
  ));
