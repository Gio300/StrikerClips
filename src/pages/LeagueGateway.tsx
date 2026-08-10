import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Clapperboard,
  Crown,
  Gauge,
  ListOrdered,
  MessageCircle,
  Radio,
  Rocket,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trophy,
  Upload,
  Users,
} from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalLinks } from '@/components/LegalFooter'
import { PhoneFrame, PhonePreview, usePreviewVertical } from '@/components/PhonePreview'
import { SUPPORT } from '@/lib/brand'
import { PREVIEW_VERTICALS } from '@/lib/leaguePreviewFixture'
import {
  hexToChannels,
  shadeHex,
  TKO_NEUTRAL,
  TKO_NEUTRAL_BOARD_VARS,
} from '@/lib/leagueTheme'
import {
  listLeagues,
  loadLeagueDraft,
  setActiveLeagueSlug,
  subscribeLeagueDraft,
  type LeagueConfig,
} from '@/lib/leagueConfig'

/**
 * LeagueGateway — what an anonymous visitor sees at `/` (full-bleed, no app
 * chrome). Two faces of one page:
 *
 *   • `browse` (/leagues): THE FRONT DOOR of tko.cam. A signed-out visitor on
 *     tko.cam lands here (see signedOutLandingPath in src/lib/leagueDomain.ts),
 *     so this page has one job — sell the platform in scannable beats (hook +
 *     live phone → who it's for → how it works → what you get → proof → price
 *     → CTA) and then show the leagues already on TKO.
 *   • `pricing` (/make-a-league): the marketing + pricing view (design image 1
 *     — blueprint-grid board, big hero lockup, card band) that funnels a league
 *     owner into the League Studio. Owner tiers split on VIDEO OWNERSHIP:
 *     Starter (TKO's YouTube, TKO owns the videos) · Pro League (their own
 *     YouTube, they own the videos) · Enterprise (COMING SOON — gated to a
 *     "talk to us" capture, no checkout).
 *
 * SELLING BEYOND ONE GAME (operator 2026-08-04): "I need to advertise
 * something other than 1 video game with people I know." So the hero carries a
 * LIVE phone running the real app plus a row of vertical chips — esports,
 * shooter, soccer, racing, fighting, hoops — that repopulate the sample league
 * on the spot. A Rocket League owner sees a Rocket League league inside a
 * second, without a word of copy promising it.
 *
 * The pull-out PhonePreview also rides on both views (it carries its own
 * "Build yours free" CTA), showing the live Studio draft.
 */

/**
 * Blueprint grid texture — the board's drafting grid. Palette v3: the board is
 * LIGHT, so the rules are a faint tint of the INK slot (a white grid is
 * invisible on paper) and the top glow is a soft wash of the surface's own
 * card white. Both ride CSS variables, so the texture inverts with the skin.
 */
const BLUEPRINT_GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(rgb(var(--league-ink) / 0.055) 1px, transparent 1px), ' +
    'linear-gradient(90deg, rgb(var(--league-ink) / 0.055) 1px, transparent 1px), ' +
    'radial-gradient(60% 50% at 50% -10%, rgb(var(--league-dark-card) / 0.85) 0%, transparent 65%)',
  backgroundSize: '28px 28px, 28px 28px, 100% 100%',
}

/**
 * Headline gradient — ink into the board's link tone into its highlight tone.
 * Was white→ice→mint, which vanished the moment the field went light; reading
 * the slots keeps one definition legible on either family.
 */
const BOARD_GRADIENT: CSSProperties = {
  background:
    'linear-gradient(110deg, rgb(var(--league-ink)) 0%, rgb(var(--league-accent)) 58%, rgb(var(--league-chakra)) 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
}

