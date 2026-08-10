import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronLeft,
  Clapperboard,
  Eye,
  Flame,
  Heart,
  Home,
  ImagePlus,
  Menu,
  MessageCircle,
  Music,
  Play,
  Plus,
  Radio,
  Share2,
  Smartphone,
  Sparkles,
  Trophy,
  TrendingDown,
  TrendingUp,
  UserPlus,
  X,
} from 'lucide-react'
import { LeagueThemeScope } from '@/components/LeagueThemeProvider'
import { leagueDisplayBrand } from '@/lib/displayBrand'
import { toThemeConfig } from '@/lib/leagueDomain'
import { DEFAULT_LEAGUE_CONFIG as TKO_NEUTRAL_APP_CONFIG } from '@/lib/leagueTheme'
import {
  DEFAULT_LEAGUE_CONFIG,
  isImageFile,
  loadLeagueDraft,
  musicLabel,
  subscribeLeagueDraft,
  uploadLogoFile,
  type LeagueConfig,
} from '@/lib/leagueConfig'
import { PART_LABEL, type LeaguePreviewPart } from '@/lib/leagueStudioRanges'
import {
  buildPreviewFixture,
  PREVIEW_VERTICALS,
  type PreviewFixture,
  type PreviewPlayer,
  type PreviewReel,
  type PreviewVerticalId,
} from '@/lib/leaguePreviewFixture'
import {
  loadPreviewVertical,
  savePreviewVertical,
  subscribePreviewVertical,
} from '@/lib/leaguePreviewVertical'

/**
 * PhonePreview — the pull-out phone on the League Gateway + League Studio.
 *
 * THE REAL APP, THEIR SKIN, SAMPLE DATA (operator vision 2026-08-03): the
 * screen inside the frame is the app's OWN shell — built from the app's real
 * design system (the same tailwind league-slot classes bg-dark, bg-dark-card,
 * border-dark-border, bg-kunai, text-accent, text-chakra, font-brand,
 * bg-gradient-kunai the deployed chrome uses) — wrapped in a <LeagueThemeScope>
 * fed by the DRAFT config, and POPULATED with a FAKE local fixture
 * (src/lib/leaguePreviewFixture.ts: invented players, reels, bracket,
 * standings — never real league data). So a league owner with zero members yet
 * can click through home / reels / live / bracket / standings and see exactly
 * what a visitor gets on their own domain, in their skin.
 *
 * THIS IS THE SALES INSTRUMENT (operator 2026-08-04): "that mockup isn't
 * strong enough to sell". A prospect who has never heard of TKO must look at
 * this frame and want it inside 30 seconds, so the sample league is a THRIVING
 * one — a dozen handles, a clip grid with view counts, standings with movement
 * and streaks, a bracket caught mid-tournament, a live match with a viewer
 * count that ticks and a chat that keeps arriving, an activity feed. Empty
 * states don't close deals.
 *
 * GAME-AGNOSTIC: the fixture is built from a chosen VERTICAL (esports,
 * shooter, soccer, racing, fighting, hoops — see leaguePreviewFixture.ts), so a
 * Rocket League or FIFA owner sees their own words in the mockup. The choice
 * persists in src/lib/leaguePreviewVertical.ts and every mounted preview
 * follows it live; it is deliberately NOT part of LeagueConfig, so league.json
 * and the AI-patch ranges are untouched.
 *
 * WHY COMPONENTS + A FIXTURE, NOT AN IFRAME: an <iframe src="/?league=slug">
 * only works for SAVED leagues (the ?league= param resolves via GET
 * /api/league/:slug/config), while the Studio must preview UNSAVED drafts live
 * on every keystroke — so the frame renders the app surfaces in-page under the
 * scope, fed the fixture, instead. Same variables, same classes, zero network.
 *
 * NEUTRAL DEFAULT (operator 2026-08-02): before a league customizes anything,
 * the phone shows the app in the TKO_NEUTRAL scheme with NO branding at all —
 * every brand slot (logo, name, tagline, banner, music) is a clickable "Add …"
 * PLACEHOLDER instead of a lockup.
 *
 * INTERACTIVE: the bottom nav, the LIVE badge, the competition sub-nav and the
 * clip tiles really navigate, so the preview demonstrates the app, not a
 * screenshot.
 *
 * CLICK-TO-REFERENCE: with `onPartRef` (the Studio passes it, gated behind its
 * "Point & edit" toggle) each brand part carries a faint blue ring and a tap
 * drops a blue reference chip into the chat, scoping the AI's patch to that
 * part (see PART_FIELDS in src/lib/leagueStudioRanges.ts).
 *
 * DRAG-AND-DROP: in the Studio the logo slot is a drop target — dragging an
 * image file onto it runs the SAME upload path as the panel's "Upload logo"
 * button (uploadLogoFile → saveLeagueDraft), so a dropped logo applies to the
 * draft and every mounted preview restyles instantly.
 *
 * INK RULE (palette v3, 2026-08-03): copy that sits on a THEMED SURFACE uses
 * `text-ink` / `text-ink-muted`, which invert with the skin — that is what lets
 * the neutral default render as the light reference board while SSL stays dark.
 * Copy that sits on a filled CTA uses `text-on-primary`. The only literal
 * white/black left in here is OVER-MEDIA chrome — play buttons, duration
 * badges, the reel scrim, the angle-tile labels — because their backdrop is the
 * generated thumbnail or a black scrim, never a surface the theme controls.
 *
 * GENERATED IMAGERY, NEVER PHOTOS: avatars and clip thumbnails are the
 * league's OWN gradient hue-rotated per seed (PreviewPlayer.hue /
 * PreviewReel.hue) behind a monogram or a scoreboard chip. That is how the grid
 * can look like a real feed without shipping one stock photo of a real person.
 */

