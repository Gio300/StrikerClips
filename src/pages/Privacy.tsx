import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'

/**
 * Privacy Policy for {BRAND.name} ({BRAND.domain}).
 *
 * Public privacy policy for the current TKO service and mobile applications.
 */
export function Privacy() {
  const SUPPORT_EMAIL = 'awakengiovanni3000@gmail.com'
  const LAST_UPDATED = '2026-07-30'

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
        <li><strong className="text-white">Physical-order information</strong> — when you order made-to-order merchandise, we collect the recipient name, email, shipping address, selected product and variant, order status, tracking information, and support history needed to manufacture, ship, and support the order.</li>
        <li><strong className="text-white">Communications</strong> — messages you send us, such as support requests.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">2. How We Use Information</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Operate, maintain, and improve the Service and its features (reels, live, clans, tournaments, and the Oracle prediction system).</li>
        <li>Create and secure your account, authenticate you, and prevent fraud, cheating, and abuse.</li>
        <li>Process subscriptions, Token purchases, physical merchandise orders, and creator payouts, and verify age and identity where required.</li>
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
        <li><strong className="text-white">Made-to-order fulfillment</strong> — Shopify and the selected manufacturer or print-fulfillment provider receive only the product, recipient, shipping, and order details needed to record, manufacture, ship, track, and support a physical order.</li>
        <li><strong className="text-white">Hosting &amp; backend</strong> — our cloud hosting and database/auth provider (e.g., Supabase).</li>
        <li><strong className="text-white">Ads &amp; analytics</strong> — advertising and analytics partners (e.g., Google AdSense / AdMob), which may set cookies or identifiers under their own policies.</li>
        <li><strong className="text-white">Video distribution</strong> — platforms such as YouTube where content is embedded or published.</li>
      </ul>
      <p>
        We may also disclose information when required by law, to protect rights and safety, or in connection
        with a merger, acquisition, or sale of assets. Content you post publicly (such as reels, streams, and
        public profile details) is visible to others.
      </p>

      <h2 className="text-lg font-semibold text-white">4. Cookies &amp; Analytics</h2>
      <p>
        We and our partners use cookies and similar technologies to keep you signed in, remember preferences,
        measure usage, and (for free-tier users) deliver and measure ads. You can control cookies through your
        browser settings; disabling some cookies may affect functionality. Ad partners' cookies are governed
        by their own privacy policies.
      </p>

      <h2 className="text-lg font-semibold text-white">5. Data Retention</h2>
      <p>
        We retain personal information for as long as your account is active and as needed to provide the
        Service. After account deletion, we remove or de-identify personal data within a reasonable period,
        except where we must retain certain records for legal, tax, accounting, fraud-prevention, or
        dispute-resolution purposes, or where content has already been shared publicly or with others. See the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link> page for details
        and timelines.
      </p>

      <h2 className="text-lg font-semibold text-white">6. Security</h2>
      <p>
        We use administrative, technical, and physical safeguards designed to protect your information,
        including encryption in transit and reliance on PCI-compliant processors for payments. No method of
        transmission or storage is completely secure, so we cannot guarantee absolute security.
      </p>

      <h2 className="text-lg font-semibold text-white">7. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not knowingly collect personal information
        from anyone under 13. Users must be at least 13 to hold an account, and at least 18 to make purchases
        or receive payouts. If you believe a child under 13 has provided us information, contact{' '}
        {SUPPORT_EMAIL} and we will delete it.
      </p>

      <h2 className="text-lg font-semibold text-white">8. Your Rights &amp; Choices</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or receive a copy of your
        personal information, and to object to or restrict certain processing. You can update much of your
        information in your account settings and control follow/notification preferences.
      </p>

      <h2 className="text-lg font-semibold text-white">9. How to Request Deletion</h2>
      <p>
        You can delete your account and request your data at any time. See the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Account Deletion &amp; Data Request</Link>{' '}
        page for the in-app path and how to submit a request by email to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>. We will
        respond within the timeframe required by applicable law.
      </p>

      <h2 className="text-lg font-semibold text-white">10. International Users</h2>
      <p>
        The Service is operated from, and your information may be processed in, the United States and other
        countries where we or our processors operate. Data-protection laws in these countries may differ from
        those in your jurisdiction. Where required, we use legally recognized safeguards for international
        transfers and honor applicable data-protection rights.
      </p>

      <h2 className="text-lg font-semibold text-white">11. Changes to This Policy</h2>
      <p>
        We may update this Policy from time to time. If we make material changes, we will provide notice (for
        example, in-app or by email). The "Last updated" date above reflects the latest revision.
      </p>

      <h2 className="text-lg font-semibold text-white">12. Contact</h2>
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