/**
 * The "Make a league" page skin — brand board 03. PALETTE V3 (operator
 * 2026-08-03) turned every TKO surface LIGHT, so this board is no longer the
 * deep-royal field: it is the same paper family as browse, tinted a cool
 * blue-gray (TKO_NEUTRAL.paper) and inked in royal, so the pricing funnel
 * still reads as its own room without leaving the light system. Derived
 * entirely from the TKO_NEUTRAL token table (no new color constants) and
 * scoped to the pricing view's subtree only.
 *
 * CONTRAST AUDIT (recomputed for palette v3; the test suite asserts these):
 *   • field is the tinted paper #e4eaf6: ink 13.59:1, muted ink 5.34:1.
 *   • panels are white — ink 16.40:1, muted ink 6.45:1.
 *   • CTA plate keeps the sapphire: white label 4.95:1; royal is the
 *     pressed/hover step and kunai-2 rides sky for the gradient tiles.
 *   • royal links: 6.92:1 on the paper field, 8.35:1 on the cards.
 *   • forest highlights: 5.85:1 on the white cards.
 *   • ".cam" wordmark rides --brand-cam = royal (6.92:1) instead of the
 *     kunai slot (a plate tone, not an ink).
 */
export const MAKE_A_LEAGUE_BOARD_VARS: Record<string, string> = {
  '--league-dark': hexToChannels(TKO_NEUTRAL.paper),
  '--league-dark-card': hexToChannels(TKO_NEUTRAL.surface),
  '--league-dark-elevated': hexToChannels(shadeHex(TKO_NEUTRAL.paper, 0.45)),
  '--league-dark-border': hexToChannels(shadeHex(TKO_NEUTRAL.paper, -0.13)),
  '--league-kunai': hexToChannels(TKO_NEUTRAL.blue),
  '--league-kunai-dark': hexToChannels(TKO_NEUTRAL.royal),
  '--league-kunai-2': hexToChannels(shadeHex(TKO_NEUTRAL.sky, 0.35)),
  '--league-accent': hexToChannels(TKO_NEUTRAL.royal),
  '--league-accent-muted': hexToChannels(shadeHex(TKO_NEUTRAL.royal, -0.2)),
  '--league-chakra': hexToChannels(TKO_NEUTRAL.forest),
  '--league-chakra-dark': hexToChannels(shadeHex(TKO_NEUTRAL.forest, -0.3)),
  '--league-ink': hexToChannels(TKO_NEUTRAL.ink),
  '--league-ink-muted': hexToChannels(TKO_NEUTRAL.inkMuted),
  '--league-on-primary': hexToChannels('#ffffff'),
  '--brand-cam': hexToChannels(TKO_NEUTRAL.royal),
}