type PhonePreviewProps = {
  /** Render a fixed config (league card hover) instead of the live draft. */
  config?: LeagueConfig
  /** Start with the panel slid out (the Studio wants it open). */
  defaultOpen?: boolean
  /** Click-to-reference: called with the preview part the user tapped. */
  onPartRef?: (part: LeaguePreviewPart) => void
  /**
   * Drop the edge tab on phones. The gateway already stacks a full inline
   * PhoneFrame into its hero on small screens, so the floating tab there is
   * both redundant and sitting on top of the pitch copy.
   */
  hideTabOnMobile?: boolean
}

// ───────────────────────────────────────────────────────────────────────────
//  Brand slots — the single source of truth for the "Add …" placeholders AND
//  their click-to-reference part, shared with PhonePreview.test.ts so the test
//  verifies the exact label↔part wiring the UI renders.
// ───────────────────────────────────────────────────────────────────────────

/** A brand slot: the preview part it references + the empty-state invite. */
export const BRAND_SLOTS: { part: LeaguePreviewPart; placeholder: string }[] = [
  { part: 'logo', placeholder: 'Add logo' },
  { part: 'name', placeholder: 'Add league name' },
  { part: 'tagline', placeholder: 'Add tagline' },
  { part: 'banner', placeholder: 'Add banner' },
  { part: 'music', placeholder: 'Add league anthem' },
]

/** The "Add …" invite for a brand part (falls back to its chip label). */
export function placeholderFor(part: LeaguePreviewPart): string {
  return BRAND_SLOTS.find((s) => s.part === part)?.placeholder ?? PART_LABEL[part]
}

/**
 * What the music chip says. An "Add league anthem" INVITE only belongs in the
 * Studio (where tapping it does something); on the marketing hero the same
 * chip would read as a half-built app, so an unset anthem falls back to the
 * feed's ordinary "Original sound" label — which is what the real app shows.
 */
export function musicSlot(music: string, editable?: unknown): string {
  if (music) return musicLabel(music)
  return editable ? placeholderFor('music') : 'Original sound'
}

/**
 * The shared "which sample league" state. Every mounted preview and every
 * vertical picker (the gateway hero chips, the Studio row) reads and writes
 * through this, so switching in one place moves all of them at once.
 */
export function usePreviewVertical(): [PreviewVerticalId, (id: PreviewVerticalId) => void] {
  const [vertical, setVertical] = useState<PreviewVerticalId>(() => loadPreviewVertical())
  useEffect(() => subscribePreviewVertical(() => setVertical(loadPreviewVertical())), [])
  return [vertical, (id: PreviewVerticalId) => setVertical(savePreviewVertical(id))]
}

