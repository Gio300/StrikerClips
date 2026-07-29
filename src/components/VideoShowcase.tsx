import { Capacitor } from '@capacitor/core'
import { useRef, useState } from 'react'

/**
 * Marketing video showcase — CATEGORY sections, not a bare grid of players.
 *
 * Founder note that drove this shape: a wall of identical, unlabelled players
 * (some of them dead "coming soon" cards) tells a visitor nothing. So each
 * category now leads with a WRITTEN INTRO — what the reels in it cover and why
 * you'd watch — and the player(s) come after the words.
 *
 * Every entry below is a real, TKO-branded file that exists in public/videos/.
 * There are deliberately NO placeholder slots: a reel either ships or it isn't
 * listed. (The old promo-01…05 "Preview coming soon" cards are gone.)
 *
 * MEDIA: each `slug` maps to public/videos/<slug>.mp4 + <slug>.jpg (poster).
 * Paths are prefixed with Vite's BASE_URL so they resolve on the root-hosted
 * marketing site ('/videos/…') and, if this component is ever rendered from the
 * app build, under the app base ('/app/videos/…').
 *
 * PHONE-FIRST: one column by default, two only from `md` up, and every player
 * stays `preload="none"` with native controls — nothing downloads until a
 * visitor actually taps play. The poster frame carries the branding until then.
 *
 * FAILURE BEHAVIOUR: a card NEVER removes itself. It used to — a failed source
 * set `broken` and returned null, so pressing play on a phone could make the
 * whole card vanish with no message and no way to reach the file. Silently
 * deleting content is the worst possible failure mode: the visitor can't tell
 * a broken video from a video that was never there, and nobody gets a bug
 * report. Now an error keeps the card, says what happened, logs the MediaError
 * code for diagnosis, and always offers a direct link to the file so the
 * visitor can watch it in their native player regardless.
 *
 * BANDWIDTH: each reel ships twice. `<slug>-web.mp4` is a 720p, ~1.5 Mbps
 * mobile-friendly encode listed FIRST, and the full-res 1080p original is
 * listed second as a fallback source. Phones on cell data get the light file;
 * if the web encode is ever missing the browser silently falls through to the
 * original, so the page can't break on a missing derivative.
 */
type Reel = {
  /** File stem: tko-king → /videos/tko-king.mp4 + /videos/tko-king.jpg */
  slug: string
  title: string
  length: string
  /** One-line "what you're about to watch" under the player. */
  caption: string
}

type Category = {
  id: string
  /** Small uppercase eyebrow above the category heading. */
  eyebrow: string
  title: string
  /** 2–3 sentences: what these reels cover and why a visitor should watch. */
  intro: string
  reels: Reel[]
}