export function LeagueGateway({ view = 'browse' }: { view?: 'browse' | 'pricing' }) {
  return (
    // The board vars re-skin ONLY this subtree; in-app chrome is untouched.
    // browse → the main marketing board (TKO_NEUTRAL_BOARD_VARS);
    // pricing (/make-a-league) → brand board 03, the royal/sky/deep-navy
    // family (MAKE_A_LEAGUE_BOARD_VARS above).
    <div
      className="board-skin min-h-screen bg-dark text-ink"
      style={{
        ...BLUEPRINT_GRID,
        ...(view === 'pricing' ? MAKE_A_LEAGUE_BOARD_VARS : TKO_NEUTRAL_BOARD_VARS),
      } as CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-dark-border bg-dark/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/leagues" className="flex items-center gap-2.5">
            {/* `tko`: this is TKO's own pitch surface — always the TKO lockup,
                even when a member/domain league skin is active. text-xl keeps
                the ".cam" suffix in WCAG large-type territory (≥14pt bold) for
                its 3.9:1 board ink. */}
            <BrandLogo as="span" variant="horizontal" className="text-xl" tko />
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/leagues"
              className={`hidden px-3 py-1.5 font-medium sm:block ${view === 'browse' ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              Browse leagues
            </Link>
            <Link
              to="/make-a-league"
              className={`hidden px-3 py-1.5 font-medium sm:block ${view === 'pricing' ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              Pricing
            </Link>
            <Link to="/login" className="px-3 py-1.5 font-medium text-ink-muted hover:text-ink">
              Log in
            </Link>
            <Link to="/studio" className="btn-primary">
              <Sparkles size={16} /> Start free
            </Link>
          </nav>
        </div>
      </header>

      {view === 'browse' ? <BrowseLeagues /> : <MakeALeague />}

      <footer className="border-t border-dark-border py-8 text-center text-xs text-ink-muted">
        <p>
          Powered by <span className="font-brand font-bold text-ink">TKO.cam</span> — every
          angle. one cam.
        </p>
        <p className="mt-1">
          League #1, live demo:{' '}
          <a
            href="https://shinobistrikerleague.com"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline hover:text-ink"
          >
            shinobistrikerleague.com
          </a>
        </p>
        {/* THE compliance row. This footer is what a signed-out visitor to
            https://tko.cam/ actually sees — `/` sends them here via
            signedOutLandingPath (src/lib/leagueDomain.ts) — so the privacy and
            terms links have to be ON it. See src/components/LegalFooter.tsx. */}
        <LegalLinks className="mt-4" />
      </footer>

      {/* The hero already stacks a full phone on small screens, so the floating
          tab only earns its keep from sm: up. */}
      <PhonePreview hideTabOnMobile />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Shared marketing furniture
// ───────────────────────────────────────────────────────────────────────────

/** The live phone in a hero, wired to the Studio draft + the chosen vertical. */
function HeroPhone() {
  const [draft, setDraft] = useState<LeagueConfig>(() => loadLeagueDraft())
  const [vertical] = usePreviewVertical()
  useEffect(() => subscribeLeagueDraft(() => setDraft(loadLeagueDraft())), [])
  return <PhoneFrame cfg={draft} vertical={vertical} />
}

/**
 * The game-agnostic proof, as a control instead of a claim: tapping a chip
 * repopulates the sample league in every mounted preview.
 */
function VerticalChips({ className = '' }: { className?: string }) {
  const [vertical, setVertical] = usePreviewVertical()
  const active = PREVIEW_VERTICALS.find((v) => v.id === vertical)
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
        Built for any competition
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PREVIEW_VERTICALS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVertical(v.id)}
            aria-pressed={v.id === vertical}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              v.id === vertical
                ? 'border-kunai bg-kunai text-on-primary'
                : 'border-dark-border bg-dark-card text-ink-muted hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {active?.hint} — tap one and watch the phone repopulate. Same app either way.
      </p>
    </div>
  )
}

/** The three-step "how it works" band, shared by both views. */
function HowItWorks() {
  return (
    <section className="rounded-2xl border border-dark-border bg-dark-card/60 p-6 md:p-8">
      <h3 className="section-heading mb-5 text-center">How it works</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Upload,
            title: 'Players upload clips',
            detail:
              'Phones, consoles, capture cards — every angle of the same match lands in one place.',
          },
          {
            icon: Clapperboard,
            title: 'AI cuts the shorts',
            detail:
              'Multi-angle vertical highlights with commentary, your colors, your logo, your anthem.',
          },
          {
            icon: Share2,
            title: 'Auto-posts everywhere',
            detail:
              'Fresh highlights hit your feed and your channels on a schedule. No editor required.',
          },
        ].map(({ icon: Icon, title, detail }, i) => (
          <div key={title} className="card flex flex-col gap-2 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink/15 text-ink">
              <Icon size={20} />
            </span>
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
              Step {i + 1}
            </p>
            <h4 className="font-bold text-ink">{title}</h4>
            <p className="text-sm text-ink-muted">{detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** What lands on day one — the screens the phone preview just showed. */
const INCLUDED: { icon: typeof Smartphone; title: string; detail: string }[] = [
  {
    icon: Smartphone,
    title: 'Your app, your domain',
    detail: 'A full mobile app in your colors and logo, at your own address.',
  },
  {
    icon: Clapperboard,
    title: 'Auto-cut highlights',
    detail: 'Multi-angle vertical shorts, branded and posted for you.',
  },
  {
    icon: Radio,
    title: 'Live, from every angle',
    detail: 'Multiple players stream one match; viewers pick the camera.',
  },
  {
    icon: Trophy,
    title: 'Brackets & tournaments',
    detail: 'Seed it, run it, and let the app track every result.',
  },
  {
    icon: ListOrdered,
    title: 'Standings & rankings',
    detail: 'Tables, streaks and movement your members actually check.',
  },
  {
    icon: Users,
    title: 'Members, clans & chat',
    detail: 'Profiles, teams and a feed — the social layer keeps them coming back.',
  },
]

function WhatYouGet() {
  return (
    <section className="pt-14">
      <h3 className="section-heading mb-1 text-center">Everything in that phone ships on day one</h3>
      <p className="mb-6 text-center text-sm text-ink-muted">
        Not a mockup of a roadmap — the preview is the deployed product with sample data.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INCLUDED.map(({ icon: Icon, title, detail }) => (
          <div key={title} className="card flex flex-col gap-2 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon size={19} />
            </span>
            <h4 className="font-bold text-ink">{title}</h4>
            <p className="text-sm text-ink-muted">{detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The two doors into the Studio — the operator's "fast lane / pro lane". */
function TwoPaths() {
  return (
    <section className="pt-14">
      <h3 className="section-heading mb-1 text-center">Two ways to launch</h3>
      <p className="mb-6 text-center text-sm text-ink-muted">
        Same app, same price. Pick the one that matches how much you want to fiddle.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card flex flex-col p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-kunai text-on-primary">
            <Gauge size={22} />
          </span>
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            Fast lane · about 2 minutes
          </p>
          <h4 className="mt-1 text-xl font-bold text-ink">Drop branding and go</h4>
          <ul className="mt-3 flex-1 space-y-2 text-sm text-ink-muted">
            {['Name it', 'Drop your logo', 'Tap a palette', 'Launch'].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" /> {f}
              </li>
            ))}
          </ul>
          <Link to="/studio?lane=fast" className="btn-primary mt-5 w-full">
            Start the fast lane <ArrowRight size={15} />
          </Link>
        </div>
        <div className="card flex flex-col p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-dark-elevated text-accent">
            <SlidersHorizontal size={22} />
          </span>
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            Pro lane · as long as you like
          </p>
          <h4 className="mt-1 text-xl font-bold text-ink">Upgrade with details</h4>
          <ul className="mt-3 flex-1 space-y-2 text-sm text-ink-muted">
            {[
              'Every color slot, tagline and anthem',
              'AI chat — point at any part and ask',
              'Custom domain and video ownership',
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" /> {f}
              </li>
            ))}
          </ul>
          <Link to="/studio?lane=pro" className="btn-ghost mt-5 w-full">
            Open the pro lane <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/** The closing band — the last CTA before the footer. */
function FinalCta({ heading, sub }: { heading: string; sub: string }) {
  return (
    <section className="mt-14 rounded-2xl border border-dark-border bg-dark-card/60 p-8 text-center">
      <h3 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{heading}</h3>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">{sub}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/studio" className="btn-primary px-7 py-3 text-base">
          <Sparkles size={18} /> Start your league free
        </Link>
        <Link to="/make-a-league" className="btn-ghost px-7 py-3 text-base">
          See pricing
        </Link>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Build and preview for free — you only pick a plan when you launch.
      </p>
    </section>
  )
}

/** A hero shell: copy on the left, the live phone on the right. */
function Hero({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string
  title: ReactNode
  sub: string
  children: ReactNode
}) {
  return (
    <section className="grid items-center gap-10 py-12 md:py-16 lg:grid-cols-[1fr_auto]">
      <div className="text-center lg:text-left">
        {/* Hidden on phones: the sticky header already carries the lockup, and
            on a 390px screen this block alone pushed the live app below the
            fold — the one thing a first-time visitor has to see. */}
        <div className="mb-5 hidden justify-center sm:flex lg:justify-start">
          <BrandLogo as="h1" variant="mark" className="text-4xl md:text-5xl" tko />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">{eyebrow}</p>
        <h2 className="mt-2 text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl">
          {title}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-ink lg:mx-0">{sub}</p>
        {children}
      </div>

      {/* The hook: a real, running app you can tap, not a screenshot. */}
      <div className="flex flex-col items-center gap-3">
        <HeroPhone />
        <p className="max-w-[290px] text-center text-xs text-ink-muted">
          A real league app running on sample data. Tap the nav — it works.
        </p>
      </div>
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Browse view — the tko.cam front door
// ───────────────────────────────────────────────────────────────────────────

function BrowseLeagues() {
  const [leagues, setLeagues] = useState<LeagueConfig[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    listLeagues().then((rows) => {
      if (!alive) return
      setLeagues(rows)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  function enterLeague(league: LeagueConfig) {
    // Remember which league the visitor stepped into — the league theme
    // provider keys the app's skin off this slug (wire-in plan Step 2).
    setActiveLeagueSlug(league.slug)
    navigate('/reels')
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <Hero
        eyebrow="The league platform"
        title={
          <>
            Run your league
            <br />
            <span style={BOARD_GRADIENT}>like a real one.</span>
          </>
        }
        sub="Your own app, on your own domain, in your colors — with auto-cut highlights, live multi-angle matches, brackets and standings. Bring the players; TKO brings the production."
      >
        <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
          <Link to="/studio" className="btn-primary px-7 py-3 text-base">
            <Sparkles size={18} /> Start your league free
          </Link>
          <Link to="/make-a-league" className="btn-ghost px-7 py-3 text-base">
            See pricing
          </Link>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          No card to build it. Pick a plan when you launch.
        </p>
        <VerticalChips className="mt-7" />
      </Hero>

      <HowItWorks />

      <WhatYouGet />

      <TwoPaths />

      {/* PROOF — a league already running the whole thing in public. */}
      <section className="pt-14">
        <h3 className="section-heading mb-1 text-center">Already running in public</h3>
        <p className="mb-6 text-center text-sm text-ink-muted">
          Not a concept. Step into a league and use it.
        </p>
        <div className="card mb-6 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-chakra/10 text-chakra">
            <Crown size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-ink">League #1 is live today</h4>
            <p className="text-sm text-ink-muted">
              <a
                href="https://shinobistrikerleague.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent underline hover:text-ink"
              >
                shinobistrikerleague.com
              </a>{' '}
              is this exact app wearing one league&apos;s brand — its own domain, its own colors,
              its own members. Yours works the same way.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? [0, 1, 2].map((i) => <LeagueCardSkeleton key={i} />)
            : leagues.map((league) => (
                <LeagueCard key={league.slug} league={league} onEnter={() => enterLeague(league)} />
              ))}
          {/* The "yours here" card keeps the make-a-league door in the grid. */}
          <Link
            to="/studio"
            className="card card-hover flex min-h-44 flex-col items-center justify-center gap-2 border-dashed text-ink-muted hover:text-ink"
          >
            <Crown size={26} />
            <span className="font-semibold">Your league here</span>
            <span className="text-xs">Style it → launch → invite your players</span>
          </Link>
        </div>
      </section>

      {/* PRICE — honest, up front, one click from the detail. */}
      <section className="pt-14">
        <h3 className="section-heading mb-1 text-center">Simple pricing</h3>
        <p className="mb-6 text-center text-sm text-ink-muted">
          Every plan runs the full app. The difference is whose channel the videos live on — and
          who owns them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              name: 'Starter',
              price: '$49',
              blurb: 'The full app and the highlight machine. Videos post to TKO’s YouTube.',
            },
            {
              name: 'Pro League',
              price: '$149',
              blurb: 'Your own YouTube, your own videos, priority renders.',
            },
          ].map((p) => (
            <div key={p.name} className="card flex flex-col p-6">
              <h4 className="text-lg font-bold text-ink">{p.name}</h4>
              <p className="mt-1">
                <span className="text-3xl font-bold text-ink">{p.price}</span>
                <span className="text-sm text-ink-muted">/mo</span>
              </p>
              <p className="mt-2 flex-1 text-sm text-ink-muted">{p.blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 text-center">
          <Link to="/make-a-league" className="btn-ghost">
            Compare plans <ArrowRight size={15} />
          </Link>
        </div>
        <p className="mt-3 text-center text-sm text-ink-muted">
          Players join free.{' '}
          <Link to="/signup" className="text-accent underline hover:text-ink">
            Not an owner? Join as a player
          </Link>
        </p>
      </section>

      <FinalCta
        heading="Your league could be live this week."
        sub="Build it in the Studio, watch the phone change as you type, and launch when it looks like yours."
      />
    </main>
  )
}

function LeagueCardSkeleton() {
  return (
    <div className="card flex flex-col overflow-hidden" aria-hidden>
      <div className="h-20 animate-pulse bg-dark-elevated" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-dark-elevated" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-dark-elevated" />
        <div className="mt-4 h-9 w-full animate-pulse rounded-lg bg-dark-elevated" />
      </div>
    </div>
  )
}

function LeagueCard({ league, onEnter }: { league: LeagueConfig; onEnter: () => void }) {
  const { colors } = league
  return (
    <div className="card card-hover flex flex-col">
      <div
        className="flex h-20 items-end px-4 pb-2"
        style={{ background: `linear-gradient(120deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }}
      >
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
          style={{ background: colors.accent, color: '#111' }}
        >
          {league.video_ownership === 'league' ? 'League-owned videos' : 'Powered by TKO'}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h4 className="truncate font-bold text-ink">{league.name}</h4>
        <p className="truncate text-xs text-ink-muted">
          {league.tagline || league.domain}
        </p>
        <div className="mt-1 flex items-center gap-1.5" aria-hidden>
          {[colors.primary, colors.secondary, colors.accent].map((c, i) => (
            <span key={i} className="h-3.5 w-3.5 rounded-full border border-ink/20" style={{ background: c }} />
          ))}
          <span className="ml-auto text-[11px] text-ink-muted">{league.domain}</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onEnter} className="btn-primary flex-1 text-sm">
            Enter league <ArrowRight size={15} />
          </button>
          <Link to="/signup" className="btn-ghost text-sm">
            Join
          </Link>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Make-a-league (marketing + pricing) view
// ───────────────────────────────────────────────────────────────────────────

const TALK_TO_US_MAILTO = `mailto:${SUPPORT.email}?subject=${encodeURIComponent(
  'TKO Enterprise league — talk to us',
)}&body=${encodeURIComponent('League name:\nGame / community:\nWhere can we reach you?')}`

/**
 * The funnel step between a pricing card and a CHARGE.
 *
 * This used to point at `/studio?tier=<tier>`, which let a prospect design a
 * league and then stop — there was nowhere to pay, and the Studio simply wrote
 * the tier they picked straight into their own row. Both cards now land on
 * /league-plans, where the plan is bought (or the lead captured) before any
 * entitlement exists. `?plan=` preselects the card they clicked.
 *
 * Signed-out owners still get an account first: a league needs an owner, so
 * checkout requires auth. The plans page prompts for signup itself, so linking
 * a signed-out visitor there directly is fine — they can read the plans and
 * leave an Enterprise lead without an account.
 */
function tierCta(plan: 'starter' | 'pro' | 'dynasty') {
  return { to: `/league-plans?plan=${plan}`, state: undefined }
}

function MakeALeague() {
  // No auth read here any more: the pricing CTAs go to /league-plans, which
  // handles the signed-out case itself (read the plans, leave an Enterprise
  // lead, prompt for signup only when a card is about to be charged).
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <Hero
        eyebrow="Grow your league"
        title={
          <>
            Every angle.
            <br />
            <span style={BOARD_GRADIENT}>One cam.</span>
          </>
        }
        sub="Your players upload clips — TKO cuts multi-angle shorts with commentary, brands them in your colors, and posts them automatically. Your league gets an app, a feed and a highlight machine without hiring an editor."
      >
        <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
          <a href="#pricing" className="btn-primary px-7 py-3 text-base">
            <Crown size={18} /> Pick your plan
          </a>
          <Link to="/studio" className="btn-ghost px-7 py-3 text-base">
            <Sparkles size={18} /> Try the Studio first
          </Link>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          The flagship runs on TKO today:{' '}
          <a
            href="https://shinobistrikerleague.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent underline hover:text-ink"
          >
            shinobistrikerleague.com
          </a>{' '}
          — that whole site is this app wearing one league&apos;s brand.
        </p>
        <VerticalChips className="mt-7" />
      </Hero>

      <HowItWorks />

      <WhatYouGet />

      <TwoPaths />

      {/* PRICING — the ownership split. No free tier for league owners. */}
      <section id="pricing" className="pt-14">
        <h3 className="section-heading mb-1 text-center">Pick how you own it</h3>
        <p className="mb-6 text-center text-sm text-ink-muted">
          Every plan runs the full app. The difference is whose channel the videos live on — and who
          owns them.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <PricingCard
            name="Starter"
            price="$49"
            blurb="Videos post to TKO's YouTube. TKO owns the videos — you get the league, the app and the highlight machine at the lowest price."
            features={[
              'Your branded league inside the TKO app',
              'Auto-cut multi-angle highlight shorts',
              'Posted to TKO’s YouTube channel',
              'League feed, clans, brackets & rankings',
            ]}
            cta={{ label: 'Start with Starter', ...tierCta('starter') }}
          />
          <PricingCard
            name="Pro League"
            price="$149"
            featured
            blurb="Connect your OWN YouTube. Your channel, your videos, your audience — TKO does the cutting and posting."
            // Truth-in-advertising: 'Priority render queue' and 'AI Studio help'
            // used to sit here and NEITHER is built — render_jobs is claimed
            // strictly FIFO, and the Studio AI is free to every signed-in
            // account on every plan. Both are marked `roadmap` in
            // src/lib/leaguePlans.ts, and sellableCapabilities() filters them
            // out of /league-plans for exactly this reason.
            features={[
              'Everything in Starter',
              'Videos post to YOUR YouTube channel',
              'You own every video',
              'Your own domain takes the app over',
            ]}
            cta={{ label: 'Go Pro League', ...tierCta('pro') }}
          />
          <EnterpriseCard />
        </div>

        {/* Members ride free — the player side of the model. */}
        <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-dark-border bg-dark-card/60 p-5 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Users size={20} />
          </span>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">League members ride free.</span> Every free
            member gets 1 auto-cut video a week on their own page — shareable by link, never on the
            front page. Paid members get more videos, front-page promotion and render priority.
          </p>
        </div>
      </section>

      <FinalCta
        heading="Start it now, decide the plan later."
        sub="The Studio is free to use. Style your league, watch the phone follow along, and pick a plan when you're ready to launch."
      />
    </main>
  )
}

function PricingCard({
  name,
  price,
  blurb,
  features,
  cta,
  featured = false,
}: {
  name: string
  price: string
  blurb: string
  features: string[]
  cta: { label: string; to: string; state?: { from: string; reason: string } }
  featured?: boolean
}) {
  return (
    <div
      className={`card relative flex flex-col p-6 ${
        featured ? 'border-kunai shadow-kunai' : ''
      }`}
    >
      {featured && (
        <span className="pill-kunai absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          Most popular
        </span>
      )}
      <h4 className="text-lg font-bold text-ink">{name}</h4>
      <p className="mt-1">
        <span className="text-3xl font-bold text-ink">{price}</span>
        <span className="text-sm text-ink-muted">/mo</span>
      </p>
      <p className="mt-2 text-sm text-ink-muted">{blurb}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-muted">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
      <Link to={cta.to} state={cta.state} className={`mt-5 ${featured ? 'btn-primary' : 'btn-ghost'} w-full`}>
        {cta.label} <ArrowRight size={15} />
      </Link>
    </div>
  )
}

/**
 * Enterprise — visible but COMING SOON. Fully branded standalone app (their
 * icon + name on the phone, players never see TKO), extra features and
 * consultant-led onboarding. No checkout: the CTA is a "talk to us" capture.
 */
function EnterpriseCard() {
  return (
    <div className="card relative flex flex-col overflow-hidden p-6">
      <span className="pill-chakra absolute right-4 top-4">Coming soon</span>
      <h4 className="text-lg font-bold text-ink">Enterprise</h4>
      <p className="mt-1">
        <span className="text-3xl font-bold text-ink">Let&apos;s talk</span>
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Your league as its OWN app — your icon and your name on the phone. Players never see TKO.
      </p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-muted">
        {[
          'Fully branded standalone app',
          'Your icon + name on the home screen',
          'Everything in Pro League, and more',
          'Consultant-led onboarding, start to launch',
        ].map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Rocket size={15} className="mt-0.5 shrink-0 text-chakra" />
            {f}
          </li>
        ))}
      </ul>
      <a href={TALK_TO_US_MAILTO} className="btn-ghost mt-5 w-full border-chakra/40 text-chakra">
        <MessageCircle size={15} /> Talk to us
      </a>
      <p className="mt-2 text-center text-[11px] text-ink-muted">
        Or message the team at{' '}
        <a href={SUPPORT.facebookUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          {SUPPORT.facebookLabel}
        </a>
      </p>
    </div>
  )
}
