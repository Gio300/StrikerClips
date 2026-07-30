export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  social_links: Json | null
  power_level?: number
  country?: string | null
  dashboard_override?: Json | null
  auto_merge_opt_out?: boolean
  /**
   * The ARTIFACT TAG the user currently has equipped, if any. This is the
   * bought/earned cosmetic pill shown next to their name everywhere (chat,
   * profile, search, leaderboards) — it takes precedence over the clan tag.
   * Null when nothing is equipped. Populated by `select('*')` on `profiles`.
   */
  equipped_tag_text?: string | null
  equipped_tag_rarity?: ArtifactRarity | null
  equipped_tag_id?: string | null
  created_at: string
  updated_at: string
}

/** Rarity tiers for an artifact tag — drives the pill's look in TagBadge. */
export type ArtifactRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface Clip {
  id: string
  user_id: string
  source_type: 'youtube' | 'upload'
  url_or_path: string
  start_sec: number | null
  end_sec: number | null
  thumbnail: string | null
  title: string | null
  created_at: string
}

export type ReelLayout = 'concat' | 'grid' | 'side-by-side' | 'pip' | 'action' | 'ultra'

export interface Reel {
  id: string
  user_id: string
  title: string
  clip_ids: string[]
  combined_video_url: string | null
  thumbnail: string | null
  // Optional: only present once migration 009 has been applied. Until then,
  // layout is encoded into combined_video_url via `reelone-layout://` (legacy: `clutchlens-layout://`, `shinobi-layout://`).
  // Use `resolveLayout()` from `@/lib/reelLayout` to read this safely.
  layout?: ReelLayout
  created_at: string
}

/**
 * A person who APPEARS in a combined/multi-angle reel — the reel's cast list.
 * `reels.user_id` is only whoever assembled it; this is everyone in the video,
 * which is what powers the "you're in a new clip" notification and makes the
 * reel show up in each participant's own clips list. See lib/reelParticipants.
 */
export interface ReelParticipant {
  id: string
  reel_id: string
  user_id: string
  /** The participant's own clip that fed the combined reel, when known. */
  clip_id: string | null
  created_at: string
}

/**
 * One user blocking another. Directional as data (blocker → blocked) and read
 * ONLY by the blocker — TABLE_POLICY makes `blocks` owner = blocker_id with
 * select 'owner', so nobody can discover who blocked them.
 *
 * `hide_in_shared_lives` is how far the block reaches in live streams:
 *   false → they may still co-appear on a stage, but are never auto-linked;
 *   true  → they may not share a live stage at all.
 * Either way the pair is dropped from each other's multi-angle clips.
 * See src/lib/blocking.ts.
 */
export interface Block {
  id: string
  blocker_id: string
  blocked_id: string
  hide_in_shared_lives: boolean
  created_at: string
}

export interface Match {
  id: string
  name: string
  description: string | null
  reel_ids: string[]
  created_at: string
}

export interface LiveStream {
  id: string
  user_id: string
  youtube_url: string
  title: string | null
  is_live: boolean
  tournament_id?: string | null
  show_bracket?: boolean | null
  created_at: string
}

/**
 * A currently-live session — the unified "who's live right now" record read by
 * the Live surfaces on home + profiles. One row per thing on air (a host going
 * live, a player battle, a solo stream); `status` walks 'live' -> 'ended'. Once
 * ended, a video of it may be posted after via `youtube_id` (the same
 * render-worker path as clip_records / render_jobs). See src/lib/liveSessions.ts.
 * TABLE_POLICY: public read, owner-forced write (host_id is the caller).
 */
export interface LiveSession {
  id: string
  host_id: string
  kind: 'host' | 'battle' | 'stream'
  title: string | null
  status: 'live' | 'ended'
  match_id: string | null
  reel_id: string | null
  battle_id: string | null
  tournament_id: string | null
  /** YouTube live URL or an in-app route (e.g. /live-stage/<id>) to open it. */
  watch_url: string | null
  /** The produced video of the session, posted after it ends. */
  youtube_id: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string | null
}

export interface LiveGroup {
  id: string
  name: string
  creator_id: string | null
  created_at: string
}

export interface LiveGroupMember {
  id: string
  group_id: string
  user_id: string
  stream_id: string | null
  accepted: boolean
}

/**
 * The post-mortem record of a linked multi-angle live session — enough to
 * produce a combined highlight from it later (see src/lib/liveLink.ts
 * `buildSessionRecord`). `stream_ids` / `user_ids` are jsonb string arrays.
 */
export interface LiveGroupSession {
  id: string
  group_id: string
  creator_id: string | null
  stream_ids: Json
  user_ids: Json
  link_reason: string | null
  battle_id: string | null
  tournament_id: string | null
  started_at: string
  ended_at: string
  duration_ms: number
  assembled_reel_id: string | null
  created_at: string
}

