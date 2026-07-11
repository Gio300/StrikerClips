import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'
import {
  CREATOR_AGREEMENT_VERSION,
  CREATOR_AGREEMENT_TEXT,
  REV_SHARE_PERCENT,
} from '@/lib/creatorAgreement'

/**
 * The Creator Agreement surface. This is both the human-readable terms and the
 * canonical text that gets hashed into each `creator_agreements` acceptance
 * record at upload. Not a substitute for counsel finalizing full ToS / privacy
 * / DMCA, but it is a real, specific license grant.
 */
export function Terms() {
  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 text-gray-300">
      <div>
        <h1 className="text-2xl font-bold text-white">{BRAND.name} Creator Agreement</h1>
        <p className="text-xs text-gray-500 mt-1">Version {CREATOR_AGREEMENT_VERSION}</p>
      </div>
      <p className="text-sm text-gray-500">
        {BRAND.name} is for creators who own the rights to the gameplay they post. You accept this
        agreement once at sign-up and again each time you publish a build.
      </p>

      <ol className="list-decimal list-inside space-y-3 text-sm leading-relaxed">
        <li>
          <strong className="text-white">You own (or have permission to use) your content.</strong> You’re responsible
          for clearing music, logos, and third-party IP in your sources. You keep ownership of your original clip.
        </li>
        <li>
          <strong className="text-white">License you grant {BRAND.name}.</strong> A non-exclusive, worldwide,
          royalty-free, sublicensable license to <strong>host</strong>; <strong>edit &amp; combine</strong> your clip
          with other creators’ angles into synced multi-angle edits and other derivative works;{' '}
          <strong>distribute</strong> and publicly display those works (including publishing them to the {BRAND.name}{' '}
          YouTube channel and embedding them back on {BRAND.domain}); and <strong>monetize</strong> them.
        </li>
        <li>
          <strong className="text-white">Your revenue share.</strong> {BRAND.name} pays participating creators a{' '}
          <strong className="text-leaf">{REV_SHARE_PERCENT}% share of net advertising revenue</strong> attributable to
          works that include your clip, tracked in your creator dashboard.
        </li>
        <li>
          <strong className="text-white">Transient raw uploads.</strong> To control cost, your raw upload may be deleted
          from our servers once the combined master is confirmed published. Takedown of your original is available any
          time (already-distributed masters, e.g. on YouTube, may persist beyond our control).
        </li>
        <li>
          <strong className="text-white">Platform rules &amp; conduct.</strong> We may remove content that violates
          YouTube, Twitch, or other platforms’ terms, the law, or this policy. No harassment, doxxing, or spam via
          invites, rooms, or clans.
        </li>
      </ol>

      <details className="rounded-lg border border-dark-border bg-dark p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Full agreement text (this is what gets recorded on accept)
        </summary>
        <pre className="mt-3 whitespace-pre-wrap text-xs text-gray-400 leading-relaxed font-mono">
          {CREATOR_AGREEMENT_TEXT}
        </pre>
      </details>

      <p className="text-xs text-gray-500">
        This is not legal advice. Replace and expand with counsel before launch, especially for minors, DMCA, and
        state privacy laws.
      </p>
      <Link to="/" className="text-kunai hover:underline text-sm font-medium">← Home</Link>
    </div>
  )
}
