import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'

/**
 * Privacy Policy for {BRAND.name} ({BRAND.domain}).
 *
 * Live, published policy — keep it accurate. If the product starts collecting,
 * using, or sharing data in a way this page does not describe (new processors,
 * new API scopes, new retention), update this page in the same change and bump
 * LAST_UPDATED. Section 4 is the YouTube API Services disclosure required by the
 * YouTube API Services Terms of Service; the scopes it names must match what
 * src/lib/youtubeConnect.ts and scripts/youtube-uploader.ts actually request.
 */
export function Privacy() {
  const SUPPORT_EMAIL = 'awakengiovanni3000@gmail.com'
  const LAST_UPDATED = '2026-08-04'

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 text-gray-300 space-y-4">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p>
        {BRAND.name} ({BRAND.domain}, "we," "us," or "our") respects your privacy. This Privacy Policy
        explains what information we collect, how we use and share it, and the choices you have. By using the
        Service, you agree to this Policy and our{' '}
        <Link to="/terms" className="text-kunai hover:underline">Terms of Service</Link>.
      </p>

      <h2 className="text-lg font-semibold text-white">1. Information We Collect</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li><strong className="text-white">Account information</strong> — email, username, password (stored hashed by our auth provider), profile details, and preferences.</li>
        <li><strong className="text-white">Content you create</strong> — clips, reels, livestreams, chat messages, board and clan posts, tournament and prediction activity, and other User Content.</li>
        <li><strong className="text-white">Usage &amp; device data</strong> — pages viewed, features used, interactions, approximate location derived from IP, device and browser type, identifiers, and log data.</li>
        <li><strong className="text-white">Payment &amp; identity data</strong> — when you buy, subscribe, or receive a creator payout, payment and identity-verification data is collected and processed by Stripe and Stripe Identity. <span className="text-white">We do not store full card numbers or copies of your identity documents.</span> We receive limited confirmation details (such as verification status and the last digits of a card).</li>
        <li><strong className="text-white">Connected-platform data</strong> — if you connect a third-party account (such as YouTube), the information that platform returns to us. See section 4.</li>
        <li><strong className="text-white">Communications</strong> — messages you send us, such as support requests.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">2. How We Use Information</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Operate, maintain, and improve the Service and its features (reels, live, clans, tournaments, and the Oracle prediction system).</li>
        <li>Create and secure your account, authenticate you, and prevent fraud, cheating, and abuse.</li>
        <li>Process subscriptions, Token purchases, and creator payouts, and verify age and identity where required.</li>
        <li>Power rankings, power levels, badges, and cosmetic awards.</li>
        <li>Communicate with you about updates, security, and support.</li>
        <li>Show advertising to free-tier users and measure its performance; paid tiers see fewer or no ads.</li>
        <li>Comply with legal obligations and enforce our Terms.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">3. Sharing &amp; Processors</h2>
      <p>
        We do not sell your personal information. We share information with service providers ("processors")
        who perform functions on our behalf, and only as needed to run the Service, including:
      </p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li><strong className="text-white">Payments &amp; identity</strong> — Stripe and Stripe Identity.</li>
        <li><strong className="text-white">Hosting &amp; backend</strong> — our cloud hosting and database/auth provider (e.g., Google Cloud, Supabase).</li>
        <li><strong className="text-white">Ads &amp; analytics</strong> — advertising and analytics partners (e.g., Google AdSense / AdMob), which may set cookies or identifiers under their own policies.</li>
        <li><strong className="text-white">Video distribution &amp; playback</strong> — YouTube, where content is published, embedded, and played back (see section 4).</li>
      </ul>
      <p>
        We may also disclose information when required by law, to protect rights and safety, or in connection
        with a merger, acquisition, or sale of assets. Content you post publicly (such as reels, streams, and
        public profile details) is visible to others.
      </p>

      <h2 className="text-lg font-semibold text-white">4. YouTube API Services</h2>
      <p>
        {BRAND.name} uses <strong className="text-white">YouTube API Services</strong> to publish, list, and
        play back video. By using the parts of the Service that rely on YouTube, you are also agreeing to the{' '}
        <a
          href="https://www.youtube.com/t/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-kunai hover:underline"
        >
          YouTube Terms of Service
        </a>
        . Anything Google receives or handles through those services is governed by the{' '}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-kunai hover:underline"
        >
          Google Privacy Policy
        </a>
        .
      </p>

      <h3 className="text-base font-semibold text-white pt-1">4.1 What we access, and why</h3>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          <strong className="text-white">Connecting your channel (optional).</strong> If you choose to connect
          your YouTube account, Google asks you to approve read-only access (the{' '}
          <span className="text-white">youtube.readonly</span> scope). We use it only to list the videos on
          your own channel — video id, title, description, publish date, and channel name — so your footage
          appears in your {BRAND.name} library and you never have to paste links. With that connection we
          cannot post, edit, or delete anything on your channel.
        </li>
        <li>
          <strong className="text-white">Publishing produced videos.</strong> Videos our system produces —
          multi-angle cuts, tournament broadcasts, and highlight programs — are uploaded through the YouTube
          Data API (<span className="text-white">videos.insert</span>, the{' '}
          <span className="text-white">youtube.upload</span> scope) to the {BRAND.name} YouTube channel, using
          credentials for that channel. If you separately authorize us to upload to a channel you own, we use
          the same upload-only scope and upload only the videos you asked us to publish.
        </li>
        <li>
          <strong className="text-white">Playback.</strong> Video plays inside the app through the embedded
          YouTube player. That player is provided by YouTube and may set cookies and collect usage data under
          Google's own policies, whether or not you have a Google account.
        </li>
        <li>
          <strong className="text-white">Public information.</strong> We call the YouTube Data API with an API
          key to look up public details about channels and videos — titles, descriptions, thumbnails, and
          whether a channel is currently live — so feeds, profiles, and live indicators stay accurate.
        </li>
      </ul>

      <h3 className="text-base font-semibold text-white pt-1">4.2 What we store, and for how long</h3>
      <p className="text-sm leading-relaxed">
        From the YouTube API we store the video ids, titles, descriptions, publish dates, thumbnails, and
        channel identifiers needed to show your library and our feeds, plus the authorization token that keeps
        a connection working. We hold that token only while the connection is active. Cached YouTube data is
        kept in your browser or app storage and on our servers, refreshed as it changes, and{' '}
        <strong className="text-white">deleted within 30 days</strong> of the earliest of: you disconnecting
        the integration, you revoking access at Google, the data no longer being needed for the purpose above,
        or your account being deleted. We do not use YouTube data for advertising targeting, and we do not
        sell it.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">4.3 Revoking access</h3>
      <p className="text-sm leading-relaxed">
        You can disconnect at any time in your {BRAND.name} settings, which deletes our stored token and the
        cached YouTube data described above. You can also revoke access directly at Google's security settings
        page,{' '}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
          className="text-kunai hover:underline"
        >
          https://myaccount.google.com/permissions
        </a>
        , by selecting {BRAND.name} and removing access. Revoking stops all further access immediately.
        Revoking does not delete videos that have already been published to a YouTube channel — those live on
        YouTube and are managed with YouTube's own tools (YouTube Studio) by whoever owns that channel.
      </p>

      <h2 className="text-lg font-semibold text-white">5. Cookies &amp; Analytics</h2>
      <p>
        We and our partners use cookies and similar technologies to keep you signed in, remember preferences,
        measure usage, and (for free-tier users) deliver and measure ads. You can control cookies through your
        browser settings; disabling some cookies may affect functionality. Ad partners' cookies, and those set
        by the embedded YouTube player, are governed by their own privacy policies.
      </p>

      <h2 className="text-lg font-semibold text-white">6. Data Retention</h2>
      <p>
        We retain personal information for as long as your account is active and as needed to provide the
        Service. After account deletion, we remove or de-identify personal data within a reasonable period,
        except where we must retain certain records for legal, tax, accounting, fraud-prevention, or
        dispute-resolution purposes, or where content has already been shared publicly or with others. See the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link> page for details
        and timelines.
      </p>

      <h2 className="text-lg font-semibold text-white">7. Security</h2>
      <p>
        We use administrative, technical, and physical safeguards designed to protect your information,
        including encryption in transit and reliance on PCI-compliant processors for payments. No method of
        transmission or storage is completely secure, so we cannot guarantee absolute security.
      </p>

      <h2 className="text-lg font-semibold text-white">8. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not knowingly collect personal information
        from anyone under 13. Users must be at least 13 to hold an account, and at least 18 to make purchases
        or receive payouts. If you believe a child under 13 has provided us information, contact{' '}
        {SUPPORT_EMAIL} and we will delete it.
      </p>

      <h2 className="text-lg font-semibold text-white">9. Your Rights &amp; Choices</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or receive a copy of your
        personal information, and to object to or restrict certain processing. You can update much of your
        information in your account settings and control follow/notification preferences. We will not
        discriminate against you for exercising these rights.
      </p>

      <h2 className="text-lg font-semibold text-white">10. How to Request Deletion</h2>
      <p>
        You can delete your account and request your data at any time. See the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Account Deletion &amp; Data Request</Link>{' '}
        page for the in-app path and how to submit a request by email to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>. We will
        respond within the timeframe required by applicable law.
      </p>

      <h2 className="text-lg font-semibold text-white">11. International Users</h2>
      <p>
        The Service is operated from the United States. Your information may be processed in the United States
        and in other countries where we or our processors operate, and data-protection laws in those countries
        may differ from those where you live.
      </p>
      <p>
        Where we transfer personal information out of the European Economic Area, the United Kingdom, or
        Switzerland, we rely on an approved transfer mechanism — normally the European Commission's{' '}
        <strong className="text-white">Standard Contractual Clauses</strong>, together with the{' '}
        <strong className="text-white">UK International Data Transfer Addendum</strong> for UK transfers — plus
        additional technical and organizational safeguards such as encryption in transit and access controls.
        Our major processors (including Stripe and Google) maintain their own approved transfer mechanisms for
        the data they handle on our behalf. To request a copy of the safeguards that apply to your data, or to
        raise a question about an international transfer, contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>.
      </p>

      <h2 className="text-lg font-semibold text-white">12. Changes to This Policy</h2>
      <p>
        We may update this Policy from time to time. If we make material changes, we will provide notice (for
        example, in-app or by email). The "Last updated" date above reflects the latest revision.
      </p>

      <h2 className="text-lg font-semibold text-white">13. Contact</h2>
      <p>
        Questions or privacy requests? Contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>.
      </p>

      <div className="flex flex-wrap gap-4 pt-2 text-sm">
        <Link to="/terms" className="text-kunai hover:underline">Terms of Service</Link>
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link>
        <Link to="/" className="text-kunai hover:underline">← Home</Link>
      </div>
    </div>
  )
}
