import { Link } from 'react-router-dom'
import { SUPPORT } from '@/lib/brand'
import { NinjaIcon } from '@/components/ui'
import { useAskTko } from '@/components/AskTkoContext'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { CODE_REDEMPTION_ENABLED, IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

/**
 * Get help — the customer-service entry point.
 *
 * There is no ticket queue behind this. Two doors, both real:
 *   • Ask TKO — the in-app guided assistant (CommandBar), which answers the
 *     "how do I…" questions that make up most of the volume, instantly.
 *   • facebook.com/tkocam — where an actual person reads and replies when the
 *     assistant can't help.
 *
 * Phone-first: two big tap targets above the fold, everything else below.
 */
export function Help() {
  const { open: openAskTko } = useAskTko()
  const { display } = useLeagueTheme()
  const brandName = display.productName

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-white">Get help</h1>
        <p className="text-sm text-gray-400">
          Stuck on something in {brandName}? Start with the assistant — it walks you through the app step
          by step. If you need a person, we're on Facebook.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Ask TKO — instant, in-app, no waiting. */}
        <button
          type="button"
          onClick={() => openAskTko(null)}
          className="group text-left rounded-xl border border-accent/40 bg-accent/5 p-5 transition-colors hover:border-accent hover:bg-accent/10"
        >
          <span className="flex items-center gap-2 text-accent">
            <NinjaIcon name="sparkle" size={20} />
            <span className="text-lg font-semibold">{display.assistantName}</span>
          </span>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">
            The in-app guided assistant. Pick what you're trying to do — make a clip, go live, enter a
            tournament — and it walks you through it right here. Answers immediately.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-accent">
            Open assistant <NinjaIcon name="chevron-right" size={14} />
          </span>
        </button>

        {/* Facebook — where a human answers. */}
        <a
          href={SUPPORT.facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group text-left rounded-xl border border-trust/40 bg-trust/5 p-5 transition-colors hover:border-trust hover:bg-trust/10"
        >
          <span className="flex items-center gap-2 text-trust">
            <NinjaIcon name="chat" size={20} />
            <span className="text-lg font-semibold">Message us on Facebook</span>
          </span>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">
            {SUPPORT.facebookLabel} — the fastest way to reach a person. Account problems, payments, bugs,
            anything the assistant can't sort out. Opens in a new tab.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-trust">
            {SUPPORT.facebookLabel} <NinjaIcon name="chevron-right" size={14} />
          </span>
        </a>
      </div>

      <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Common things</h2>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>
            <button type="button" onClick={() => openAskTko('make-clip')} className="text-accent hover:underline">
              How do I make a clip?
            </button>
          </li>
          <li>
            <button type="button" onClick={() => openAskTko('connect-youtube')} className="text-accent hover:underline">
              Connect the correct YouTube channel
            </button>
          </li>
          <li>
            <button type="button" onClick={() => openAskTko('join-clan')} className="text-accent hover:underline">
              Apply to a clan and get approved
            </button>
          </li>
          <li>
            <button type="button" onClick={() => openAskTko('manage-clan-roster')} className="text-accent hover:underline">
              Approve members and build a clan roster
            </button>
          </li>
          <li>
            <button type="button" onClick={() => openAskTko('run-tournament')} className="text-accent hover:underline">
              Create, edit, and run a tournament
            </button>
          </li>
          <li>
            <button type="button" onClick={() => openAskTko('video-and-power-status')} className="text-accent hover:underline">
              Check a missing clip or power change
            </button>
          </li>
          {!IS_MOBILE_STORE_BUILD && (
            <li>
              <Link to="/upgrade" className="text-accent hover:underline">Membership, billing and what each tier unlocks</Link>
            </li>
          )}
          {CODE_REDEMPTION_ENABLED && (
            <li>
              <Link to="/redeem" className="text-accent hover:underline">Redeem a code</Link>
            </li>
          )}
          <li>
            <Link to="/data-deletion" className="text-accent hover:underline">Delete my account or request my data</Link>
          </li>
          <li>
            <Link to="/legal" className="text-accent hover:underline">Terms, privacy and other policies</Link>
          </li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        For account deletion and data requests you can also email{' '}
        <a href={`mailto:${SUPPORT.email}`} className="text-kunai hover:underline">{SUPPORT.email}</a>.
      </p>

      <div className="flex flex-wrap gap-4 pt-1 text-sm">
        <Link to="/" className="text-kunai hover:underline">← Home</Link>
      </div>
    </div>
  )
}

export default Help
