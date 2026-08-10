import { Link } from 'react-router-dom'
import { BRAND, SUPPORT } from '@/lib/brand'
import { DeleteAccountPanel } from '@/components/DeleteAccountPanel'

/**
 * Account Deletion & Data Request page ({BRAND.name}).
 *
 * Standalone, publicly linkable page required by the Google Play data-deletion
 * policy. Explains how to delete an account / request data, what is deleted,
 * what may be retained for legal reasons, and expected timelines.
 *
 * Live, published page — the timelines below are commitments. If the deletion
 * flow or the retention windows change, change this page in the same commit and
 * bump LAST_UPDATED.
 */
export function DataDeletion() {
  const SUPPORT_EMAIL = 'awakengiovanni3000@gmail.com'
  const LAST_UPDATED = '2026-08-04'

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 text-gray-300 space-y-4">
      <h1 className="text-2xl font-bold text-white">Account Deletion &amp; Data Request</h1>
      <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p>
        You can delete your {BRAND.name} ({BRAND.domain}) account and the personal data associated with it at
        any time. This page explains how, what gets removed, what we may need to keep, and how long it takes.
      </p>

      <h2 className="text-lg font-semibold text-white">Delete your account now</h2>
      <DeleteAccountPanel />

      <h2 className="text-lg font-semibold text-white pt-2">Other ways to delete your account</h2>
      <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
        <li>
          <strong className="text-white">In the app.</strong> Open your{' '}
          <Link to="/profile" className="text-kunai hover:underline">profile</Link> and choose
          <span className="text-white"> Delete account</span>. You will be asked to type DELETE to confirm;
          the account is then removed immediately.
        </li>
        <li>
          <strong className="text-white">By email.</strong> Send a request from the email address on your
          account to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20Deletion%20Request`} className="text-kunai hover:underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          with the subject "Account Deletion Request" and your username. We may ask you to verify ownership of
          the account before we proceed.
        </li>
      </ol>
      <p className="text-sm">
        To request a <strong className="text-white">copy of your data</strong> instead of (or in addition to)
        deletion, email {SUPPORT_EMAIL} with the subject "Data Request" from your account email.
      </p>

      <h2 className="text-lg font-semibold text-white">What gets deleted</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Your account and login credentials.</li>
        <li>Your profile information, username, and preferences.</li>
        <li>Your User Content that has not been shared publicly or with others — such as private clips, drafts, and settings.</li>
        <li>Your activity data tied to your identity, including chat, board/clan posts, prediction history, and cosmetic/badge records (subject to the retention exceptions below).</li>
        <li>Any Tokens, cosmetic assets, and prestige badges, which are forfeited on deletion and have no cash value.</li>
      </ul>
      <p className="text-sm">
        <strong className="text-white">If you lead a clan:</strong> deletion is never blocked. Leadership
        passes automatically to your longest-serving officer, or failing that your longest-serving member,
        so the clan and its other members are unaffected. A clan with no other members is disbanded with you.
      </p>

      <h2 className="text-lg font-semibold text-white">What may be retained</h2>
      <p className="text-sm">
        For legal, security, and operational reasons, some information may be retained after deletion, for
        example:
      </p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Transaction, billing, and payout records needed for tax, accounting, and legal compliance (held by us and/or by Stripe as our payment processor).</li>
        <li>Identity-verification status records where required by law (note: full identity documents are handled by Stripe Identity, not stored by us).</li>
        <li>Records needed to prevent fraud and abuse, resolve disputes, or enforce our Terms.</li>
        <li>Content you shared publicly or with others that has already been distributed or re-shared, and de-identified or aggregated data that no longer identifies you.</li>
        <li>Backups, which are purged on a rolling schedule.</li>
      </ul>
      <p className="text-sm">
        Retained records are kept only as long as necessary for the purpose above and are then deleted or
        de-identified.
      </p>

      <h2 className="text-lg font-semibold text-white">Timelines</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          Deletion started <strong className="text-white">in the app</strong> is{' '}
          <strong className="text-white">immediate</strong> — your account and profile are removed as soon
          as you confirm, and your username and clan tag are released straight away.
        </li>
        <li>We aim to acknowledge deletion and data requests sent by <strong className="text-white">email</strong> within <strong className="text-white">7 days</strong>, and to complete them within <strong className="text-white">30 days</strong> of verifying the request.</li>
        <li>Data residing in backups is removed within <strong className="text-white">90 days</strong> as backups cycle.</li>
        <li>Records subject to legal retention are kept only for the period required by applicable law.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">Contact</h2>
      <p>
        For any deletion or data request, contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>.
      </p>
      <div className="rounded-lg border border-trust/40 bg-trust/5 p-4 text-sm">
        <strong className="text-white">Looking for a person?</strong> If you're here because something went
        wrong rather than because you want to leave, open{' '}
        <Link to="/help" className="text-trust hover:underline">Get help</Link> — it opens the Ask TKO
        assistant, or you can message us on{' '}
        <a
          href={SUPPORT.facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-trust hover:underline"
        >
          {SUPPORT.facebookLabel}
        </a>
        . We'd rather fix it than see you delete your account.
      </div>

      <div className="flex flex-wrap gap-4 pt-2 text-sm">
        <Link to="/terms" className="text-kunai hover:underline">Terms of Service</Link>
        <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link>
        <Link to="/" className="text-kunai hover:underline">← Home</Link>
      </div>
    </div>
  )
}
