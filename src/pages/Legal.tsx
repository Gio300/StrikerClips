import { Link } from 'react-router-dom'
import { BRAND, SUPPORT } from '@/lib/brand'

/**
 * Legal & Agreements hub.
 *
 * A single place users can reach every policy document from. The individual
 * documents (Terms, Privacy, Data Deletion) live at their own routes and are
 * unchanged — this page just gathers and describes them so there is one clear
 * "Legal" entry point linked from the app sidebar and the marketing footer.
 */
const DOCS: { to: string; title: string; blurb: string }[] = [
  {
    to: '/terms',
    title: 'Terms of Service',
    blurb:
      'The agreement that governs your use of TKO — accounts, user content, the Oracle prediction system (entertainment & prestige only, no wagering), Tokens, subscriptions, and creator payouts.',
  },
  {
    to: '/privacy',
    title: 'Privacy Policy',
    blurb:
      'What we collect, how we use it, who we share it with, and the choices and controls you have over your data.',
  },
  {
    to: '/data-deletion',
    title: 'Data Deletion',
    blurb:
      'How to delete your account and request removal of your personal data, and what happens to already-shared content when you do.',
  },
]

export function Legal() {
  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 text-gray-300 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">Legal &amp; Agreements</h1>
        <p className="text-sm text-gray-400">
          Everything that governs how {BRAND.name} ({BRAND.domain}) works, in one place. Open any document
          below.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {DOCS.map((d) => (
          <Link
            key={d.to}
            to={d.to}
            className="group rounded-xl border border-dark-border bg-dark-card p-5 transition-colors hover:border-trust/50"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white group-hover:text-trust transition-colors">
                {d.title}
              </h2>
              <span className="text-trust opacity-70 group-hover:translate-x-0.5 transition-transform" aria-hidden>
                →
              </span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed mt-1.5">{d.blurb}</p>
          </Link>
        ))}
      </div>

      {/* People land on Legal looking for a human as often as for a policy —
          give them the support door before the disclaimer. */}
      <div className="rounded-xl border border-trust/40 bg-trust/5 p-5">
        <h2 className="text-lg font-semibold text-white">Need help, not paperwork?</h2>
        <p className="text-sm text-gray-400 leading-relaxed mt-1.5">
          For account, billing or "how do I…" questions, open{' '}
          <Link to="/help" className="text-trust hover:underline">Get help</Link> — it puts you straight into
          the Ask TKO assistant, or through to us on{' '}
          <a
            href={SUPPORT.facebookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-trust hover:underline"
          >
            {SUPPORT.facebookLabel}
          </a>
          .
        </p>
      </div>

      <div className="rounded-lg border border-chakra/40 bg-chakra/10 p-4 text-xs text-gray-300">
        These documents are working drafts describing how the platform operates. They are not legal advice
        and must be reviewed and finalized by qualified legal counsel before launch.
      </div>

      <div className="flex flex-wrap gap-4 pt-1 text-sm">
        <Link to="/" className="text-kunai hover:underline">← Home</Link>
      </div>
    </div>
  )
}
