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
  created_at: string
  updated_at: string
}

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
  created_at: string
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

export interface DmConversation {
  id: string
  name: string | null
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
  | 'reel_invite'
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
  onboarded_at: string | null
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
