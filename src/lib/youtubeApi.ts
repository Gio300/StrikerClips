/**
 * YouTube IFrame Player API loader and helpers.
 *
 * The official global script declares `YT.Player` and uses an
 * `onYouTubeIframeAPIReady` callback. We turn that into a Promise so React
 * components can `await` it cleanly.
 */

type YTPlayerEvent = { target: YTPlayer; data?: number }
type YTPlayerVarsBag = {
  start?: number
  end?: number
  autoplay?: 0 | 1
  controls?: 0 | 1
  modestbranding?: 0 | 1
  rel?: 0 | 1
  playsinline?: 0 | 1
  mute?: 0 | 1
  /** Disable keyboard controls on the embed. */
  disablekb?: 0 | 1
  /** 3 = hide video annotations / cards. */
  iv_load_policy?: 1 | 3
  /** 0 = hide the fullscreen button. */
  fs?: 0 | 1
}
export interface YTPlayer {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (sec: number, allowSeekAhead?: boolean) => void
  mute: () => void
  unMute: () => void
  loadVideoById: (opts: { videoId: string; startSeconds?: number; endSeconds?: number }) => void
  cueVideoById: (opts: { videoId: string; startSeconds?: number; endSeconds?: number }) => void
  destroy: () => void
  getPlayerState: () => number
  getCurrentTime: () => number
  getDuration: () => number
  setPlaybackRate?: (rate: number) => void
}
export interface YTPlayerOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: YTPlayerVarsBag
  events?: {
    onReady?: (e: YTPlayerEvent) => void
    onStateChange?: (e: YTPlayerEvent) => void
  }
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number } }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null

export function loadYouTubeApi(): Promise<NonNullable<Window['YT']>> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
    const prevReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (prevReady) {
        try { prevReady() } catch { /* ignore */ }
      }
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YT API loaded but YT.Player missing'))
    }
    if (!existing) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      tag.onerror = () => reject(new Error('Failed to load YouTube IFrame API'))
      document.head.appendChild(tag)
    }
  })

  return apiPromise
}

/**
 * Chrome-minimizing player vars — spread into every embed so the pane reads
 * as a native feed, not a raw YouTube player. Removes the control bar,
 * fullscreen button, keyboard handling, annotations/cards, related videos,
 * and the big YouTube logo (as much as the embed API allows). Combine with
 * <CroppedFrame> to crop out what params can't hide.
 */
export const CLEAN_PLAYER_VARS: YTPlayerVarsBag = {
  controls: 0,
  modestbranding: 1,
  rel: 0,
  playsinline: 1,
  disablekb: 1,
  iv_load_policy: 3,
  fs: 0,
}

/** Same set as query params for raw `<iframe src>` embeds (no IFrame API). */
export const CLEAN_EMBED_PARAMS = 'controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&fs=0'

export function extractYouTubeId(input: string): string | null {
  if (!input) return null
  const s = input.trim()
  // A bare 11-char id.
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  // Path-based forms, incl. the live URL YouTube hands you when you go live
  // (youtube.com/live/ID) plus watch, embed, shorts, v/, and youtu.be. Also
  // tolerates m.youtube.com and any leading params before v=.
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
  if (m) return m[1]
  // Generic ?v= / &v= anywhere as a last resort.
  const v = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  return v ? v[1] : null
}

/** True when the string parses to a usable YouTube video id. */
export function isValidYouTubeUrl(input: string): boolean {
  return extractYouTubeId(input) !== null
}

/**
 * Inline validation for the "paste a YouTube link" box. Returns the error copy
 * to show under the field, or `null` when there's nothing to complain about.
 * An EMPTY box is not an error (the user just hasn't pasted yet) — the caller
 * disables the Add action separately via `isValidYouTubeUrl`.
 */
export function youtubeLinkError(input: string): string | null {
  if (!input || !input.trim()) return null
  return isValidYouTubeUrl(input)
    ? null
    : "That's not a YouTube link — paste a youtube.com or youtu.be URL."
}