export interface UserYoutubeLink {
  id: string
  user_id: string
  url: string
  title: string | null
  created_at: string
}

export interface Server {
  id: string
  name: string
  icon_url: string | null
  created_at: string
  // Clan economy fields (present once db/schema.sql CLANS section is applied;
  // optional so pre-migration reads still type-check). See docs §5.1.
  owner_id?: string | null
  /**
   * The clan's short tag — 2–5 letters/digits, stored UPPERCASE, rendered as
   * `[AI]` next to the clan name. Case-insensitively UNIQUE across the platform
   * (db/schema.sql `servers_clan_tag_lower_uniq`); rules live in
   * src/lib/identity.ts (`validateTag` / `normalizeTag`).
   */
  clan_tag?: string | null
  kind?: string | null
  max_members?: number | null
  is_recruiting?: boolean | null
  join_fee_tokens?: number | null
  dues_tokens?: number | null
  dues_period?: string | null
  rules?: string | null
  treasury_tokens?: number | null
}

/** A clan membership row (db/schema.sql `clan_members`). */
export interface ClanMember {
  id: string
  server_id: string
  user_id: string
  role: 'leader' | 'officer' | 'recruiter' | 'member'
  joined_at: string | null
}

export interface Channel {
  id: string
  server_id: string
  name: string
  type: 'text' | 'clips'
  created_at: string
}