export function PhonePreview({
  config,
  defaultOpen = false,
  onPartRef,
  hideTabOnMobile = false,
}: PhonePreviewProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [editMode, setEditMode] = useState(true)
  const [draft, setDraft] = useState<LeagueConfig>(() => config ?? loadLeagueDraft())
  const [vertical, setVertical] = usePreviewVertical()

  useEffect(() => {
    if (config) {
      setDraft(config)
      return
    }
    const sync = () => setDraft(loadLeagueDraft())
    sync()
    return subscribeLeagueDraft(sync)
  }, [config])

  // The Studio (onPartRef) previews the LIVE draft, so it may be edited: chips
  // (in "Point & edit") AND logo drop-to-apply. A fixed `config` (card hover)
  // is read-only.
  const editable = !config && Boolean(onPartRef)
  // On the gateway (no Studio around it) the preview IS the pitch, so it
  // carries the conversion CTA itself. Inside the Studio the page already owns
  // "Save league" and a second competing CTA would just be noise.
  const showCta = !onPartRef && !config

  return (
    <>
      {/* Edge tab — always visible so the preview is one tap away. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`fixed right-0 top-[38%] z-40 items-center gap-1.5 rounded-l-lg border border-r-0 border-dark-border bg-dark-elevated px-2 py-3 text-[11px] font-semibold uppercase tracking-widest text-ink-muted shadow-glow-lg transition-transform hover:text-ink ${
          hideTabOnMobile ? 'hidden sm:flex' : 'flex'
        } ${open ? 'translate-x-full opacity-0 pointer-events-none' : ''}`}
        style={{ writingMode: 'vertical-rl' }}
      >
        <Smartphone size={14} className="rotate-90" />
        Preview
      </button>

      {/* Slide panel. */}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-40 flex w-[352px] max-w-[94vw] flex-col items-center justify-center gap-3 overflow-y-auto border-l border-dark-border bg-dark/95 px-4 py-6 backdrop-blur transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* z-50: the close button must ALWAYS paint above the phone frame —
            on short viewports the frame overlaps this corner (operator bug). */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 z-50 rounded-lg border border-dark-border bg-dark-elevated p-1.5 text-ink-muted shadow-glow-lg hover:text-ink"
          aria-label="Close preview"
        >
          <X size={16} />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted/80">
          Live app preview
        </p>

        {/* Browse ↔ Point & edit (Studio only). Navigation works in both;
            "Point & edit" additionally lights the blue reference parts. */}
        {onPartRef && (
          <div
            role="tablist"
            aria-label="Preview mode"
            className="flex rounded-lg border border-dark-border bg-dark-elevated p-0.5 text-xs"
          >
            {(
              [
                [false, 'Browse'],
                [true, 'Point & edit'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={editMode === value}
                onClick={() => setEditMode(value)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  editMode === value
                    ? value
                      ? 'bg-trust text-white'
                      : 'bg-kunai text-on-primary'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <PhoneFrame
          cfg={draft}
          onPartRef={onPartRef && editMode ? onPartRef : undefined}
          editable={editable}
          vertical={vertical}
        />

        {/* Sample-league switch — the fastest possible proof that this platform
            is not "one video game with people I know". */}
        {!config && (
          <label className="flex w-full max-w-[292px] items-center gap-2 text-[11px] text-ink-muted">
            <span className="shrink-0">Sample league</span>
            <select
              value={vertical}
              onChange={(e) => setVertical(e.target.value as PreviewVerticalId)}
              className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark-elevated px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
              aria-label="Sample league type"
            >
              {PREVIEW_VERTICALS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="max-w-[292px] text-center text-xs text-ink-muted/80">
          {onPartRef
            ? editMode
              ? 'Tap a highlighted part to reference it in chat, or drop an image on the logo. The nav still works.'
              : 'This is the real app wearing your league — tap around, it navigates.'
            : 'Sample data, real app. Every screen here ships on day one, in your colors.'}
        </p>

        {showCta && (
          <div className="flex w-full max-w-[292px] flex-col gap-2">
            <Link to="/studio" className="btn-primary w-full">
              <Sparkles size={16} /> Build yours free
            </Link>
            <Link to="/make-a-league" className="btn-ghost w-full text-sm">
              See pricing <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </aside>
    </>
  )
}

/**
 * An UNBRANDED draft is the untouched default: no league name, no logo. The
 * preview then shows every brand slot as an "Add …" placeholder (and hides the
 * TKO pitch) — "it's just the app with those colors" until the owner brands it.
 */
export function isUnbrandedDraft(cfg: LeagueConfig): boolean {
  return cfg.slug === DEFAULT_LEAGUE_CONFIG.slug &&
    cfg.name === DEFAULT_LEAGUE_CONFIG.name &&
    !cfg.logoUrl
}

/** True while the draft still wears the untouched neutral color set. */
function hasNeutralColors(cfg: LeagueConfig): boolean {
  const d = DEFAULT_LEAGUE_CONFIG.colors
  return (
    cfg.colors.primary === d.primary &&
    cfg.colors.secondary === d.secondary &&
    cfg.colors.accent === d.accent
  )
}

/**
 * A clickable / droppable preview region. With no handler it renders as a
 * plain block; with `onPartRef` it becomes a button with a faint persistent
 * blue (trust) ring — the "point & edit" affordance — that drops a reference
 * chip into chat. With `onDropImage` it also accepts an image-file drop
 * (highlighting chakra while a file hovers) and runs the shared upload path.
 */
function Part({
  part,
  onPartRef,
  onDropImage,
  className = '',
  children,
}: {
  part: LeaguePreviewPart
  onPartRef?: (part: LeaguePreviewPart) => void
  onDropImage?: (file: File) => void
  className?: string
  children: ReactNode
}) {
  const [dragOver, setDragOver] = useState(false)

  const dropHandlers = onDropImage
    ? {
        onDragOver: (e: DragEvent) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer?.files?.[0]
          if (isImageFile(file)) onDropImage(file as File)
        },
      }
    : undefined

  const dropRing = onDropImage && dragOver ? ' ring-2 ring-chakra' : ''

  if (!onPartRef) {
    if (!onDropImage) return <div className={className}>{children}</div>
    return (
      <div className={`relative${dropRing ? dropRing : ''} ${className}`} {...dropHandlers}>
        {children}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPartRef(part)}
      title={
        onDropImage
          ? `Reference ${PART_LABEL[part]} in chat, or drop an image to set it`
          : `Reference ${PART_LABEL[part]} in chat`
      }
      aria-label={`Reference ${PART_LABEL[part]} in chat`}
      className={`relative cursor-pointer text-left outline-none ring-1 ring-trust/40 transition-shadow hover:ring-2 hover:ring-trust focus-visible:ring-2 focus-visible:ring-trust${dropRing} ${className}`}
      {...dropHandlers}
    >
      {children}
    </button>
  )
}

/** The five app surfaces the preview can navigate. */
export type PreviewScreen = 'home' | 'reels' | 'live' | 'tournament' | 'standings'
export const PREVIEW_SCREENS: PreviewScreen[] = ['home', 'reels', 'live', 'tournament', 'standings']

/** Screens grouped under the "Play" competition tab (share a sub-nav). */
const COMPETITION: { key: PreviewScreen; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'tournament', label: 'Bracket' },
  { key: 'standings', label: 'Standings' },
]
const isCompetition = (s: PreviewScreen) => COMPETITION.some((c) => c.key === s)

// ───────────────────────────────────────────────────────────────────────────
//  Generated media — the league's own gradient, hue-shifted per seed. This is
//  what lets a clip grid look like a real feed with zero photography.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Four light passes over the gradient bed. A grid where every tile carries the
 * SAME sheen reads as one repeated swatch no matter how the hues differ, so the
 * seed picks a composition too — a top-left key light, a low sun, a hard
 * diagonal streak, a stadium-style side wash.
 */
const FRAME_SHEENS: CSSProperties[] = [
  {
    background:
      'radial-gradient(120% 85% at 24% 12%, rgba(255,255,255,0.34) 0%, transparent 58%), ' +
      'linear-gradient(197deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.5) 100%)',
  },
  {
    background:
      'radial-gradient(90% 70% at 78% 88%, rgba(255,255,255,0.3) 0%, transparent 60%), ' +
      'linear-gradient(160deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)',
  },
  {
    background:
      'linear-gradient(112deg, transparent 30%, rgba(255,255,255,0.3) 44%, transparent 56%), ' +
      'radial-gradient(100% 80% at 50% 120%, rgba(0,0,0,0.5) 0%, transparent 70%)',
  },
  {
    background:
      'radial-gradient(70% 120% at 4% 50%, rgba(255,255,255,0.28) 0%, transparent 55%), ' +
      'linear-gradient(215deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)',
  },
]

/** The themed gradient bed under a thumbnail, rotated + lit off the seed. */
function MediaBed({ hue }: { hue: number }) {
  const sheen = FRAME_SHEENS[((hue % FRAME_SHEENS.length) + FRAME_SHEENS.length) % FRAME_SHEENS.length]
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-kunai"
        style={{ filter: `hue-rotate(${hue}deg)` }}
      />
      <span aria-hidden className="absolute inset-0" style={sheen} />
    </>
  )
}

/** A roster avatar — monogram over the league gradient, live players ringed. */
function Avatar({ who, size = 44 }: { who: PreviewPlayer; size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full p-[2px]"
      style={{ height: size, width: size }}
    >
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full bg-gradient-kunai ${who.live ? '' : 'opacity-35'}`}
        style={{ filter: `hue-rotate(${who.hue}deg)` }}
      />
      <span
        className="relative flex h-full w-full items-center justify-center rounded-full bg-dark-card font-bold text-ink"
        style={{ fontSize: Math.max(9, Math.round(size * 0.32)) }}
      >
        {who.initial}
      </span>
    </span>
  )
}

/** The phone itself — also usable inline (no pull-out) on the gateway hero. */
export function PhoneFrame({
  cfg,
  onPartRef,
  editable = false,
  vertical,
}: {
  cfg: LeagueConfig
  onPartRef?: (part: LeaguePreviewPart) => void
  /** The live draft may accept a dropped logo image (Studio only). */
  editable?: boolean
  /** Which sample league to populate with (defaults to the stored choice). */
  vertical?: PreviewVerticalId
}) {
  const [screen, setScreen] = useState<PreviewScreen>('home')
  const [storedVertical] = usePreviewVertical()
  const activeVertical = vertical ?? storedVertical
  const fx = useMemo(() => buildPreviewFixture(activeVertical), [activeVertical])
  const monogram = (cfg.name || 'L').trim().charAt(0).toUpperCase()
  const unbranded = isUnbrandedDraft(cfg)
  const previewDisplay = leagueDisplayBrand({ slug: cfg.slug, name: cfg.name, source: 'domain' })
  // Untouched colors → the full TKO_NEUTRAL phone board (navy screens, royal
  // CTAs — leagueTheme's DEFAULT_LEAGUE_CONFIG, incl. its navy background);
  // any custom color → derive the skin from the draft, exactly like a league
  // domain does.
  const theme = hasNeutralColors(cfg) ? TKO_NEUTRAL_APP_CONFIG : toThemeConfig(cfg)

  // Drop-to-apply: the same upload path the Studio panel button uses. Only the
  // live editable draft accepts drops (a fixed `config` card hover does not).
  const onLogoDrop = editable ? (file: File) => void uploadLogoFile(file) : undefined

  const screenProps = { cfg, unbranded, onPartRef, onLogoDrop, fx, go: setScreen }

  return (
    <div className="relative shrink-0">
      {/* Side hardware — the detail that stops the frame reading as a div. */}
      <span aria-hidden className="absolute -left-[3px] top-[104px] h-8 w-[3px] rounded-l bg-zinc-700" />
      <span aria-hidden className="absolute -left-[3px] top-[150px] h-12 w-[3px] rounded-l bg-zinc-700" />
      <span aria-hidden className="absolute -right-[3px] top-[132px] h-16 w-[3px] rounded-r bg-zinc-700" />

      <div
        className="relative w-[286px] rounded-[46px] p-[3px] shadow-[0_28px_70px_-18px_rgba(0,0,0,0.65)]"
        style={{ background: 'linear-gradient(160deg,#5b6270 0%,#1b1e25 34%,#0b0d11 62%,#43495a 100%)' }}
        role={onPartRef ? 'group' : 'img'}
        aria-label={`${unbranded ? 'App' : cfg.name} preview`}
      >
        <div className="relative overflow-hidden rounded-[43px] border-[9px] border-black bg-black">
          {/* Dynamic island */}
          <div className="absolute left-1/2 top-[9px] z-20 flex h-[22px] w-[86px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
          </div>

          {/* The screen: REAL app chrome under the draft league's CSS variables. */}
          <LeagueThemeScope
            league={theme}
            className="flex h-[566px] flex-col overflow-hidden rounded-[34px] bg-dark text-ink"
          >
            {/* Status bar */}
            <div className="flex items-center justify-between px-5 pb-1 pt-[13px] text-[10px] font-semibold text-ink">
              <span>9:41</span>
              <span className="flex items-center gap-1" aria-hidden>
                <span className="flex items-end gap-[2px]">
                  <span className="h-1 w-[3px] rounded-sm bg-ink" />
                  <span className="h-1.5 w-[3px] rounded-sm bg-ink" />
                  <span className="h-2 w-[3px] rounded-sm bg-ink" />
                  <span className="h-2.5 w-[3px] rounded-sm bg-ink/40" />
                </span>
                <span className="ml-1 h-2.5 w-5 rounded-[3px] border border-ink/40 p-[1.5px]">
                  <span className="block h-full w-3/4 rounded-[1px] bg-ink" />
                </span>
              </span>
            </div>

            {/* App header. Branded: the league lockup. Unbranded neutral: just
                the screen title — no league lockup, no TKO pitch — unless
                "Point & edit" is on, where "Add …" slots invite branding. */}
            <header className="flex min-h-[46px] items-center gap-2.5 border-b border-dark-border bg-dark/95 px-3 pb-2.5 pt-1.5">
              {unbranded && !onPartRef && !editable ? (
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold capitalize text-ink">
                  {screen === 'tournament' ? 'Bracket' : screen}
                </span>
              ) : (
                <>
                  <Part part="logo" onPartRef={onPartRef} onDropImage={onLogoDrop} className="shrink-0 rounded-lg">
                    {cfg.logoUrl ? (
                      <img src={cfg.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
                    ) : unbranded ? (
                      <span className="flex h-8 w-8 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-dark-border text-ink-muted/80">
                        <ImagePlus size={11} />
                      </span>
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-kunai text-sm font-bold text-on-primary">
                        {monogram}
                      </span>
                    )}
                  </Part>
                  <Part part="name" onPartRef={onPartRef} className="min-w-0 flex-1 rounded-md">
                    {unbranded ? (
                      <span className="block truncate text-[11px] font-semibold text-ink-muted/80">
                        {placeholderFor('name')}
                      </span>
                    ) : (
                      <>
                        <span className="block truncate font-brand text-[13px] font-bold uppercase leading-tight text-ink">
                          {cfg.name}
                        </span>
                        {!previewDisplay.isSsl && cfg.tier !== 'enterprise' && (
                          <span data-tko-attribution className="block text-[8px] leading-tight text-ink-muted/80">
                            Powered by TKO.cam
                          </span>
                        )}
                      </>
                    )}
                  </Part>
                </>
              )}
              <button
                type="button"
                onClick={() => setScreen('live')}
                className="flex shrink-0 items-center gap-1 rounded-full bg-kunai px-2 py-0.5 text-[10px] font-bold text-on-primary"
                aria-label="Open the live screen"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                LIVE
              </button>
            </header>

            {/* Competition sub-nav — appears on the live/bracket/standings trio
                so all three are one tap apart (the "Play" tab hub). */}
            {isCompetition(screen) && (
              <div className="flex gap-1 border-b border-dark-border bg-dark/95 px-2 py-1.5">
                {COMPETITION.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScreen(key)}
                    aria-current={screen === key ? 'page' : undefined}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                      screen === key ? 'bg-dark-elevated text-accent' : 'text-ink-muted/80 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* key={screen}: remounting on every switch is what gives the frame
                its clean cross-fade instead of a hard cut. */}
            <div key={screen} className="flex min-h-0 flex-1 animate-fade-in flex-col">
              {screen === 'home' && <HomeScreen {...screenProps} />}
              {screen === 'reels' && <ReelsScreen {...screenProps} />}
              {screen === 'live' && <LiveScreen fx={fx} />}
              {screen === 'tournament' && <BracketScreen fx={fx} />}
              {screen === 'standings' && <StandingsScreen fx={fx} />}
            </div>

            {/* Bottom nav — the real app's five-slot bar (see BottomNav.tsx).
                Home / Watch / Play really navigate the preview. */}
            <nav className="grid grid-cols-5 border-t border-dark-border bg-dark/95 px-1 pb-2.5 pt-2 text-[9px] font-medium">
              {(
                [
                  ['Home', Home, 'home'],
                  ['Watch', Clapperboard, 'reels'],
                  ['Create', Plus, null],
                  ['Play', Trophy, 'tournament'],
                  ['More', Menu, null],
                ] as const
              ).map(([label, Icon, target]) => {
                // "Play" stays lit across the whole competition group.
                const active =
                  target !== null &&
                  (screen === target || (label === 'Play' && isCompetition(screen)))
                const isCreate = label === 'Create'
                const inner = (
                  <>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                        active ? 'bg-dark-elevated text-kunai' : isCreate ? 'bg-kunai text-on-primary' : ''
                      }`}
                    >
                      <Icon size={15} strokeWidth={2} />
                    </span>
                    <span className="leading-none">{label}</span>
                  </>
                )
                const cls = `flex min-w-0 flex-col items-center justify-center gap-1 ${
                  active || isCreate ? 'text-ink' : 'text-ink-muted/80'
                }`
                return target !== null ? (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setScreen(target)}
                    aria-label={`Open ${label}`}
                    aria-current={active ? 'page' : undefined}
                    className={cls}
                  >
                    {inner}
                  </button>
                ) : (
                  <span key={label} className={cls}>
                    {inner}
                  </span>
                )
              })}
            </nav>
          </LeagueThemeScope>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  The five demo screens — real app surfaces fed the FAKE fixture
//  (src/lib/leaguePreviewFixture.ts)
// ───────────────────────────────────────────────────────────────────────────

type ScreenProps = {
  cfg: LeagueConfig
  unbranded: boolean
  onPartRef?: (part: LeaguePreviewPart) => void
  onLogoDrop?: (file: File) => void
  fx: PreviewFixture
  go: (screen: PreviewScreen) => void
}

/** Shared scroll shell so every screen keeps one rhythm and hides scrollbars. */
function ScreenScroll({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  )
}

/** Section header with an optional inline action ("See all"). */
function SectionLabel({
  label,
  action,
  onAction,
}: {
  label: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-baseline justify-between pt-0.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-ink-muted/80">{label}</p>
      {action && (
        <button type="button" onClick={onAction} className="text-[9px] font-semibold text-accent">
          {action}
        </button>
      )}
    </div>
  )
}

function HomeScreen({ cfg, unbranded, onPartRef, onLogoDrop, fx, go }: ScreenProps) {
  const reel = fx.reels[0]
  const { live, vertical } = fx
  const viewers = useTickingViewers(live.viewers)

  return (
    <ScreenScroll>
      {/* Live-now strip — the live players get the bright gradient ring. */}
      {/* The mask stops the strip ending on a half-cut avatar — it reads as
          "scrolls on" instead of "clipped". */}
      <div
        className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-0.5 [mask-image:linear-gradient(90deg,#000_86%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {fx.players.slice(0, 8).map((who) => (
          <span key={who.id} className="flex w-[46px] shrink-0 flex-col items-center gap-1">
            <Avatar who={who} />
            <span className="w-full truncate text-center text-[9px] text-ink-muted">{who.name}</span>
          </span>
        ))}
      </div>

      {/* LIVE NOW card — the "something is happening right now" beat. */}
      <button
        type="button"
        onClick={() => go('live')}
        className="relative block w-full overflow-hidden rounded-xl text-left"
      >
        <div className="relative h-[104px] w-full">
          <MediaBed hue={fx.reels[1].hue} />
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">
            <span className="h-1 w-1 animate-pulse rounded-full bg-white" /> Live
          </span>
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-semibold text-white">
            <Eye size={9} /> {viewers}
          </span>
          <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-white">{live.title}</span>
              <span className="block truncate text-[9px] text-white/75">
                {vertical.event} · 4 angles
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-black/55 px-2 py-1 text-[12px] font-bold text-white">
              {live.teamA} {live.scoreA}
              <span className="mx-1 text-white/60">–</span>
              {live.scoreB} {live.teamB}
            </span>
          </span>
        </div>
      </button>

      {/* Featured reel card — the feed's media tile in the league's colors. */}
      <article className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        <Part part="banner" onPartRef={onPartRef} className="block w-full">
          <div className="truncate bg-chakra/15 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-chakra">
            {unbranded
              ? onPartRef
                ? placeholderFor('banner')
                : reel.subtitle
              : `${cfg.name} · ${vertical.matchWord} highlight`}
          </div>
        </Part>
        <Part part="colors" onPartRef={onPartRef} className="block w-full">
          <div className="relative flex h-[150px] items-center justify-center overflow-hidden">
            <MediaBed hue={reel.hue} />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
              <Play size={22} fill="currentColor" />
            </span>
            {reel.scoreTag && (
              <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                {reel.scoreTag}
              </span>
            )}
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {reel.length}
            </span>
          </div>
        </Part>
        <Part part="tagline" onPartRef={onPartRef} className="block w-full">
          <div className="truncate bg-dark-elevated px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            {unbranded
              ? onPartRef
                ? placeholderFor('tagline')
                : reel.title
              : cfg.tagline || 'every angle. one cam.'}
          </div>
        </Part>
        <div className="flex items-center gap-2.5 px-3 py-2 text-ink-muted">
          <span className="flex items-center gap-1">
            <Heart size={13} /> <span className="text-[9px]">{reel.likes}</span>
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle size={13} /> <span className="text-[9px]">{reel.comments}</span>
          </span>
          <Share2 size={13} />
          <Part part="music" onPartRef={onPartRef} className="ml-auto min-w-0 rounded-full">
            <span className="flex items-center gap-1 rounded-full bg-dark-elevated px-2 py-0.5 text-[9px] text-accent">
              <Music size={9} className="shrink-0" />
              <span className="truncate">{musicSlot(cfg.music, onPartRef)}</span>
            </span>
          </Part>
        </div>
      </article>

      {/* The logo drop-zone hint only shows while the draft is still logo-less
          and the preview is editable — a friendly "drop your logo" target. */}
      {onLogoDrop && !cfg.logoUrl && (
        <Part part="logo" onPartRef={onPartRef} onDropImage={onLogoDrop} className="block w-full rounded-lg">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-dark-border bg-dark-card px-3 py-2 text-[10px] text-ink-muted">
            <ImagePlus size={13} className="shrink-0 text-accent" />
            <span className="truncate">Drop a logo image here, or tap to reference it in chat</span>
          </div>
        </Part>
      )}

      {/* Fresh clips — the populated feed grid, three across. */}
      <SectionLabel label="Fresh clips" action="See all" onAction={() => go('reels')} />
      <div className="grid grid-cols-3 gap-1.5">
        {fx.reels.slice(1, 4).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => go('reels')}
            className="relative aspect-[9/13] overflow-hidden rounded-lg"
            aria-label={r.title}
          >
            <MediaBed hue={r.hue} />
            <span className="absolute bottom-1 left-1 flex items-center gap-0.5 text-[7px] font-semibold text-white">
              <Play size={7} fill="currentColor" /> {r.views}
            </span>
            <span className="absolute right-1 top-1 rounded bg-black/55 px-1 text-[7px] font-semibold text-white">
              {r.length}
            </span>
          </button>
        ))}
      </div>

      {/* League pulse — the numbers that say "this thing has users". */}
      <div className="grid grid-cols-3 gap-1.5">
        {[
          [fx.stats.members, 'members'],
          [fx.stats.clipsThisWeek, 'clips / wk'],
          [fx.stats.hoursWatched, 'hrs watched'],
        ].map(([value, label]) => (
          <div key={label} className="rounded-lg border border-dark-border bg-dark-card px-2 py-1.5 text-center">
            <p className="text-[12px] font-bold leading-tight text-ink">{value}</p>
            <p className="text-[8px] uppercase tracking-wider text-ink-muted/80">{label}</p>
          </div>
        ))}
      </div>

      {/* Activity — the feed that proves people are doing things in here. */}
      <SectionLabel label="Latest" />
      <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        {fx.activity.map((a) => {
          const Icon =
            a.kind === 'result'
              ? Trophy
              : a.kind === 'clip'
                ? Clapperboard
                : a.kind === 'join'
                  ? UserPlus
                  : Flame
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 border-b border-dark-border px-2.5 py-1.5 last:border-b-0"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-dark-elevated text-accent">
                <Icon size={11} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink-muted">{a.text}</span>
              <span className="shrink-0 text-[8px] text-ink-muted/70">{a.when}</span>
            </div>
          )
        })}
      </div>

      <ChatSliver chat={fx.chat} />
    </ScreenScroll>
  )
}