const CATEGORIES: Category[] = [
  {
    id: 'start-here',
    eyebrow: 'Start here',
    title: 'What TKO actually is',
    intro:
      'The Complete Tour above is the best place to start. These shorter walkthroughs let you jump back into the live app — the home menu, clans, the Oracle, TKO King, Ask TKO, stat checks, predictions, storefronts, and going live from one console link.',
    reels: [
      {
        slug: 'tko-whats-new',
        title: 'What’s New — the app tour',
        length: '1:22',
        caption: 'One app, every feature — clans, the Oracle, King, and Ask TKO in 80 seconds.',
      },
      {
        slug: 'tko-platform-tour',
        title: 'The full platform tour',
        length: '3:31',
        caption: 'Six chapters: stat checks, clans, predictions, your own storefront, going live, the pot.',
      },
    ],
  },
  {
    id: 'the-tournament',
    eyebrow: 'The tournament',
    title: 'TKO King — the format, the rules, the crown',
    intro:
      'TKO King is the featured ladder, and this reel is the rulebook in motion: 1-on-1, pit-based, played whenever the two of you agree — you set the time, not a bracket admin. It walks the entry gate, the board, and how battles stream to our YouTube and the front page. Watch it before you register so you know exactly what you’re signing up for and what the last Shinobi standing takes home.',
    reels: [
      {
        slug: 'tko-king',
        title: 'TKO King — how the pit works',
        length: '1:25',
        caption: 'Registration, the board, self-scheduled battles, and what winning the crown is worth.',
      },
    ],
  },
  {
    id: 'clans',
    eyebrow: 'Clans & identity',
    title: 'Claim your name before someone else does',
    intro:
      'Clan names on TKO are one-owner and first-come — the tag you claim is yours alone, checked live as you type. This short reel shows the whole claim flow on a phone: pick a name, take a suggested tag, create the clan, and start recruiting. It’s the fastest 40 seconds on this page, and the one with an actual deadline attached to it.',
    reels: [
      {
        slug: 'tko-clan-names',
        title: 'Clan names — claim yours',
        length: '0:39',
        caption: 'One owner, first come, first served — the name and [TAG] claim flow, start to finish.',
      },
    ],
  },
  {
    id: 'in-action',
    eyebrow: 'See it in action',
    title: 'Real matches, cut by the AI director',
    intro:
      'This is the product doing the thing it was built for. Four players recorded the same match separately; TKO read the in-game clock off each upload, lined them to the same instant, and cut one synchronized multi-angle reel — the AI calling the action and finishing on the K.O. replay. No crew, no switcher.',
    reels: [
      {
        slug: 'tko-automatch-demo',
        title: 'Auto-match — four strangers, one fight',
        length: '1:00',
        caption:
          'Four separate uploads of one match, clock-aligned and cut into a single multi-angle reel with the AI on the call.',
      },
    ],
  },
  {
    id: 'ask-tko',
    eyebrow: 'Ask TKO',
    title: 'The assistant that lives inside the app',
    intro:
      'Ask TKO is the in-app AI, and these two reels show both halves of it. The chat system reel covers the tournament side — asking your bracket questions and finding any moment from your matches by describing it. The clip reel shows the payoff: say what you want, and TKO finds the K.O.s, cuts them, scores them, and hands you a finished reel ready to post.',
    reels: [
      {
        slug: 'tko-ask-chat',
        title: 'The TKO chat system',
        length: '2:12',
        caption: 'Your tournament answers its own questions — and finds any moment from your matches.',
      },
      {
        slug: 'tko-ask-clip',
        title: 'Describe it, get the clip',
        length: '0:45',
        caption: 'Say what you want; TKO finds the K.O.s, cuts and scores them, and hands you a finished reel.',
      },
    ],
  },
]

const MAIN_VIDEO = {
  id: '8-OtXqKQ1jg',
  title: 'TKO Complete Tour',
} as const

const BASE = import.meta.env.BASE_URL || '/'
const MEDIA_BASE = Capacitor.isNativePlatform() ? 'https://tko.cam/' : BASE
/** Full-resolution original — the fallback source and the "open directly" target. */
const videoSrc = (slug: string) => `${MEDIA_BASE}videos/${slug}.mp4`
/** 720p mobile encode, tried first so phones don't pull a 30–120 MB file. */
const webVideoSrc = (slug: string) => `${MEDIA_BASE}videos/${slug}-web.mp4`
const posterSrc = (slug: string) => `${MEDIA_BASE}videos/${slug}.jpg`

/** Human-readable cause for each MediaError code, for the inline message. */
function mediaErrorText(err: MediaError | null | undefined): string {
  switch (err?.code) {
    case 1: // MEDIA_ERR_ABORTED
      return 'Playback was cancelled before the video could start.'
    case 2: // MEDIA_ERR_NETWORK
      return 'The connection dropped while the video was loading.'
    case 3: // MEDIA_ERR_DECODE
      return "This device couldn't decode the video."
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "This browser couldn't play any version of this file."
    default:
      return "The video didn't start."
  }
}

export function VideoShowcase() {
  return (
    <section id="showcase" className="border-t border-dark-border">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="text-xs uppercase tracking-wider text-chakra mb-3">Watch it work</div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">See TKO in motion</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Every reel below is shot on the real app. Start at the top for the tour, or jump straight to
            the tournament, the clans, or the AI director doing a live match.
          </p>
        </div>

        <figure className="mb-14 max-w-4xl mx-auto rounded-xl border border-dark-border bg-dark-card overflow-hidden">
          <div className="aspect-video bg-dark">
            <iframe
              className="block w-full h-full"
              src={`https://www.youtube.com/embed/${MAIN_VIDEO.id}?rel=0`}
              title={MAIN_VIDEO.title}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
          <figcaption className="px-4 py-3">
            <span className="font-semibold text-sm text-gray-100">{MAIN_VIDEO.title}</span>
          </figcaption>
        </figure>

        <div className="space-y-14">
          {CATEGORIES.map((c) => (
            <CategorySection key={c.id} category={c} />
          ))}
        </div>
      </div>
    </section>
  )
}

