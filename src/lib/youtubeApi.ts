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

export function extractYouTubeId(input: string): string | null {
  if (!input) return null
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input
  const m = input.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}