/**
 * Watch — a POPULATED clip grid (what a league's feed actually looks like a
 * month in), with the immersive vertical player one tap away.
 */
function ReelsScreen({ cfg, unbranded, onPartRef, fx }: ScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = fx.reels.find((r) => r.id === openId) ?? null

  if (open) {
    return (
      <ImmersiveReel
        reel={open}
        cfg={cfg}
        unbranded={unbranded}
        onPartRef={onPartRef}
        onBack={() => setOpenId(null)}
      />
    )
  }

  return (
    <ScreenScroll>
      <Part part="banner" onPartRef={onPartRef} className="block w-full rounded-lg">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-chakra/15 px-2.5 py-1.5">
          <span className="truncate text-[9px] font-bold uppercase tracking-widest text-chakra">
            {unbranded && onPartRef
              ? placeholderFor('banner')
              : `${unbranded ? fx.vertical.event : cfg.name} · Highlights`}
          </span>
          <span className="shrink-0 text-[9px] text-ink-muted">
            {fx.stats.clipsThisWeek} this week
          </span>
        </div>
      </Part>

      <div className="grid grid-cols-2 gap-2">
        {fx.reels.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="group text-left">
            <span className="relative block aspect-[9/13] overflow-hidden rounded-lg">
              <MediaBed hue={r.hue} />
              {r.hot ? (
                <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-white">
                  <Flame size={8} /> Trending
                </span>
              ) : (
                r.scoreTag && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1 py-0.5 text-[7px] font-bold text-white">
                    {r.scoreTag}
                  </span>
                )
              )}
              <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 text-[7px] font-semibold text-white">
                {r.length}
              </span>
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black">
                  <Play size={14} fill="currentColor" />
                </span>
              </span>
              <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 text-[7px] font-semibold text-white">
                <Play size={7} fill="currentColor" /> {r.views}
              </span>
            </span>
            <span className="mt-1 block truncate text-[9.5px] font-semibold leading-tight text-ink">
              {r.title}
            </span>
            <span className="block truncate text-[8px] text-ink-muted/80">
              @{r.author} · {r.subtitle}
            </span>
          </button>
        ))}
      </div>
    </ScreenScroll>
  )
}