function CategorySection({ category }: { category: Category }) {
  return (
    <section id={`showcase-${category.id}`} className="scroll-mt-20">
      {/* WORDS FIRST — what's in these videos and why to watch. */}
      <div className="max-w-3xl mb-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-kunai mb-2">{category.eyebrow}</div>
        <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">{category.title}</h3>
        <p className="text-gray-400 leading-relaxed">{category.intro}</p>
      </div>

      {/* …THEN the player(s). Single-reel categories go full width. */}
      <div
        className={`grid gap-5 ${
          category.reels.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-3xl'
        }`}
      >
        {category.reels.map((r) => (
          <ReelCard key={r.slug} reel={r} />
        ))}
      </div>
    </section>
  )
}

function ReelCard({ reel }: { reel: Reel }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * IMPORTANT: React surfaces `error` events from the `<source>` children on
   * the parent `<video>`'s onError handler. A `<source>` erroring is NOT a
   * failure — it's the browser walking the candidate list, and the next source
   * may well play. That is exactly why the old handler killed working cards.
   *
   * The media element's own `error` property is only populated once the whole
   * resource-selection algorithm has given up, so that is the only thing we
   * treat as a real failure.
   */
  function handleError() {
    const el = videoRef.current
    const mediaError = el?.error
    if (!mediaError) return // a single source failed; the browser will try the next one
    // Log the real code/message so a failure can actually be diagnosed.
    console.error(
      `[VideoShowcase] "${reel.slug}" failed — MediaError code ${mediaError.code}` +
        `${mediaError.message ? `: ${mediaError.message}` : ''}`,
      { slug: reel.slug, src: el?.currentSrc || videoSrc(reel.slug), code: mediaError.code },
    )
    setFailure(mediaErrorText(mediaError))
  }

  /** A source recovered (or a retry worked) — clear the message. */
  function handleRecovered() {
    if (failure) setFailure(null)
  }

  function retry() {
    setFailure(null)
    const el = videoRef.current
    if (!el) return
    try {
      el.load()
      void el.play()?.catch(() => { /* user can press play themselves */ })
    } catch { /* the direct link is still there */ }
  }

  return (
    <figure className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="relative aspect-video bg-dark">
        <video
          ref={videoRef}
          className="block w-full h-full object-cover bg-dark"
          controls
          preload="none"
          playsInline
          poster={posterSrc(reel.slug)}
          onError={handleError}
          onLoadedData={handleRecovered}
          onPlaying={handleRecovered}
        >
          {/* Light 720p encode first; full-res original as the fallback. */}
          <source src={webVideoSrc(reel.slug)} type="video/mp4" />
          <source src={videoSrc(reel.slug)} type="video/mp4" />
        </video>

        {/* The card STAYS. On failure we cover the player with an explanation
            and, most importantly, a direct link so the visitor can always get
            to the video in their own player. */}
        {failure && (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-5 text-center bg-dark/95"
          >
            <p className="text-sm font-semibold text-gray-100">{failure}</p>
            <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
              The file is still there — open it directly and it should play in your device's own player.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a
                href={videoSrc(reel.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded bg-accent text-dark text-xs font-semibold"
              >
                Open the video directly ↗
              </a>
              <button
                type="button"
                onClick={retry}
                className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-xs hover:border-accent/50 hover:text-accent"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
      <figcaption className="px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-sm text-gray-100">{reel.title}</span>
          <span className="shrink-0 text-[11px] font-mono text-gray-500 tabular-nums">{reel.length}</span>
        </div>
        <p className="mt-1 text-xs text-gray-400 leading-relaxed">{reel.caption}</p>
      </figcaption>
    </figure>
  )
}
