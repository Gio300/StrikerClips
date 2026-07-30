import { useMemo, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'

export type ExternalVideoPlatform = 'YouTube' | 'Facebook' | 'Instagram' | 'TikTok'

export type ExternalVideoLink = {
  platform: ExternalVideoPlatform
  originalUrl: string
  embedUrl: string | null
  portrait: boolean
}

const WEB_PROTOCOLS = new Set(['http:', 'https:'])
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const TIKTOK_ID = /^\d{8,24}$/
const SAFE_PATH_TOKEN = /^[A-Za-z0-9._-]{2,160}$/

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function stripTrailingPunctuation(value: string): string {
  let clean = value.replace(/[.,!?;:'"]+$/g, '')
  const pairs: readonly [string, string][] = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ]

  for (const [open, close] of pairs) {
    while (clean.endsWith(close)) {
      const opens = clean.split(open).length - 1
      const closes = clean.split(close).length - 1
      if (closes <= opens) break
      clean = clean.slice(0, -1)
    }
  }
  return clean
}

function safeUrl(value: string): URL | null {
  try {
    const parsed = new URL(stripTrailingPunctuation(value))
    return WEB_PROTOCOLS.has(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function youtubeVideoId(url: URL): string | null {
  const host = normalizedHostname(url)
  let id: string | null = null

  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (
    host === 'youtube.com'
    || host === 'm.youtube.com'
    || host === 'music.youtube.com'
    || host === 'youtube-nocookie.com'
  ) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = url.searchParams.get('v')
    else if (['embed', 'live', 'shorts', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null
  }

  return id && YOUTUBE_ID.test(id) ? id : null
}

function facebookVideoUrl(url: URL): ExternalVideoLink | null {
  const host = normalizedHostname(url)
  const facebookHost = host === 'facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com'
  const fbWatchHost = host === 'fb.watch'
  if (!facebookHost && !fbWatchHost) return null

  const parts = url.pathname.split('/').filter(Boolean)
  const looksLikeVideo = fbWatchHost || parts.includes('videos') || parts[0] === 'watch'
    || parts[0] === 'reel' || (parts[0] === 'share' && parts[1] === 'v')
  if (!looksLikeVideo) return null

  const canonical = url.toString()
  const params = new URLSearchParams({
    href: canonical,
    show_text: 'false',
    width: '720',
  })
  return {
    platform: 'Facebook',
    originalUrl: canonical,
    embedUrl: `https://www.facebook.com/plugins/video.php?${params.toString()}`,
    portrait: true,
  }
}

function instagramVideoUrl(url: URL): ExternalVideoLink | null {
  const host = normalizedHostname(url)
  if (host !== 'instagram.com' && host !== 'm.instagram.com') return null

  const [kind, token] = url.pathname.split('/').filter(Boolean)
  if (!['p', 'reel', 'tv'].includes(kind ?? '') || !token || !SAFE_PATH_TOKEN.test(token)) return null

  return {
    platform: 'Instagram',
    originalUrl: url.toString(),
    embedUrl: `https://www.instagram.com/${kind}/${encodeURIComponent(token)}/embed/`,
    portrait: true,
  }
}

function tiktokVideoUrl(url: URL): ExternalVideoLink | null {
  const host = normalizedHostname(url)
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    return {
      platform: 'TikTok',
      originalUrl: url.toString(),
      embedUrl: null,
      portrait: true,
    }
  }
  if (host !== 'tiktok.com' && host !== 'm.tiktok.com') return null

  const parts = url.pathname.split('/').filter(Boolean)
  const videoIndex = parts.indexOf('video')
  const id = videoIndex >= 0 ? parts[videoIndex + 1] : null
  if (!id || !TIKTOK_ID.test(id)) return null

  const params = new URLSearchParams({
    controls: '1',
    progress_bar: '1',
    play_button: '1',
    volume_control: '1',
    fullscreen_button: '1',
  })
  return {
    platform: 'TikTok',
    originalUrl: url.toString(),
    embedUrl: `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?${params.toString()}`,
    portrait: true,
  }
}

export function parseExternalVideoUrl(value: string): ExternalVideoLink | null {
  const url = safeUrl(value)
  if (!url) return null

  const youtubeId = youtubeVideoId(url)
  if (youtubeId) {
    return {
      platform: 'YouTube',
      originalUrl: url.toString(),
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?rel=0&modestbranding=1&playsinline=1`,
      portrait: url.pathname.includes('/shorts/'),
    }
  }

  return facebookVideoUrl(url) ?? instagramVideoUrl(url) ?? tiktokVideoUrl(url)
}

export function externalVideoLinksIn(text: string): ExternalVideoLink[] {
  const candidates = text.match(/https?:\/\/[^\s<>"']+/giu) ?? []
  const seen = new Set<string>()
  const links: ExternalVideoLink[] = []

  for (const candidate of candidates) {
    const parsed = parseExternalVideoUrl(candidate)
    if (!parsed || seen.has(parsed.originalUrl)) continue
    seen.add(parsed.originalUrl)
    links.push(parsed)
  }
  return links
}

export function ExternalVideoPreview({ text }: { text: string }) {
  const links = useMemo(() => externalVideoLinksIn(text), [text])
  const video = links.find((item) => item.embedUrl) ?? links[0]
  const [embedFailed, setEmbedFailed] = useState(false)

  if (!video) return null

  const canEmbed = Boolean(video.embedUrl) && !embedFailed
  const viewportClass = video.portrait
    ? 'mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-sm'
    : 'aspect-video w-full'

  return (
    <section className="mx-4 mb-4 overflow-hidden rounded-lg border border-dark-border bg-black">
      <header className="flex min-h-11 items-center gap-3 border-b border-dark-border bg-dark px-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kunai/40 bg-kunai/10 text-kunai">
          <Play className="h-4 w-4 fill-current" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-white">
            TKO<span className="text-kunai">.cam</span>
          </p>
          <p className="text-[10px] font-semibold uppercase text-gray-500">
            Watching {video.platform} on TKO
          </p>
        </div>
      </header>

      {canEmbed ? (
        <div className={viewportClass}>
          <iframe
            src={video.embedUrl ?? undefined}
            title={`${video.platform} video shared on TKO`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
            onError={() => setEmbedFailed(true)}
            className="h-full w-full border-0"
          />
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center p-4">
          <a
            href={video.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dark-border px-4 text-sm font-semibold text-white hover:border-accent hover:text-accent"
          >
            Open on {video.platform}
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      )}
    </section>
  )
}