/** The immersive vertical player — the app's signature Watch surface. */
function ImmersiveReel({
  reel,
  cfg,
  unbranded,
  onPartRef,
  onBack,
}: {
  reel: PreviewReel
  cfg: LeagueConfig
  unbranded: boolean
  onPartRef?: (part: LeaguePreviewPart) => void
  onBack: () => void
}) {
  return (
    <div className="relative min-h-0 flex-1 animate-fade-in overflow-hidden">
      <Part part="colors" onPartRef={onPartRef} className="absolute inset-0 block h-full w-full">
        <div className="relative flex h-full w-full items-center justify-center">
          <MediaBed hue={reel.hue} />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
            <Play size={26} fill="currentColor" />
          </span>
        </div>
      </Part>

      {/* Progress bar — a reel mid-play, not a paused placeholder. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-white/20">
        <span className="block h-full w-1/3 bg-white/85" />
      </span>

      <button
        type="button"
        onClick={onBack}
        className="absolute left-2 top-3 z-10 flex items-center gap-0.5 rounded-full bg-black/50 px-2 py-1 text-[9px] font-semibold text-white"
      >
        <ChevronLeft size={11} /> Back
      </button>

      {/* Right action rail. */}
      <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white">
        {(
          [
            [Heart, reel.likes],
            [MessageCircle, reel.comments],
            [Share2, 'Share'],
          ] as const
        ).map(([Icon, label]) => (
          <span key={label} className="flex flex-col items-center gap-0.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45">
              <Icon size={15} />
            </span>
            <span className="text-[8px] font-semibold">{label}</span>
          </span>
        ))}
      </div>

      {/* Bottom overlay — reel meta in the league's voice. */}
      <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
        <p className="text-[10px] font-semibold text-white/85">@{reel.author}</p>
        <p className="text-[11px] font-bold text-white">{reel.title}</p>
        <Part part="tagline" onPartRef={onPartRef} className="block rounded">
          <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-white/90">
            {unbranded
              ? onPartRef
                ? placeholderFor('tagline')
                : reel.subtitle
              : cfg.tagline || 'every angle. one cam.'}
          </p>
        </Part>
        <Part part="music" onPartRef={onPartRef} className="inline-block rounded-full">
          <span className="flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[9px] text-white/90">
            <Music size={9} />
            <span className="max-w-[120px] truncate">{musicSlot(cfg.music, onPartRef)}</span>
          </span>
        </Part>
      </div>
    </div>
  )
}

