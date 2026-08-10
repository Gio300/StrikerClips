import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Gauge,
  MessageCircle,
  Music,
  Rocket,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { LeagueUrlPanel } from '@/components/LeagueUrlPanel'
import { PhonePreview, usePreviewVertical } from '@/components/PhonePreview'
import { useAuth } from '@/hooks/useAuth'
import { TKO_NEUTRAL_STUDIO_VARS } from '@/lib/leagueTheme'
import { PREVIEW_VERTICALS } from '@/lib/leaguePreviewFixture'
import {
  applyChatIntent,
  applyChatIntentAI,
  DEFAULT_LEAGUE_CONFIG,
  downloadLeagueJson,
  isImageFile,
  loadLeagueDraft,
  matchingPalettePreset,
  MUSIC_LIBRARY,
  musicLabel,
  PALETTE_PRESETS,
  parseColorWord,
  PART_LABEL,
  readImageFileAsDataUrl,
  resetLeagueDraft,
  saveLeagueDraft,
  subscribeLeagueDraft,
  upsertLeague,
  type LeagueColors,
  type LeagueConfig,
  type LeaguePreviewPart,
} from '@/lib/leagueConfig'

/**
 * League App Studio — where a league owner styles their app (design image 3:
 * a two-pane tool, labeled config sections + swatch rows on the left, live
 * phone screens on the right — here the right side is the pull-out
 * PhonePreview, open by default so every edit restyles it instantly).
 *
 * TWO LANES (operator 2026-08-04): "they could just drop branding and go, or
 * upgrade their platform with details." The Studio now ASKS that question
 * first, on one screen, and then gets out of the way:
 *
 *   • FAST LANE (`?lane=fast`) — name, logo, a one-tap palette, the kind of
 *     competition you run, launch. Four decisions on one card with a readiness
 *     checklist, so a prospect can be looking at their own branded app inside a
 *     couple of minutes without ever meeting a hex code or the AI.
 *   • PRO LANE (`?lane=pro`) — everything: the basics rail, the AI chat with
 *     click-to-reference, and the full labeled Direct-input editor.
 *
 * The lane rides the URL, so a reload (or a shared link) keeps the owner where
 * they were, and either lane can hop to the other at any time — they are two
 * doors onto the SAME draft object, never two different products.
 *
 * SAMPLE LEAGUE (game-agnostic): both lanes carry the vertical picker that
 * decides what the phone preview is populated with — esports, shooter, soccer,
 * racing, fighting, hoops. It is a PREVIEW preference only (see
 * src/lib/leaguePreviewVertical.ts), never part of the saved league config, so
 * league.json and the AI-patch ranges are untouched by it.
 *
 * CLICK-TO-REFERENCE: tapping a part of the phone preview (logo, name,
 * tagline, colors, banner, music) drops a BLUE reference tag into the chat;
 * the send is then scoped to that part, both in the AI fn and in the local
 * fallback. Tapping from the fast lane hops to the pro lane, because that is
 * where the chat lives.
 *
 * "Save" upserts the `leagues` row (owner account required — fails soft when
 * the backend/table isn't there yet); "Download league.json" always works and
 * emits the renderer-compatible schema (`tko_vertical.py --league`).
 */

type ChatMsg = { role: 'assistant' | 'user'; text: string }
type OnboardStep = 'name' | 'colors' | 'logo' | 'music' | 'free'

/** Which door the owner came through. `pick` is the chooser itself. */
type Lane = 'pick' | 'fast' | 'pro'

function normalizeLane(raw: string | null): Lane {
  return raw === 'fast' || raw === 'pro' ? raw : 'pick'
}

const GREETING =
  "Welcome to the League App Studio. I'll set your league up in four quick questions — you can fine-tune anything afterwards, by prompt or with the basics panel. First: what's your league called?"