export interface Message {
  id: string
  channel_id: string
  user_id: string
  content: string
  clip_id: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────
//  Chat spaces — Discord-style Space -> Category -> Channel -> Message.
//  (db/schema.sql CHAT SPACES section; docs §4). Parallel to the legacy
//  servers/channels/messages clan board so both coexist.
// ─────────────────────────────────────────────────────────────────────────

export type ChatSpaceKind = 'clan' | 'open' | 'tko'

/** A chat space (Discord "server"): a container of channels. */
export interface ChatSpace {
  id: string
  kind: ChatSpaceKind
  name: string
  /** Creator (open spaces). */
  owner_id: string | null
  /** Bound clan (`servers.id`) for clan spaces; null otherwise. */
  clan_id: string | null
  created_at: string
}

/** A channel inside a space, optionally grouped by a free-text category. */
export interface ChatChannel {
  id: string
  space_id: string
  name: string
  /** Category label; null/empty = ungrouped. */
  category: string | null
  /** Sort order within the space. */
  position: number
  /** Announcement / read-mostly channel (post-restricted). */
  is_announcement: boolean
  created_at: string
}

/** A message posted in a chat channel (body, not `content` — distinct table). */
export interface ChatMessage {
  id: string
  channel_id: string
  user_id: string | null
  body: string
  created_at: string
}

export interface DmConversation {
  id: string
  name: string | null
  pair_key: string | null
  created_at: string
  updated_at: string
}

export interface DmParticipant {
  id: string
  conversation_id: string
  user_id: string
  joined_at: string
}

export interface DmMessage {
  id: string
  conversation_id: string
  user_id: string
  content: string
  created_at: string
}

export interface Poll {
  id: string
  user_id: string
  question: string
  created_at: string
  ends_at: string | null
}

export interface PollOption {
  id: string
  poll_id: string
  text: string
  order: number
}

export interface PollVote {
  id: string
  poll_id: string
  poll_option_id: string
  user_id: string
  created_at: string
}

export interface Activity {
  id: string
  user_id: string
  type: 'reel_created' | 'follow' | 'reel_like' | 'poll_created'
  target_id: string | null
  target_meta: Json
  created_at: string
}

export interface ReelReaction {
  id: string
  reel_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface Follow {
  id: string
  follower_id: string
  following_id: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────
//  Tournaments — admin invites + stat check verification
// ─────────────────────────────────────────────────────────────────────────

export type TournamentStatus = 'draft' | 'open' | 'live' | 'closed'

/** Light tournament shape used wherever we just need name + ownership. */
export interface TournamentLite {
  id: string
  name: string
  created_by: string | null
  created_at: string
}

/** Full tournament row (post migrations 005 / 007 / 011). */
export interface Tournament {
  id: string
  name: string
  description: string | null
  rules: string | null
  /** Optional clan (server) hosting the tournament. */
  server_id: string | null
  /** Tournament start time. */
  start_at: string | null
  /** Tournament end time (null for open-ended / TBD). */
  end_at: string | null
  status: TournamentStatus
  prize_pool: string | null
  created_by: string | null
  created_at: string
  /** Optional jsonb buckets — schema is intentionally flexible. */
  stat_check_times?: Json
  tournament_days_times?: Json
  // ── TKO King format (db/schema.sql — TKO KING section). Optional so pre-
  //    migration reads still type-check. See src/lib/tkoKing.ts. ──
  /** 'standard' (default) | 'king_pit' (the featured TKO King format). */
  format?: string | null
  /** Prime front-page placement flag. */
  is_featured?: boolean | null
  /** SCAFFOLD flag: battles are meant to auto-stream to our YouTube + front page. */
  streams_to_youtube?: boolean | null
  /** Open-enrollment window start (ISO). */
  enroll_opens?: string | null
  /** Open-enrollment window end (ISO); scheduling begins after this. */
  enroll_closes?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
//  TKO King — registrations, 1-on-1 battles, and the Shinobi Trophy Closet
//  (db/schema.sql TKO KING section; logic in src/lib/tkoKing.ts).
// ─────────────────────────────────────────────────────────────────────────

/** A Shinobi who cleared the entry gate and registered for a tournament. */
export interface TournamentRegistration {
  id: string
  tournament_id: string
  user_id: string
  registered_at: string
  /** Agreed to live-stream their battles on TKO. */
  streamed: boolean
  /** Accepted the no-modding attestation. */
  no_mod_ack: boolean
  /** The +30-day ad_free "everyone who competes" grant was applied. */
  membership_granted: boolean
}

export type BattleStatus = 'scheduled' | 'live' | 'complete' | 'forfeit'

/** A 1-on-1 battle (matchup) with a self-scheduled time + status lifecycle. */
export interface TournamentBattle {
  id: string
  tournament_id: string
  player_a: string
  player_b: string | null
  scheduled_at: string | null
  status: BattleStatus
  winner: string | null
  /** Bracket round (1 = first round). Optional — the board derives it when
   *  absent, so pre-migration rows still render. See src/lib/tkoKing.ts. */
  round?: number | null
  /** Stable zero-based position inside the round. */
  bracket_slot?: number | null
  created_at: string
}

/** One fighter's PRIVATE pit meet-up card for a battle: the details their
 *  opponent needs to actually find them in-game. Visible only to the two
 *  fighters in the battle and to hosts (see canSeeMeetup in src/lib/tkoKing.ts). */
export interface BattleMeetup {
  id: string
  battle_id: string
  user_id: string
  /** The name the opponent sees in-game — the whole point of the exchange. */
  in_game_name: string | null
  platform: string | null
  lobby: string | null
  notes: string | null
  updated_at: string | null
  created_at: string
}

/** One defeated-opponent entry in a victor's Shinobi Trophy Closet. */
export interface ShinobiDefeat {
  id: string
  user_id: string
  opponent_id: string
  beat_count: number
  updated_at: string | null
  created_at: string
}

/** A user has been granted "tournament admin" rights on a specific tournament.
 *  Tournament owners (created_by) can add/remove admins, and toggle each
 *  admin's ability to approve stat checks or submit results. */
export interface TournamentAdmin {
  id: string
  tournament_id: string
  user_id: string
  /** When false, this admin sees pending submissions but can't approve/reject. */
  can_approve_stat_check: boolean
  can_submit_results: boolean
  created_at: string
}

export type TournamentEntrantStatus = 'pending' | 'accepted' | 'withdrawn'

/** A player who has entered a tournament (solo or as part of a team).
 *  Created when the user clicks "Enter" on a tournament and accepts the rules.
 *  An entrant may also be invited by a teammate (status='pending' until accepted). */
export interface TournamentEntrant {
  id: string
  tournament_id: string
  user_id: string
  /** Free-text team name. Null for solo. */
  team_name: string | null
  /** Optional reference to a server / clan that the team is registered as. */
  team_server_id: string | null
  status: TournamentEntrantStatus
  /** Set when the user agreed to the tournament rules. */
  agreed_to_rules_at: string | null
  /** Who invited this user (null = self-entered). */
  invited_by: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────
//  Notifications — in-app feed for invites, reviews, decisions, mentions
// ─────────────────────────────────────────────────────────────────────────

export type NotificationKind =
  | 'tournament_admin_invite'
  | 'tournament_team_invite'
  | 'tournament_started'
  | 'stat_check_review_request'
  | 'stat_check_reviewed'
  | 'stat_check_creator_decision'
  | 'live_group_invite'
  /** Streams the live-link engine decided belong together were combined. */
  | 'live_link_created'
  /** "Both fighters are live — watch the battle from both angles." */
  | 'live_battle_both_live'
  /** A link is available but somebody chose "ask me first" (autoLinkMode). */
  | 'live_link_proposed'
  | 'reel_invite'
  /** "A new multi-angle clip of your match is up — you're in it." */
  | 'reel_participant'
  | 'follow'
  | 'mention'
  | 'generic'

export interface Notification {
  id: string
  user_id: string
  kind: NotificationKind | string
  title: string
  body: string | null
  link: string | null
  related_id: string | null
  actor_id: string | null
  read_at: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────
//  Live platform — chat, donations, soundboard, auto-upload, CV labels
// ─────────────────────────────────────────────────────────────────────────

export interface StreamMessage {
  id: string
  stream_id: string
  user_id: string | null
  content: string
  created_at: string
}

export interface CreatorStripeAccount {
  user_id: string
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  transfers_enabled?: boolean
  onboarded_at: string | null
  tax_certified_at?: string | null
  tax_form_type?: 'w9' | 'w8' | null
  electronic_1099_consent_at?: string | null
  tax_consent_version?: string | null
  platform_fee_debit_consent_at?: string | null
  platform_fee_debit_consent_version?: string | null
  updated_at: string
}

export type DonationStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export interface Donation {
  id: string
  donor_id: string | null
  creator_id: string
  amount_cents: number
  currency: string
  message: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  status: DonationStatus
  created_at: string
  paid_at: string | null
}

export type PendingUploadStatus = 'queued' | 'processing' | 'uploaded' | 'failed'

export interface PendingUpload {
  id: string
  reel_id: string
  requested_by: string | null
  status: PendingUploadStatus
  youtube_video_id: string | null
  error: string | null
  attempts: number
  queued_at: string
  uploaded_at: string | null
}

export interface SoundboardPad {
  id: string
  user_id: string
  label: string
  storage_path: string
  hotkey: string | null
  position: number
  created_at: string
}

export type FrameLabelEvent =
  | 'ultimate_used'
  | 'jutsu_impact'
  | 'flag_taken'
  | 'player_killed'
  | 'teabag'
  | 'scroll_grabbed'

export interface FrameLabel {
  id: string
  user_id: string
  source_url: string
  game: string
  event_kind: FrameLabelEvent | string
  t_seconds: number
  notes: string | null
  created_at: string
}

export type StatCheckStatus = 'pending' | 'approved' | 'rejected'
export type StatCheckCreatorDecision = 'allow' | 'disqualify' | 'no_action'

/** A player's submission of their gameplay video for tournament-admin
 *  verification. The player picks a specific admin to invite for review;
 *  on approval, the report surfaces to the tournament creator. */
export interface StatCheckSubmission {
  id: string
  user_id: string
  tournament_id: string | null
  video_url: string
  character_name: string | null
  description: string | null
  status: StatCheckStatus
  /** Specific admin the player asked to review. */
  invited_admin_id: string | null
  /** Whoever actually reviewed (may differ from invited_admin_id). */
  reviewed_by: string | null
  reviewed_at: string | null
  /** The admin's notes attached to the approve/reject. */
  review_notes: string | null
  /** Tournament-creator's follow-up decision once a report lands. */
  creator_decision: StatCheckCreatorDecision | null
  creator_notes: string | null
  creator_decided_at: string | null
  created_at: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// ═════════════════════════════════════════════════════════════════════════
//  Database — generic passed to `SupabaseClient<Database>` in src/lib/supabase.ts
// ─────────────────────────────────────────────────────────────────────────
//  Purpose: give `.from('t').insert(...)/.update(...)/.select()` real payload
//  and row types instead of `never` (what an untyped client infers).
//
//  Each Row reuses the hand-written domain interface above (the app's existing
//  contract, so `.select('*')` results assign straight into the `useState`
//  shapes the pages already use) and is intersected with any extra DB columns
//  that the interface omits but the frontend reads/writes. Tables with no domain
//  interface (users, reactions, power_ratings, …) declare their columns inline
//  from db/schema.sql. Tables that live only in the hosted Supabase project
//  (pending_uploads, reel_comments, stream_messages, tournament_messages,
//  tournament_entrants, creator_stripe_accounts, donations) are inferred from
//  the call sites.
//
//  Insert/Update are `Partial<Row>` + an index signature so existing writes
//  (which omit DB-defaulted columns and occasionally include hosted-only
//  columns) type-check without fighting excess-property checks. This annotates
//  types only; it changes no runtime behavior.
// ═════════════════════════════════════════════════════════════════════════

/**
 * A table definition. `Row` uses the concrete column set (no index signature —
 * PostgREST's select type-transform collapses an index-signatured Row into a
 * useless `{ [x: number]: any }`). Insert/Update stay permissive.
 */
type DbTable<Row extends Record<string, any>> = {
  Row: Row
  Insert: Partial<Row> & { [key: string]: any }
  Update: Partial<Row> & { [key: string]: any }
  Relationships: []
}

/**
 * Flattens an `interface` into an index-compatible object-type literal. Needed
 * because a bare `interface` is NOT assignable to `Record<string, unknown>`
 * (interfaces stay open to declaration merging), which would violate PostgREST's
 * `GenericTable` constraint and silently degrade the whole client back to
 * `never`. A mapped type produces a closed literal that satisfies the
 * constraint.
 */
type Cols<T> = { [K in keyof T]: T[K] }

// Rows backed by a domain interface, extended with extra DB columns where the
// interface omits them.
type ProfilesRow = Cols<
  Profile & {
    game_tag: string | null
    status: string | null
    theme_prefs: Json | null
    text_scale_override: number | null
    /**
     * Live-link consent — 'auto' (default) | 'ask' | 'off'. A settings FIELD on
     * the public identity row rather than a private table, because the engine
     * must read BOTH people's preference before it links them. Owner-writable
     * through the normal profiles policy; not a PRIVILEGE_COL.
     * See src/lib/liveLinkPrefs.ts.
     */
    auto_link_mode: string | null
    auto_merge_opt_out: boolean
  }
>
type ClipsRow = Cols<
  Clip & {
    category: string | null
    subject_profile_id: string | null
    youtube_video_id: string | null
  }
>
type ReelsRow = Cols<Reel>
type MatchesRow = Cols<Match & { scheduled_at: string | null }>
type ServersRow = Cols<
  Server & {
    clan_tag: string | null
    owner_id: string | null
    join_mode: string | null
    total_points: number | null
    updated_at: string | null
    // Clan economy columns (db/schema.sql — CLANS section, docs §5.1).
    kind: string | null
    max_members: number | null
    is_recruiting: boolean | null
    join_fee_tokens: number | null
    dues_tokens: number | null
    dues_period: string | null
    rules: string | null
    treasury_tokens: number | null
  }
>
type ChannelsRow = Cols<Channel>
type MessagesRow = Cols<Message>
type ChatSpacesRow = Cols<ChatSpace>
type ChatChannelsRow = Cols<ChatChannel>
type ChatMessagesRow = Cols<ChatMessage>
type FollowsRow = Cols<Follow>
type BlocksRow = Cols<Block>
type LiveStreamsRow = Cols<LiveStream & { placement: string }>
type LiveGroupsRow = Cols<
  LiveGroup & {
    // Why the engine linked these streams (src/lib/liveLink.ts).
    link_reason: string | null
    battle_id: string | null
    tournament_id: string | null
    clan_id: string | null
    confidence: number | null
    /** dedupe latch — a link notifies exactly once. */
    notified_at: string | null
    started_at: string | null
    ended_at: string | null
  }
>
type LiveSessionsRow = Cols<LiveSession>
type LiveGroupMembersRow = Cols<LiveGroupMember>
type LiveGroupSessionsRow = Cols<LiveGroupSession>
type UserYoutubeLinksRow = Cols<UserYoutubeLink>
type DmConversationsRow = Cols<DmConversation>
type DmParticipantsRow = Cols<DmParticipant>
type DmMessagesRow = Cols<DmMessage>
type PollsRow = Cols<Poll>
type PollOptionsRow = Cols<PollOption>
type PollVotesRow = Cols<PollVote>
type ReelReactionsRow = Cols<ReelReaction>
type ActivitiesRow = Cols<Activity>
type StatCheckSubmissionsRow = Cols<StatCheckSubmission>
type TournamentsRow = Cols<Tournament>
type TournamentAdminsRow = Cols<TournamentAdmin>
type TournamentEntrantsRow = Cols<TournamentEntrant & { invited_admin_id: string | null }>
type TournamentRegistrationsRow = Cols<TournamentRegistration>
type TournamentBattlesRow = Cols<TournamentBattle>
type BattleMeetupsRow = Cols<BattleMeetup>
type ShinobiDefeatsRow = Cols<ShinobiDefeat>
type NotificationsRow = Cols<Notification>
type SoundboardPadsRow = Cols<SoundboardPad>
type FrameLabelsRow = Cols<FrameLabel>
type PendingUploadsRow = Cols<PendingUpload>
type StreamMessagesRow = Cols<StreamMessage>
type CreatorStripeAccountsRow = Cols<CreatorStripeAccount>
type DonationsRow = Cols<Donation>

// Creator/streamer dashboard goals (public-read; written via /api/fn/goal-*).
type CreatorGoalsRow = {
  id: string
  user_id: string
  kind: string
  label: string
  target: number
  active: boolean
  created_at: string | null
}

// Rows without a domain interface — columns from db/schema.sql / call sites.
type UsersRow = {
  id: string
  email: string
  password_hash: string | null
  provider: string | null
  email_verified: boolean | null
  user_metadata: Json | null
  created_at: string | null
  updated_at: string | null
}

type ServerMembersRow = {
  id: string
  server_id: string
  user_id: string
  role: string | null
  created_at: string | null
}

type ReactionsRow = {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

type ClanMembersRow = {
  id: string
  server_id: string
  user_id: string
  role: string
  joined_at: string | null
}

type ClanDuesPaymentsRow = {
  id: string
  server_id: string
  user_id: string
  kind: string
  gross_tokens: number
  clan_tokens: number
  platform_tokens: number
  created_at: string | null
}

type ReelLikesRow = {
  id: string
  reel_id: string
  user_id: string
  created_at: string | null
}

/** The cast of a combined/multi-angle reel — see ReelParticipant above. */
type ReelParticipantsRow = {
  id: string
  reel_id: string
  user_id: string
  clip_id: string | null
  created_at: string | null
}

/**
 * Per-clip auto-analysis (db/schema.sql — MATCH GROUPING). Reachable from the
 * client so a combined reel can work out WHO is in it from the shared clip
 * catalogue rather than from anything the uploader typed.
 */
type ClipRecordsRow = {
  id: string
  clip_id: string | null
  player_id: string | null
  player_handle: string | null
  category: string | null
  outcome: string | null
  kills: number | null
  deaths: number | null
  assists: number | null
  score_line: string | null
  map: string | null
  mode: string | null
  youtube_id: string | null
  composite_youtube_id: string | null
  duration_sec: number | null
  recorded_at: string | null
  ocr_confidence: number | null
  match_id: string | null
  created_at: string | null
}

export type MatchVersionRow = {
  id: string
  match_key: string
  version: number
  youtube_id: string | null
  angle_count: number
  participant_ids: string[]
  clip_ids: string[]
  source_angles?: {
    user_id?: string | null
    handle?: string | null
    channel_id?: string | null
    source_youtube_id?: string | null
    source_start?: number | null
    source_end?: number | null
    timeline_start?: number | null
    timeline_end?: number | null
    coverage_seconds?: number | null
    partial?: boolean
  }[]
  reason: string
  created_at: string | null
}

export type MatchAngleRow = {
  id: string
  match_key: string
  user_id: string
  youtube_video_id: string
  clip_record_id: string | null
  joined_at: string | null
  included_in_version: number | null
  status: 'active' | 'removed'
  removed_at: string | null
  removal_reason: string | null
}

export type MatchGroupRow = {
  id: string
  signature: string
  sig_hash: string
  participants: string[]
  outcome: string | null
  score_line: string | null
  mode: string | null
  map: string | null
  confidence: number | null
  time_window_start: string | null
  time_window_end: string | null
  game: string
  created_at: string | null
}

export type RenderJobRow = {
  id: string
  match_id: string
  match_key: string
  status: 'pending' | 'rendering' | 'uploading' | 'done' | 'failed'
  clip_ids: string[]
  participant_ids: string[]
  youtube_id: string | null
  combined_video_url: string | null
  error: string | null
  attempts: number
  ready_at: string | null
  rerender_requested: boolean
  created_at: string | null
  updated_at: string | null
}

type StreamSlotsRow = {
  id: string
  user_id: string
  title: string | null
  starts_at: string
  ends_at: string
  status: string
  created_at: string | null
}

type PostsRow = {
  id: string
  user_id: string
  body: string
  created_at: string | null
  updated_at: string | null
}

type PostAttachmentsRow = {
  id: string
  post_id: string
  type: string
  url_or_id: string
  sort_order: number | null
  created_at: string | null
}

type PostCommentsRow = {
  id: string
  post_id: string
  user_id: string
  body: string
  created_at: string | null
}

type PostLikesRow = {
  id: string
  post_id: string
  user_id: string
  created_at: string | null
}

type PostPollsRow = {
  id: string
  post_id: string
  question: string
  ends_at: string | null
  created_at: string | null
}

type PostPollOptionsRow = {
  id: string
  poll_id: string
  label: string
  sort_order: number | null
  created_at: string | null
}

type PostPollVotesRow = {
  id: string
  option_id: string
  user_id: string
  created_at: string | null
}

type MatchResultsRow = {
  id: string
  uploader_id: string
  screenshot_url: string | null
  screenshot_hash: string | null
  match_type: string
  status: string
  play_time_sec: number | null
  results_remaining_sec: number | null
  game: string | null
  uploader_in_game_name: string | null
  verified_at: string | null
  verified_by: string | null
  created_at: string | null
  // Inferred from SubmitResult.tsx (columns present in the hosted project).
  outcome: string | null
  kills: number | null
  deaths: number | null
  ocr_confidence: number | null
}

type MatchResultPlayersRow = {
  id: string
  result_id: string
  profile_id: string
  role: string
  score: number | null
  points: number | null
  in_game_name: string | null
  team: string | null
}

type PowerRatingsRow = {
  profile_id: string
  match_type: string
  rating: number
  wins: number
  losses: number
  accumulated_points: number
  updated_at: string | null
}

// created_at/metadata/earned_at match the local `Trophy` type consumers use.
type TrophiesRow = {
  id: string
  profile_id: string
  trophy_type: string
  earned_at: string
  metadata: Record<string, unknown>
}

// created_at matches the local `TournamentResult` type consumers use.
type TournamentResultsRow = {
  id: string
  tournament_id: string
  winner_profile_id: string
  team_name: string | null
  submitted_by: string | null
  created_at: string
}

type RedeemCodesRow = {
  code: string
  tier: string
  months: number
  max_uses: number
  uses: number
  active: boolean
  note: string | null
  expires_at: string | null
  created_at: string | null
}

type CodeRedemptionsRow = {
  id: string
  code: string
  user_id: string
  tier_granted: string
  grant_expires_at: string
  redeemed_at: string | null
}

type FilesRow = {
  id: string
  bucket: string
  path: string
  url: string
  owner_id: string | null
  content_type: string | null
  bytes: number | null
  created_at: string | null
}

type ReelCommentsRow = {
  id: string
  reel_id: string
  user_id: string
  content: string
  created_at: string | null
}

type TournamentMessagesRow = {
  id: string
  tournament_id: string
  user_id: string
  content: string
  created_at: string | null
}

// ---------------------------------------------------------------------------
// THE PRESTIGE ECONOMY (db/schema.sql — "THE PRESTIGE ECONOMY" block).
// Wallets, the shared artifact catalogue + ownership, the ledger and Oracle
// predictions. These replaced the kc_wallet / kc_assets / kc_assets_owned:<id> /
// kc_predictions:<id> / kc_ledger localStorage keys. Writes to every one of them
// are server-only (TABLE_POLICY marks them insert/write 'deny'); the client
// reads its own rows and calls /api/fn/* to change anything.
// ---------------------------------------------------------------------------

/** A cosmetic in the shared catalogue. `id` is TEXT — reward/prize ids are stable. */
type AssetsRow = {
  id: string
  name: string
  team_name: string
  image_url: string
  price_tokens: number
  kind: 'jersey' | 'banner' | 'emote' | 'badge_skin'
  /** null for platform artifacts (seed gear, Oracle rewards, King prizes). */
  created_by: string | null
  origin: 'user' | 'seed' | 'reward' | 'prize'
  seller_type: 'official' | 'creator' | 'clan'
  clan_id: string | null
  created_at: string | null
}

/** Who owns what, and how they got it. Insert is server-only. */
type AssetOwnershipRow = {
  id: string
  user_id: string
  asset_id: string
  source: 'purchase' | 'reward' | 'prize' | 'grant'
  /** battle id for a prize, tournament id for a prediction reward. */
  ref_id: string | null
  acquired_at: string | null
}

/** Per-user balances. Both columns are in PRIVILEGE_COLS — never client-writable. */
type WalletsRow = {
  user_id: string
  tokens: number
  sweeps: number
  updated_at: string | null
  created_at: string | null
}

/** Append-only: every balance movement AND every settled prize / prediction. */
type WalletLedgerRow = {
  id: string
  user_id: string
  kind: 'purchase' | 'grant' | 'spend' | 'prediction' | 'tournament' | 'clan_dues' | 'adjustment'
  tokens_delta: number
  sweeps_delta: number
  event: string | null
  result: 'Win' | 'Loss' | null
  prize: string | null
  status: 'Pending' | 'Paid'
  reason: string | null
  ref_id: string | null
  created_at: string | null
}

/** An Oracle prediction. `status` is graded server-side against tournament_results. */
type PredictionsRow = {
  id: string
  user_id: string
  tournament_id: string
  winner_id: string
  pick_label: string
  status: 'open' | 'correct' | 'wrong'
  reward_asset_id: string | null
  resolved_at: string | null
  created_at: string | null
}

/**
 * A HOST COMMENTARY / "with host" version marker (db/schema.sql — HOSTING LANE).
 * Created only by a host; one per hosted match/reel. The player's version picker
 * reads these to offer with-host vs without-host.
 */
export type HostCommentaryRow = {
  id: string
  host_id: string
  /** What this is the "with host" version OF (past-match commentary). */
  match_id: string | null
  reel_id: string | null
  /** 'live' = hosting a live match now; 'past' = commentary over an existing match. */
  mode: 'live' | 'past'
  /**
   * How the host is captured: OBS restream, phone/browser camera, or mic-only.
   * Named `capture_source` (not `source`) — `source` is a global PRIVILEGE_COL,
   * so a column called `source` is stripped from client writes.
   */
  capture_source: 'obs' | 'camera' | 'mic'
  title: string | null
  /** The produced commentary track / video URL (the "with host" output), when known. */
  commentary_url: string | null
  status: 'draft' | 'live' | 'ready'
  created_at: string | null
  updated_at: string | null
}

export type HostCommentary = HostCommentaryRow

export type Asset = AssetsRow
export type AssetOwnership = AssetOwnershipRow
export type WalletRow = WalletsRow
export type WalletLedgerEntry = WalletLedgerRow
export type PredictionRow = PredictionsRow

export type Database = {
  public: {
    Tables: {
      assets: DbTable<AssetsRow>
      asset_ownership: DbTable<AssetOwnershipRow>
      wallets: DbTable<WalletsRow>
      wallet_ledger: DbTable<WalletLedgerRow>
      predictions: DbTable<PredictionsRow>
      users: DbTable<UsersRow>
      profiles: DbTable<ProfilesRow>
      clips: DbTable<ClipsRow>
      reels: DbTable<ReelsRow>
      matches: DbTable<MatchesRow>
      servers: DbTable<ServersRow>
      server_members: DbTable<ServerMembersRow>
      clan_members: DbTable<ClanMembersRow>
      clan_dues_payments: DbTable<ClanDuesPaymentsRow>
      channels: DbTable<ChannelsRow>
      messages: DbTable<MessagesRow>
      chat_spaces: DbTable<ChatSpacesRow>
      chat_channels: DbTable<ChatChannelsRow>
      chat_messages: DbTable<ChatMessagesRow>
      reactions: DbTable<ReactionsRow>
      follows: DbTable<FollowsRow>
      blocks: DbTable<BlocksRow>
      reel_likes: DbTable<ReelLikesRow>
      reel_participants: DbTable<ReelParticipantsRow>
      clip_records: DbTable<ClipRecordsRow>
      match_groups: DbTable<MatchGroupRow>
      render_jobs: DbTable<RenderJobRow>
      match_versions: DbTable<MatchVersionRow>
      match_angles: DbTable<MatchAngleRow>
      live_streams: DbTable<LiveStreamsRow>
      live_sessions: DbTable<LiveSessionsRow>
      live_groups: DbTable<LiveGroupsRow>
      live_group_members: DbTable<LiveGroupMembersRow>
      live_group_sessions: DbTable<LiveGroupSessionsRow>
      user_youtube_links: DbTable<UserYoutubeLinksRow>
      stream_slots: DbTable<StreamSlotsRow>
      dm_conversations: DbTable<DmConversationsRow>
      dm_participants: DbTable<DmParticipantsRow>
      dm_messages: DbTable<DmMessagesRow>
      polls: DbTable<PollsRow>
      poll_options: DbTable<PollOptionsRow>
      poll_votes: DbTable<PollVotesRow>
      reel_reactions: DbTable<ReelReactionsRow>
      activities: DbTable<ActivitiesRow>
      posts: DbTable<PostsRow>
      post_attachments: DbTable<PostAttachmentsRow>
      post_comments: DbTable<PostCommentsRow>
      post_likes: DbTable<PostLikesRow>
      post_polls: DbTable<PostPollsRow>
      post_poll_options: DbTable<PostPollOptionsRow>
      post_poll_votes: DbTable<PostPollVotesRow>
      match_results: DbTable<MatchResultsRow>
      match_result_players: DbTable<MatchResultPlayersRow>
      power_ratings: DbTable<PowerRatingsRow>
      trophies: DbTable<TrophiesRow>
      stat_check_submissions: DbTable<StatCheckSubmissionsRow>
      tournaments: DbTable<TournamentsRow>
      tournament_admins: DbTable<TournamentAdminsRow>
      tournament_results: DbTable<TournamentResultsRow>
      tournament_entrants: DbTable<TournamentEntrantsRow>
      tournament_registrations: DbTable<TournamentRegistrationsRow>
      tournament_battles: DbTable<TournamentBattlesRow>
      battle_meetups: DbTable<BattleMeetupsRow>
      shinobi_defeats: DbTable<ShinobiDefeatsRow>
      host_commentaries: DbTable<HostCommentaryRow>
      redeem_codes: DbTable<RedeemCodesRow>
      code_redemptions: DbTable<CodeRedemptionsRow>
      notifications: DbTable<NotificationsRow>
      soundboard_pads: DbTable<SoundboardPadsRow>
      frame_labels: DbTable<FrameLabelsRow>
      files: DbTable<FilesRow>
      pending_uploads: DbTable<PendingUploadsRow>
      reel_comments: DbTable<ReelCommentsRow>
      stream_messages: DbTable<StreamMessagesRow>
      tournament_messages: DbTable<TournamentMessagesRow>
      creator_stripe_accounts: DbTable<CreatorStripeAccountsRow>
      donations: DbTable<DonationsRow>
      creator_goals: DbTable<CreatorGoalsRow>
    }
    // NB: these MUST use the `{ [_ in never]: never }` empty-shape, not
    // `Record<string, never>`. PostgREST's `.select('*')` type-transform flags a
    // column as "computed" when its name is a key of `Functions`; `keyof
    // Record<string, never>` is `string`, which would mark every column computed
    // and collapse `select('*')` to `{}`. `keyof { [_ in never]: never }` is
    // `never`, so columns survive.
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
