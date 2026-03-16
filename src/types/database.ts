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

export interface Reel {
  id: string
  user_id: string
  title: string
  clip_ids: string[]
  combined_video_url: string | null
  thumbnail: string | null
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