export function LeagueStudio() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [cfg, setCfg] = useState<LeagueConfig>(() => loadLeagueDraft())
  const [mode, setMode] = useState<'chat' | 'direct'>('chat')
  const [refPart, setRefPart] = useState<LeaguePreviewPart | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const [savedSlug, setSavedSlug] = useState('')
  // Bumped after a successful save so the "League URL" panel re-pulls the real
  // addresses (rung 3 needs the leagues row to exist before it can be claimed).
  const [urlReloadKey, setUrlReloadKey] = useState(0)

  const lane = normalizeLane(params.get('lane'))

  // Keep local state in lock-step with the shared draft (and the preview).
  useEffect(() => subscribeLeagueDraft(() => setCfg(loadLeagueDraft())), [])

  // A pricing-card CTA preselects the ownership tier (?tier=starter|pro).
  useEffect(() => {
    const tier = params.get('tier')
    if (tier === 'starter') saveLeagueDraft({ tier: 'starter', video_ownership: 'tko' })
    if (tier === 'pro') saveLeagueDraft({ tier: 'pro', video_ownership: 'league' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Move lanes without losing the tier the pricing page picked. */
  function setLane(next: Lane) {
    const nextParams = new URLSearchParams(params)
    if (next === 'pick') nextParams.delete('lane')
    else nextParams.set('lane', next)
    setParams(nextParams, { replace: true })
  }

  function update(patch: Partial<LeagueConfig>) {
    setCfg(saveLeagueDraft(patch))
  }

  async function onSave() {
    if (!user) return
    setSaving(true)
    setSaveNote('')
    setSavedSlug('')
    const draft = loadLeagueDraft()
    const ok = await upsertLeague(draft, user.id)
    setSaving(false)
    setSaveNote(ok
      ? 'Saved — your league is live on the gateway.'
      : "Couldn't reach the server — your draft is safe here; try again in a moment.")
    if (ok) {
      setSavedSlug(draft.slug)
      setUrlReloadKey((k) => k + 1)
    }
  }

  const actions = (
    <ActionRow
      cfg={cfg}
      signedIn={!!user}
      lane={lane}
      saving={saving}
      saveNote={saveNote}
      savedSlug={savedSlug}
      onSave={onSave}
      onReset={() => setCfg(resetLeagueDraft())}
    />
  )

  return (
    // TKO_NEUTRAL_STUDIO_VARS re-skins ONLY this subtree (navy chrome, royal
    // CTAs, cyan/teal accents — the studio brand board). The in-app chrome
    // keeps its index.css defaults.
    <div
      className="min-h-screen bg-dark text-ink"
      style={TKO_NEUTRAL_STUDIO_VARS as CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-dark-border bg-dark/80 backdrop-blur">
        {/* lg:pr matches <main> — the preview pulls out over the right 372px,
            and without this the mode toggle slid underneath it. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:pr-[372px]">
          <Link
            to="/make-a-league"
            className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft size={16} /> Pricing
          </Link>
          <BrandLogo as="span" variant="horizontal" className="text-base" tko />
          <span className="hidden text-sm text-ink-muted/80 sm:block">League App Studio</span>

          {lane === 'fast' && (
            <button
              type="button"
              onClick={() => setLane('pro')}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-dark-border bg-dark-elevated px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <SlidersHorizontal size={15} /> Switch to pro lane
            </button>
          )}

          {/* Mode toggle — the pro lane's two editors. Chat is the default door. */}
          {lane === 'pro' && (
            <div
              className="ml-auto flex rounded-lg border border-dark-border bg-dark-elevated p-0.5 text-sm"
              role="tablist"
              aria-label="Editor mode"
            >
              {(
                [
                  ['chat', 'Chat', MessageCircle],
                  ['direct', 'Direct input', SlidersHorizontal],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                    mode === key ? 'bg-kunai text-on-primary' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* lg:pr keeps the editor clear of the open pull-out preview. */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:pr-[372px]">
        {lane === 'pick' && <LanePicker onPick={setLane} />}

        {lane === 'fast' && (
          <div className="mx-auto max-w-2xl">
            <FastLane cfg={cfg} update={update} onPro={() => setLane('pro')} />
            {actions}
          </div>
        )}

        {lane === 'pro' && (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            {/* The basics live HERE, always in reach — chat stays for the
                exact/free-form asks the panel can't express. */}
            <BasicsRail cfg={cfg} update={update} canManage={!!user} urlReloadKey={urlReloadKey} />

            <div className="min-w-0 flex-1">
              <div className="mx-auto max-w-2xl">
                <div className="mb-4">
                  <VerticalPicker />
                </div>
                {mode === 'chat' ? (
                  <ChatEditor
                    cfg={cfg}
                    update={update}
                    refPart={refPart}
                    onClearRef={() => setRefPart(null)}
                  />
                ) : (
                  <DirectEditor cfg={cfg} update={update} canManage={!!user} urlReloadKey={urlReloadKey} />
                )}
                {actions}
              </div>
            </div>
          </div>
        )}
      </main>

      <PhonePreview
        defaultOpen
        onPartRef={(part) => {
          // A preview tap is a chat gesture — surface the chat with the tag.
          setLane('pro')
          setMode('chat')
          setRefPart(part)
        }}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  The lane chooser — the operator's two paths, made explicit
// ───────────────────────────────────────────────────────────────────────────

function LanePicker({ onPick }: { onPick: (lane: Lane) => void }) {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="text-center">
        <span className="pill-accent">Your league, two ways</span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          How do you want to build it?
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-ink-muted">
          Same app, same features, same price — just two doors in. Switch whenever you like; nothing
          you do here is lost.
        </p>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <LaneCard
          icon={<Gauge size={22} />}
          eyebrow="Fastest"
          time="~2 minutes"
          title="Drop branding and go"
          bullets={[
            'Name it, drop a logo, tap a palette',
            'Pick the competition you run',
            'Launch — tune anything later',
          ]}
          cta="Start the fast lane"
          featured
          onClick={() => onPick('fast')}
        />
        <LaneCard
          icon={<SlidersHorizontal size={22} />}
          eyebrow="Full control"
          time="As long as you like"
          title="Upgrade with details"
          bullets={[
            'Every color slot, tagline, anthem and domain',
            'AI chat — point at any part of the app and ask',
            'Plan and video ownership',
          ]}
          cta="Open the pro lane"
          onClick={() => onPick('pro')}
        />
      </div>

      <p className="mt-5 text-center text-sm text-ink-muted">
        The phone on the right is already running your league app —{' '}
        <span className="text-ink">slide it out and tap around.</span> It navigates for real.
      </p>
    </section>
  )
}

function LaneCard({
  icon,
  eyebrow,
  time,
  title,
  bullets,
  cta,
  onClick,
  featured = false,
}: {
  icon: ReactNode
  eyebrow: string
  time: string
  title: string
  bullets: string[]
  cta: string
  onClick: () => void
  featured?: boolean
}) {
  return (
    <div className={`card flex flex-col p-6 ${featured ? 'border-kunai shadow-kunai' : ''}`}>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl ${
          featured ? 'bg-kunai text-on-primary' : 'bg-dark-elevated text-accent'
        }`}
      >
        {icon}
      </span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-ink-muted/80">
        {eyebrow} · {time}
      </p>
      <h2 className="mt-1 text-xl font-bold text-ink">{title}</h2>
      <ul className="mt-3 flex-1 space-y-2 text-sm text-ink-muted">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            {b}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        className={`mt-5 w-full ${featured ? 'btn-primary' : 'btn-ghost'}`}
      >
        {cta} <ArrowRight size={15} />
      </button>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Fast lane — four decisions, one card, a live phone next to it
// ───────────────────────────────────────────────────────────────────────────

/** The three things that make a league app look like a league. */
export function studioReadiness(cfg: LeagueConfig): { label: string; done: boolean }[] {
  return [
    { label: 'Name', done: cfg.name.trim().length > 0 && cfg.name !== DEFAULT_LEAGUE_CONFIG.name },
    { label: 'Logo', done: !!cfg.logoUrl },
    {
      label: 'Colors',
      done:
        cfg.colors.primary !== DEFAULT_LEAGUE_CONFIG.colors.primary ||
        cfg.colors.accent !== DEFAULT_LEAGUE_CONFIG.colors.accent,
    },
  ]
}

function FastLane({ cfg, update, onPro }: FieldProps & { onPro: () => void }) {
  const steps = studioReadiness(cfg)
  const done = steps.filter((s) => s.done).length

  return (
    <section aria-label="Fast lane" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Drop your branding</h1>
          <p className="text-sm text-ink-muted">
            Everything else already works. Watch the phone as you go.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {steps.map((s) => (
            <span
              key={s.label}
              className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${
                s.done
                  ? 'border-chakra/40 bg-chakra/15 text-chakra'
                  : 'border-dark-border bg-dark-elevated text-ink-muted'
              }`}
            >
              {s.done ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <FastStep n={1} title="Name your league" hint="It becomes your lockup and your address.">
        <input
          className="field text-base"
          value={cfg.name}
          onChange={(e) => update({ name: e.target.value })}
          maxLength={60}
          placeholder="e.g. Northside Cup"
          aria-label="League name"
        />
        <p className="mt-1.5 text-xs text-ink-muted/80">
          Your app will live at <span className="font-mono text-accent">{cfg.domain}</span> — a
          custom domain is one setting away.
        </p>
      </FastStep>

      <FastStep
        n={2}
        title="Drop your logo"
        hint="PNG or JPG. Drag it straight onto the phone if you like."
      >
        <LogoFields cfg={cfg} update={update} />
      </FastStep>

      <FastStep n={3} title="Pick your colors" hint="One tap re-skins every screen.">
        <PalettePicker cfg={cfg} update={update} />
      </FastStep>

      <FastStep n={4} title="What do you run?" hint="Sets the sample data in the preview.">
        <VerticalPicker />
      </FastStep>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <Rocket size={18} className="shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{done} of 3 done.</span> You can launch with any
          of these — everything stays editable forever.
        </p>
        <button
          type="button"
          onClick={onPro}
          className="text-sm font-medium text-accent hover:underline"
        >
          Need more control? Open the pro lane →
        </button>
      </div>
    </section>
  )
}

function FastStep({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dark-elevated text-sm font-bold text-accent">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="font-bold text-ink">{title}</h2>
          <p className="text-xs text-ink-muted/80">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

/** One-tap palettes — the fast lane's whole color decision. */
function PalettePicker({ cfg, update }: FieldProps) {
  const current = matchingPalettePreset(cfg.colors)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PALETTE_PRESETS.map((p) => {
          const active = current?.id === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => update({ colors: { ...cfg.colors, ...p.colors } })}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-kunai bg-dark-elevated text-ink'
                  : 'border-dark-border bg-dark-card text-ink-muted hover:text-ink'
              }`}
            >
              <span className="flex" aria-hidden>
                {[p.colors.primary, p.colors.secondary, p.colors.accent].map((c, i) => (
                  <span
                    key={i}
                    className={`h-4 w-4 rounded-full border border-ink/20 ${i > 0 ? '-ml-1.5' : ''}`}
                    style={{ background: c }}
                  />
                ))}
              </span>
              {p.label}
            </button>
          )
        })}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">
          Or set exact colors
        </summary>
        <div className="mt-3">
          <ColorFields cfg={cfg} update={update} />
        </div>
      </details>
    </div>
  )
}

/**
 * The sample-league picker. This is the game-agnostic proof: a Rocket League
 * owner taps "Racing & car sports" and the preview immediately talks about
 * races and overtakes instead of somebody else's game.
 */
function VerticalPicker() {
  const [vertical, setVertical] = usePreviewVertical()
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {PREVIEW_VERTICALS.map((v) => {
          const active = v.id === vertical
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVertical(v.id)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-kunai bg-kunai text-on-primary'
                  : 'border-dark-border bg-dark-card text-ink-muted hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-ink-muted/80">
        {PREVIEW_VERTICALS.find((v) => v.id === vertical)?.hint} — the app is the same either way.
      </p>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Shared action row — one config, whatever the lane
// ───────────────────────────────────────────────────────────────────────────

function ActionRow({
  cfg,
  signedIn,
  lane,
  saving,
  saveNote,
  savedSlug,
  onSave,
  onReset,
}: {
  cfg: LeagueConfig
  signedIn: boolean
  lane: Lane
  saving: boolean
  saveNote: string
  savedSlug: string
  onSave: () => void
  onReset: () => void
}) {
  const launch = lane === 'fast'
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {signedIn ? (
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary">
            {launch ? <Rocket size={16} /> : <Save size={16} />}{' '}
            {saving ? 'Saving…' : launch ? 'Launch my league' : 'Save league'}
          </button>
        ) : (
          // `from` returns the owner HERE after auth (their draft is in
          // localStorage, so nothing is lost) — no dead end at the wall.
          <Link
            to="/login"
            state={{
              from: `/studio?lane=${lane}`,
              reason: launch
                ? 'Create your account to launch your league — your branding is already saved on this device.'
                : 'Log in (or create an account) to save your league.',
            }}
            className="btn-primary"
          >
            {launch ? <Rocket size={16} /> : <Save size={16} />}{' '}
            {launch ? 'Create account & launch' : 'Log in to save'}
          </Link>
        )}
        <button type="button" onClick={() => downloadLeagueJson(cfg)} className="btn-ghost">
          <Download size={16} /> Download league.json
        </button>
        <button type="button" onClick={onReset} className="btn-ghost text-ink-muted">
          <RotateCcw size={15} /> Reset to TKO
        </button>
      </div>
      {saveNote && <p className="mt-2 text-sm text-ink-muted">{saveNote}</p>}
      {savedSlug && (
        <p className="mt-1 text-sm text-ink-muted">
          <Link to={`/reels?league=${savedSlug}`} className="text-accent hover:underline">
            See the full app wearing your league →
          </Link>{' '}
          <span className="text-ink-muted/80">
            (that&apos;s exactly what visitors get on your league&apos;s own domain)
          </span>
        </p>
      )}
      <p className="mt-2 text-xs text-ink-muted/80">
        Free to build and preview — you only pick a plan when you launch.{' '}
        <Link to="/make-a-league" className="text-accent hover:underline">
          See pricing
        </Link>
        .
      </p>
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Shared field groups — one source of markup for the basics rail AND the
//  Direct-input editor (image 3's swatch-row / grouped-panel styling)
// ───────────────────────────────────────────────────────────────────────────

const COLOR_SLOTS: { key: keyof LeagueColors; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
]

type FieldProps = {
  cfg: LeagueConfig
  update: (patch: Partial<LeagueConfig>) => void
}

/** FieldProps plus what the "League URL" panel needs (see LeagueUrlPanel). */
type UrlAwareFieldProps = FieldProps & {
  /** Signed in — the server still decides whether this league is theirs. */
  canManage: boolean
  /** Bumped after a save so the panel re-pulls the real (saved) addresses. */
  urlReloadKey: number
}

function IdentityFields({ cfg, update }: FieldProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">League name</span>
        <input
          className="field"
          value={cfg.name}
          onChange={(e) => update({ name: e.target.value })}
          maxLength={60}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Tagline</span>
        <input
          className="field"
          value={cfg.tagline}
          onChange={(e) => update({ tagline: e.target.value })}
          maxLength={80}
          placeholder="rise. strike. reign."
        />
      </label>
    </div>
  )
}

function ColorFields({ cfg, update, columns = 4 }: FieldProps & { columns?: 2 | 4 }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${columns === 4 ? 'sm:grid-cols-4' : ''}`}>
      {COLOR_SLOTS.map(({ key, label }) => (
        <label key={key} className="block text-center text-xs text-ink-muted">
          <input
            type="color"
            value={cfg.colors[key]}
            onChange={(e) => update({ colors: { ...cfg.colors, [key]: e.target.value } })}
            className="mb-1.5 h-14 w-full cursor-pointer rounded-lg border border-dark-border bg-dark"
            aria-label={`${label} color`}
          />
          {label}
          <span className="block font-mono text-[10px] text-ink-muted/80">{cfg.colors[key]}</span>
        </label>
      ))}
    </div>
  )
}

function LogoFields({ cfg, update }: FieldProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // The panel's logo box is BOTH a picker and a drop target: dropping an image
  // file here runs the same read→setter path the preview's logo slot uses.
  async function onLogoFile(file: File | undefined) {
    if (!isImageFile(file)) return
    const dataUrl = await readImageFileAsDataUrl(file as File)
    if (dataUrl) update({ logoUrl: dataUrl })
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg transition-shadow ${
        dragOver ? 'ring-2 ring-chakra' : ''
      }`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void onLogoFile(e.dataTransfer.files?.[0])
      }}
    >
      {cfg.logoUrl ? (
        <img src={cfg.logoUrl} alt="League logo" className="h-12 w-12 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-dark-border text-ink-muted/80">
          <Upload size={18} />
        </span>
      )}
      <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost text-sm">
        {cfg.logoUrl ? 'Replace logo' : 'Upload logo'}
      </button>
      {cfg.logoUrl && (
        <button
          type="button"
          onClick={() => update({ logoUrl: '' })}
          className="text-sm text-ink-muted/80 hover:text-ink"
        >
          Remove
        </button>
      )}
      <span className="w-full text-[11px] text-ink-muted/80">
        Drag an image here to set the logo, or use the button.
      </span>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onLogoFile(e.target.files?.[0])}
      />
    </div>
  )
}

function MusicField({ cfg, update }: FieldProps) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-muted">Anthem (TKO Suno library)</span>
      <select
        className="field"
        value={cfg.music}
        onChange={(e) => update({ music: e.target.value })}
      >
        <option value="">No music</option>
        {MUSIC_LIBRARY.map((t) => (
          <option key={t.file} value={t.file}>
            {t.label}
          </option>
        ))}
      </select>
      {cfg.music && (
        <span className="mt-1 block text-[11px] text-ink-muted/80">
          Plays under your highlight videos: {musicLabel(cfg.music)}
        </span>
      )}
    </label>
  )
}

function TierFields({ cfg, update }: FieldProps) {
  // The rail and the Direct editor can both be mounted — each instance needs
  // its own radio-group name or the two groups would swallow each other.
  const group = useId()
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="radio"
          name={group}
          className="mt-1"
          checked={cfg.tier === 'starter'}
          onChange={() => update({ tier: 'starter', video_ownership: 'tko' })}
        />
        <span>
          <span className="font-semibold text-ink">Starter</span> — videos post to TKO&apos;s
          YouTube; TKO owns the videos.
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="radio"
          name={group}
          className="mt-1"
          checked={cfg.tier === 'pro'}
          onChange={() => update({ tier: 'pro', video_ownership: 'league' })}
        />
        <span>
          <span className="font-semibold text-ink">Pro League</span> — your own YouTube; you own
          every video.
        </span>
      </label>
      <label className="flex cursor-not-allowed items-start gap-2.5 text-sm opacity-60">
        <input type="radio" name={group} className="mt-1" disabled checked={false} />
        <span>
          <span className="font-semibold text-ink">Enterprise</span> — fully branded standalone
          app. <span className="pill-chakra ml-1">Coming soon</span>
        </span>
      </label>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Basics rail — the always-there dropdown panel (drawer on mobile)
// ───────────────────────────────────────────────────────────────────────────

function BasicsRail({ cfg, update, canManage, urlReloadKey }: UrlAwareFieldProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <aside aria-label="League basics" className="w-full shrink-0 lg:w-[300px]">
      {/* Mobile: the whole rail collapses into a drawer behind this toggle;
          on lg+ the toggle disappears and the sections are always visible. */}
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        aria-expanded={mobileOpen}
        className="flex w-full items-center justify-between rounded-xl border border-dark-border bg-dark-card px-4 py-3 text-sm font-semibold text-ink lg:hidden"
      >
        League basics
        <ChevronDown
          size={16}
          className={`transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <div className={`mt-3 space-y-3 lg:mt-0 ${mobileOpen ? 'block' : 'hidden'} lg:block`}>
        <CollapsibleSection id="studio-identity" label="Identity" defaultOpen hint={cfg.name}>
          <IdentityFields cfg={cfg} update={update} />
        </CollapsibleSection>
        <CollapsibleSection id="studio-colors" label="Colors" defaultOpen>
          <PalettePicker cfg={cfg} update={update} />
        </CollapsibleSection>
        <CollapsibleSection id="studio-logo" label="Logo" defaultOpen>
          <LogoFields cfg={cfg} update={update} />
        </CollapsibleSection>
        <CollapsibleSection
          id="studio-music"
          label="Music"
          defaultOpen
          hint={cfg.music ? musicLabel(cfg.music) : ''}
        >
          <MusicField cfg={cfg} update={update} />
        </CollapsibleSection>
        <CollapsibleSection id="studio-plan" label="Plan" hint={cfg.tier}>
          <TierFields cfg={cfg} update={update} />
        </CollapsibleSection>
        {/* The league's ADDRESS — a tier benefit with three rungs (operator
            2026-08-04). Locked rungs stay VISIBLE with an upgrade CTA, the
            same honesty rule the Forge follows. */}
        <CollapsibleSection
          id="studio-url"
          label="League URL"
          hint={`tko.cam/${cfg.slug}`}
        >
          <LeagueUrlPanel cfg={cfg} canManage={canManage} reloadKey={urlReloadKey} />
        </CollapsibleSection>
      </div>
    </aside>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Chat editor (the pro lane's default mode)
// ───────────────────────────────────────────────────────────────────────────

function ChatEditor({
  cfg,
  update,
  refPart,
  onClearRef,
}: FieldProps & {
  /** Blue click-to-reference tag from the phone preview (or null). */
  refPart: LeaguePreviewPart | null
  onClearRef: () => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: 'assistant', text: GREETING }])
  const [step, setStep] = useState<OnboardStep>('name')
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  function say(text: string) {
    setMessages((m) => [...m, { role: 'assistant', text }])
  }

  function handleSend(raw?: string) {
    const text = (raw ?? input).trim()
    if (!text || thinking) return
    const part = refPart
    setMessages((m) => [
      ...m,
      { role: 'user', text: part ? `[${PART_LABEL[part]}] ${text}` : text },
    ])
    setInput('')

    // Free-form asks (and ANY part-tagged ask, even mid-onboarding) go to the
    // real AI fn; applyChatIntentAI falls back to the local matcher itself.
    if (part || step === 'free') {
      onClearRef()
      setThinking(true)
      void (async () => {
        try {
          // Read the draft fresh — `cfg` can lag a render behind rapid edits.
          const current = loadLeagueDraft()
          const res = await applyChatIntentAI(current, text, part)
          if (res.patch) update(res.patch)
          say(res.reply)
        } finally {
          setThinking(false)
        }
      })()
      return
    }

    switch (step) {
      case 'name': {
        const name = text.replace(/["'.]+$/g, '').slice(0, 60)
        update({ name })
        setStep('colors')
        say(`"${name}" — love it. Now pick your two main colors: name them or paste hex codes (e.g. "crimson and gold" or "#480000 #f0f0c0").`)
        return
      }
      case 'colors': {
        const found = text
          .split(/[^a-zA-Z0-9#]+/)
          .map(parseColorWord)
          .filter((h): h is string => !!h)
        if (found.length === 0) {
          say('Give me a color name (crimson, gold, navy…) or a hex code like #480000.')
          return
        }
        const colors: Partial<LeagueColors> = { primary: found[0] }
        if (found[1]) colors.secondary = found[1]
        if (found[2]) colors.accent = found[2]
        update({ colors: { ...cfg.colors, ...colors } })
        setStep('logo')
        say('Colors locked in — check the preview. Want to upload a logo? Tap "Upload logo" below, or say "skip".')
        return
      }
      case 'logo': {
        if (/skip|later|no/i.test(text)) {
          setStep('music')
          say('No problem — a monogram it is. Last one: pick a music vibe for your highlight videos. Tap a track below or name one.')
        } else {
          say('Use the "Upload logo" button below the chat — or say "skip".')
        }
        return
      }
      case 'music': {
        const res = applyChatIntent(cfg, `music ${text}`)
        if (res.patch) {
          update(res.patch)
          setStep('free')
          say(`${res.reply} You're all set — your league app is live in the preview. Keep editing by prompt anytime ("make the accent gold", "darker background", "tagline: rise and grind"), tap any part of the preview to reference it, or use the basics panel.`)
        } else {
          say(res.reply)
        }
        return
      }
    }
  }

  function onLogoFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      update({ logoUrl: String(reader.result ?? '') })
      setMessages((m) => [...m, { role: 'user', text: `(uploaded ${file.name})` }])
      if (step === 'logo') {
        setStep('music')
        say('Logo looks great in the header. Last one: pick a music vibe for your highlight videos — tap a track below or name one.')
      } else {
        say('Logo updated.')
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <section aria-label="Chat editor" className="card flex h-[480px] flex-col">
      {/* A titled strip so the panel reads as an assistant, not an empty box. */}
      <div className="flex items-center gap-2 border-b border-dark-border px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-kunai text-on-primary">
          <Sparkles size={13} />
        </span>
        <span className="text-sm font-semibold text-ink">Studio assistant</span>
        <span className="ml-auto text-[11px] text-ink-muted/80">
          Ask for anything — or tap the phone
        </span>
      </div>
      <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-kunai text-on-primary'
                  : 'rounded-bl-sm bg-dark-elevated text-ink'
              }`}
            >
              {m.text}
            </p>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <p className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-dark-elevated px-3.5 py-2 text-sm text-ink-muted">
              <Sparkles size={13} className="animate-pulse-soft text-accent" /> Styling…
            </p>
          </div>
        )}
      </div>

      {/* Quick replies for the guided steps. */}
      {(step === 'logo' || step === 'music') && (
        <div className="flex flex-wrap gap-1.5 border-t border-dark-border px-3 py-2">
          {step === 'logo' && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} className="pill hover:text-ink">
                <Upload size={12} className="mr-1" /> Upload logo
              </button>
              <button type="button" onClick={() => handleSend('skip')} className="pill hover:text-ink">
                Skip
              </button>
            </>
          )}
          {step === 'music' &&
            MUSIC_LIBRARY.slice(0, 6).map((t) => (
              <button
                key={t.file}
                type="button"
                onClick={() => handleSend(t.label)}
                className="pill hover:text-ink"
              >
                <Music size={12} className="mr-1" /> {t.label}
              </button>
            ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-dark-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
      >
        {/* The BLUE reference tag — dropped by tapping the phone preview. */}
        {refPart && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-trust/50 bg-trust/15 px-2 py-1 text-xs font-semibold text-trust">
            [{PART_LABEL[refPart]}]
            <button
              type="button"
              onClick={onClearRef}
              aria-label="Remove reference"
              className="rounded-full hover:text-ink"
            >
              <X size={11} />
            </button>
          </span>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            refPart
              ? `What about the ${PART_LABEL[refPart].toLowerCase()}?`
              : step === 'free'
                ? 'e.g. "make the accent gold"'
                : 'Type your answer…'
          }
          className="field flex-1"
          aria-label="Chat message"
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost px-3" title="Upload logo">
          <Upload size={16} />
        </button>
        <button type="submit" className="btn-primary px-3" aria-label="Send" disabled={thinking}>
          <Send size={16} />
        </button>
      </form>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onLogoFile(e.target.files?.[0])}
      />
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Direct-input editor — the full labeled-field view (adds what the basics
//  rail doesn't carry, e.g. the domain), built from the same field groups
// ───────────────────────────────────────────────────────────────────────────

function DirectEditor({ cfg, update, canManage, urlReloadKey }: UrlAwareFieldProps) {
  return (
    <section aria-label="Direct input editor" className="space-y-4">
      <div className="card space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted/80">Identity</h3>
        <IdentityFields cfg={cfg} update={update} />
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Domain</span>
          <input
            className="field"
            value={cfg.domain}
            onChange={(e) => update({ domain: e.target.value })}
            maxLength={80}
          />
        </label>
      </div>

      {/* Swatch row — image 3's color-palette board. */}
      <div className="card space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted/80">
          Color palette
        </h3>
        <PalettePicker cfg={cfg} update={update} />
      </div>

      <div className="card space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted/80">
          Logo &amp; music
        </h3>
        <LogoFields cfg={cfg} update={update} />
        <MusicField cfg={cfg} update={update} />
      </div>

      {/* Ownership tier — the pricing split, editable here too. */}
      <div className="card space-y-2 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted/80">
          Plan &amp; video ownership
        </h3>
        <TierFields cfg={cfg} update={update} />
      </div>

      {/* The three URL rungs — path (everyone), subdomain (Pro), own domain
          (the top plan). See src/components/LeagueUrlPanel.tsx. */}
      <div className="card space-y-2 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted/80">
          League URL
        </h3>
        <LeagueUrlPanel cfg={cfg} canManage={canManage} reloadKey={urlReloadKey} />
      </div>
    </section>
  )
}