/**
 * A viewer counter that drifts — the cheapest, most convincing "this is live"
 * signal there is. Deterministic start, small random walk, 3s cadence.
 */
function useTickingViewers(seed: number): string {
  const [n, setN] = useState(seed)
  useEffect(() => {
    setN(seed)
    const t = setInterval(() => {
      setN((v) => Math.max(120, v + Math.round((Math.random() - 0.42) * 26)))
    }, 3000)
    return () => clearInterval(t)
  }, [seed])
  return n.toLocaleString('en-US')
}

/** A chat that keeps arriving, so the live screen never looks frozen. */
function useLiveChat(pool: { who: string; msg: string }[], size = 4) {
  const [cursor, setCursor] = useState(size)
  useEffect(() => {
    setCursor(size)
    const t = setInterval(() => setCursor((c) => c + 1), 2600)
    return () => clearInterval(t)
  }, [pool, size])
  const out: { key: string; who: string; msg: string }[] = []
  for (let i = cursor - size; i < cursor; i++) {
    const item = pool[((i % pool.length) + pool.length) % pool.length]
    out.push({ key: String(i), who: item.who, msg: item.msg })
  }
  return out
}

function LiveScreen({ fx }: { fx: PreviewFixture }) {
  const { live, chat, vertical } = fx
  const viewers = useTickingViewers(live.viewers)
  const messages = useLiveChat(chat)

  return (
    <ScreenScroll>
      {/* Live header row. */}
      <div className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-ink">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-kunai" />
          <span className="truncate">{live.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-muted">
          <Eye size={11} /> {viewers}
        </span>
      </div>

      {/* Score bar — competitor codes in the league accent, clock underneath. */}
      <div className="rounded-lg bg-dark-elevated px-3 py-2">
        <div className="flex items-center justify-between text-[13px] font-bold">
          <span className="text-accent">{live.teamA}</span>
          <span className="text-ink">
            {live.scoreA} <span className="text-ink-muted/80">:</span> {live.scoreB}
          </span>
          <span className="text-accent">{live.teamB}</span>
        </div>
        <p className="mt-0.5 text-center text-[8px] uppercase tracking-widest text-ink-muted/80">
          {vertical.event} · {live.clock}
        </p>
      </div>

      {/* Multi-angle grid — four cameras of the same match. */}
      <div className="grid grid-cols-2 gap-2">
        {live.angles.map((who) => (
          <div key={who.id} className="relative h-[78px] overflow-hidden rounded-lg">
            <MediaBed hue={who.hue} />
            <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white/90">
              {who.initial}
            </span>
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1 py-0.5 text-[7px] font-bold text-white">
              <span className="h-1 w-1 animate-pulse rounded-full bg-white" /> {who.name}
            </span>
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[7px] font-semibold text-white">
              <Eye size={7} /> {who.viewers}
            </span>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1 text-[9px] text-ink-muted/80">
        <Radio size={10} className="shrink-0 text-kunai" /> 4 angles on the same{' '}
        {vertical.matchWord.toLowerCase()} — tap to switch
      </p>

      {/* Chat that keeps arriving. */}
      <div className="space-y-1.5 rounded-lg border border-dark-border bg-dark-card p-2.5">
        {messages.map((m) => (
          <p key={m.key} className="animate-fade-in truncate text-[10.5px] text-ink-muted">
            <span className="font-bold text-accent">{m.who}</span> {m.msg}
          </p>
        ))}
        <div className="flex items-center gap-1.5 rounded-full border border-dark-border bg-dark px-2.5 py-1 text-[9px] text-ink-muted/70">
          Say something…
          <Share2 size={10} className="ml-auto text-accent" />
        </div>
      </div>
    </ScreenScroll>
  )
}

/** Bracket screen — the fake tournament tree, caught mid-run. */
function BracketScreen({ fx }: { fx: PreviewFixture }) {
  return (
    <ScreenScroll>
      <div className="flex items-center justify-between">
        <p className="truncate text-[11px] font-bold text-ink">{fx.vertical.event}</p>
        <span className="pill-accent shrink-0 text-[8px]">
          8 {fx.vertical.unitPlural.toLowerCase()}
        </span>
      </div>

      {fx.bracket.map((round) => (
        <div key={round.name} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-ink-muted/80">
              {round.name}
            </p>
            <span
              className={`rounded px-1 py-px text-[7px] font-bold uppercase tracking-wider ${
                round.status === 'live'
                  ? 'bg-kunai text-on-primary'
                  : round.status === 'done'
                    ? 'bg-dark-elevated text-ink-muted'
                    : 'bg-dark-elevated text-accent'
              }`}
            >
              {round.status === 'live' ? 'Live' : round.status === 'done' ? 'Done' : 'Up next'}
            </span>
          </div>
          {round.matches.map((m) => {
            const aWon = !m.upcoming && m.scoreA > m.scoreB
            const bWon = !m.upcoming && m.scoreB > m.scoreA
            return (
              <div
                key={m.id}
                className={`overflow-hidden rounded-lg border bg-dark-card text-[11px] ${
                  m.live ? 'border-kunai/60 shadow-kunai' : 'border-dark-border'
                }`}
              >
                {(
                  [
                    [m.a, m.scoreA, aWon],
                    [m.b, m.scoreB, bWon],
                  ] as const
                ).map(([team, score, won], idx) => (
                  <div
                    key={`${m.id}-${idx}`}
                    className={`flex items-center justify-between gap-2 px-3 py-1.5 ${
                      idx === 0 ? 'border-b border-dark-border' : ''
                    }`}
                  >
                    <span className={`truncate font-semibold ${won ? 'text-accent' : 'text-ink-muted'}`}>
                      {team}
                    </span>
                    <span className={`shrink-0 font-bold ${won ? 'text-ink' : 'text-ink-muted/80'}`}>
                      {m.upcoming ? '–' : score}
                    </span>
                  </div>
                ))}
                {m.live && (
                  <div className="flex items-center gap-1 bg-dark-elevated px-3 py-1 text-[8px] font-bold uppercase tracking-widest text-kunai">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-kunai" /> Live now · best of 5
                  </div>
                )}
                {m.upcoming && m.when && (
                  <div className="bg-dark-elevated px-3 py-1 text-[8px] font-semibold uppercase tracking-widest text-ink-muted/80">
                    {m.when}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </ScreenScroll>
  )
}

/** Standings screen — the fake league table with movement, streaks and form. */
function StandingsScreen({ fx }: { fx: PreviewFixture }) {
  return (
    <ScreenScroll>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink">{fx.vertical.unitPlural}</p>
        <span className="truncate text-[9px] text-ink-muted">{fx.vertical.season}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        <div className="grid grid-cols-[1.3rem_1fr_1.05rem_1.05rem_1.7rem_1.55rem] items-center gap-1 border-b border-dark-border bg-dark-elevated px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-widest text-ink-muted/80">
          <span>#</span>
          <span>{fx.vertical.unit}</span>
          <span className="text-center">W</span>
          <span className="text-center">L</span>
          <span className="text-center">Form</span>
          <span className="text-right">Pts</span>
        </div>
        {fx.standings.map((row) => {
          const Move = row.move === 'up' ? TrendingUp : row.move === 'down' ? TrendingDown : null
          return (
            <div
              key={row.abbr}
              className="grid grid-cols-[1.3rem_1fr_1.05rem_1.05rem_1.7rem_1.55rem] items-center gap-1 border-b border-dark-border px-2.5 py-1.5 text-[10.5px] last:border-b-0"
            >
              <span className="flex items-center gap-0.5 font-bold text-ink-muted/80">
                {row.rank}
                {Move && (
                  <Move
                    size={8}
                    className={row.move === 'up' ? 'text-chakra' : 'text-kunai'}
                    aria-label={row.move === 'up' ? 'moved up' : 'moved down'}
                  />
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded">
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-kunai opacity-80"
                    style={{ filter: `hue-rotate(${row.hue}deg)` }}
                  />
                  <span className="relative text-[6px] font-bold text-white">{row.abbr}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate leading-tight">{row.team}</span>
                  <span className="block text-[7.5px] leading-tight text-ink-muted/70">
                    {row.streak}
                  </span>
                </span>
              </span>
              <span className="text-center text-ink-muted">{row.wins}</span>
              <span className="text-center text-ink-muted/80">{row.losses}</span>
              <span className="flex items-center justify-center gap-[1.5px]" aria-hidden>
                {row.form.map((f, i) => (
                  <span
                    key={i}
                    className={`h-[5px] w-[5px] rounded-full ${f === 'W' ? 'bg-chakra' : 'bg-ink-muted/30'}`}
                  />
                ))}
              </span>
              <span className="text-right font-bold text-accent">{row.points}</span>
            </div>
          )
        })}
      </div>
      <p className="text-center text-[8px] text-ink-muted/70">
        Top 4 advance to the {fx.vertical.event.toLowerCase()}
      </p>
    </ScreenScroll>
  )
}

/** The app's social pulse — the short chat card on the home screen. */
function ChatSliver({ chat }: { chat: { who: string; msg: string }[] }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-dark-border bg-dark-card p-2.5">
      {chat.slice(0, 3).map(({ who, msg }, i) => (
        <p key={`${who}-${i}`} className="truncate text-[10.5px] text-ink-muted">
          <span className="font-bold text-accent">{who}</span> {msg}
        </p>
      ))}
    </div>
  )
}
