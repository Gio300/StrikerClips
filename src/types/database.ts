export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  social_links: Json | null
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

export interface Reaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}
