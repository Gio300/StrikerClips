import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'

/**
 * Terms of Service for {BRAND.name} ({BRAND.domain}).
 *
 * Live, published agreement — keep it accurate. Section 8 quotes the real
 * subscription tiers and prices (mirror of the TIERS table in src/pages/
 * Upgrade.tsx and the trial rules in src/lib/trial.ts): if pricing, the trial,
 * or the cancellation path changes, change this page in the same commit and bump
 * LAST_UPDATED. Section 12 covers the third-party platforms the product depends
 * on (YouTube, Stripe); section 18 is the dispute-resolution clause.
 */
export function Terms() {
  const SUPPORT_EMAIL = 'awakengiovanni3000@gmail.com'
  const LAST_UPDATED = '2026-08-04'

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 text-gray-300 space-y-4">
      <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
      <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms of Service ("Terms") govern your access to and use of {BRAND.name} ({BRAND.domain}), a
        competitive gaming platform for Shinobi Striker, including our website, applications, and related
        services (collectively, the "Service"), operated by {BRAND.name} ("we," "us," or "our"). By creating
        an account or otherwise using the Service, you agree to these Terms and our{' '}
        <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link>. If you do not agree,
        do not use the Service.
      </p>

      <p className="rounded-lg border border-kunai/40 bg-kunai/10 p-4 text-sm text-gray-200">
        <strong className="text-white">Please read section 18.</strong> It requires most disputes to be
        resolved by <strong className="text-white">binding individual arbitration</strong> instead of in court,
        and waives class actions. You can opt out of arbitration within 30 days of first accepting these Terms
        — section 18.5 explains how.
      </p>

      <h2 className="text-lg font-semibold text-white">1. Acceptance of Terms</h2>
      <p>
        By accessing or using the Service, you confirm that you have read, understood, and agree to be bound
        by these Terms and all policies referenced in them. If you use the Service on behalf of an
        organization, you represent that you are authorized to bind that organization to these Terms.
      </p>

      <h2 className="text-lg font-semibold text-white">2. Eligibility &amp; Age</h2>
      <p>
        You must be at least 13 years old to create an account or use the Service. You must be at least 18
        years old (or the age of majority in your jurisdiction) to make any purchase, subscribe to a paid
        tier, buy or spend Tokens, or receive any creator payout. If you are between 13 and 18, you may only
        use the Service with the involvement and consent of a parent or legal guardian, and you may not make
        purchases or receive payouts. We may require age or identity verification and may refuse or revoke
        access where eligibility cannot be confirmed.
      </p>

      <h2 className="text-lg font-semibold text-white">3. Accounts &amp; Your Responsibilities</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Provide accurate, current information and keep it up to date.</li>
        <li>You are responsible for safeguarding your login credentials and for all activity under your account.</li>
        <li>One account per person unless we expressly permit otherwise. Do not share, sell, or transfer your account.</li>
        <li>Notify us promptly at {SUPPORT_EMAIL} of any unauthorized use or security breach.</li>
        <li>We may suspend or terminate accounts that violate these Terms or that we reasonably believe pose a risk to the Service or other users.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">4. Content &amp; Who Owns What</h2>
      <p>
        There are two kinds of video on the Service, and they are owned differently. In plain language:
      </p>

      <h3 className="text-base font-semibold text-white pt-1">
        4.1 Video you upload — shared ownership with {BRAND.name}
      </h3>
      <p>
        When you upload a video, clip, or other material to the Service ("Your Content"), you and{' '}
        {BRAND.name} own it <strong className="text-white">together</strong>. By uploading, you grant{' '}
        {BRAND.name} <strong className="text-white">partial ownership</strong> — an undivided joint ownership
        interest — in that upload, along with the right to{' '}
        <strong className="text-white">apply {BRAND.name} branding</strong> to it (our logo, watermark,
        overlays, intros, and outros).
      </p>
      <p>
        You keep your own ownership share. That means you can still post, sell, or use your video anywhere
        else you like, and you do not need our permission to do so. As a joint owner, {BRAND.name} may host,
        store, copy, re-encode, edit, brand, combine with other footage, publish, display, perform,
        distribute, and promote your upload — on the Service, on {BRAND.name}-operated channels, and in
        marketing — without owing you a payment for it. This continues for anything already published or
        shared, even after you delete your account; see the{' '}
        <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link> and{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link> page.
      </p>
      <p>
        You promise that you actually have the rights to upload what you upload and to grant us this
        ownership share — including clearing any music, logos, trademarks, gameplay footage, and other
        third-party material in your sources.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">
        4.2 Content our system produces — owned by {BRAND.name}
      </h3>
      <p>
        Anything the {BRAND.name} system creates, assembles, directs, or broadcasts is{' '}
        <strong className="text-white">owned and controlled by {BRAND.name}</strong>. That includes, for
        example:
      </p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li><strong className="text-white">Combined multi-angle reels</strong> our tools cut together from several players' footage.</li>
        <li><strong className="text-white">Live streams</strong> we produce, direct, or host.</li>
        <li><strong className="text-white">Tournament broadcasts</strong>, including TKO King battles, brackets, and highlight programs.</li>
        <li>Any other program, edit, overlay, or production output generated by our system.</li>
      </ul>
      <p>
        These productions are <strong className="text-white">always {BRAND.name}-branded</strong>, are
        published to <strong className="text-white">{BRAND.name}'s YouTube channel</strong>, and are played
        back inside the app as <strong className="text-white">YouTube embeds</strong>. Appearing in one — as
        a player, streamer, or source of footage — does not give you ownership of the production, a right to
        remove it, or a right to a payment for it, except where a separate written agreement (such as a
        creator payout program) says otherwise.
      </p>
      <p>
        You can of course keep and use your own original footage, which is governed by section 4.1. What you
        cannot do is claim ownership of, re-upload as your own, or commercially redistribute our finished
        productions without our written permission.
      </p>

      <h2 className="text-lg font-semibold text-white">5. Prohibited Content &amp; Conduct</h2>
      <p>You agree not to upload, post, or engage in:</p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Content that is illegal, infringing, defamatory, obscene, or that sexualizes minors.</li>
        <li>Harassment, hate speech, threats, doxxing, impersonation, or spam.</li>
        <li>Cheating, exploiting, match manipulation, or manipulation of predictions, rankings, or stat-checks.</li>
        <li>Malware, scraping, reverse engineering, or interfering with the Service's operation or security.</li>
        <li>Circumventing age, eligibility, or access controls, or using the Service for any unlawful purpose.</li>
      </ul>
      <p>
        We may remove or disable content, and suspend or terminate accounts, that violate these rules, the
        law, or the terms of any third-party platform (such as YouTube or Twitch) on which content is
        distributed. Tournament, clan, and community features may impose additional rules in-product.
      </p>

      <h2 className="text-lg font-semibold text-white">6. Oracle Predictions (Entertainment &amp; Prestige Only)</h2>
      <p>
        The Service includes an "Oracle" prediction system in which users <strong className="text-white">guess</strong>{' '}
        the outcomes of tournaments and matches. The Oracle system is offered strictly for entertainment,
        engagement, and prestige.
      </p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li><strong className="text-white">No wagering.</strong> You never risk money, Tokens, or anything of monetary value to make a prediction.</li>
        <li><strong className="text-white">No cash prizes.</strong> Correct predictions earn only cosmetic digital assets and prestige badges. There are no cash prizes and no cash payouts of any kind for predictions.</li>
        <li><strong className="text-white">Not gambling.</strong> Because there is no consideration risked and no monetary prize, the Oracle system is not gambling, betting, or a sweepstakes, and confers no cash or cash-equivalent value.</li>
        <li>Cosmetic assets and badges earned through predictions have no cash value, cannot be redeemed for cash, and are non-transferable except as we may permit in-product.</li>
        <li>We may correct, cancel, or void predictions or awarded items affected by error, bug, fraud, cheating, or technical failure.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">7. Tokens (Non-Cashable Utility Currency)</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Tokens are a utility currency you may purchase to unlock or use features and cosmetics within the Service.</li>
        <li><strong className="text-white">Tokens are not money and have no cash value.</strong> They can never be redeemed, exchanged, transferred, or withdrawn for cash or anything of monetary value.</li>
        <li>Tokens are non-refundable except where required by law, and are for personal, non-commercial use within the Service only.</li>
        <li>We may adjust Token pricing, availability, and the features Tokens unlock. Tokens may be forfeited on account termination for cause.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">8. Subscriptions, Auto-Renewal &amp; Billing</h2>
      <p>
        Paid subscription tiers and one-time purchases are processed through our payment processor, Stripe. We
        do not store your full card number. Prices are in U.S. dollars and exclude any applicable taxes, which
        may be added at checkout.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">8.1 The plans</h3>
      <p className="text-sm leading-relaxed">
        As of the "Last updated" date above, the monthly subscription tiers available to buy are{' '}
        <strong className="text-white">Pro ($4.99/month)</strong>,{' '}
        <strong className="text-white">Elite ($9.99/month)</strong>, and{' '}
        <strong className="text-white">Legend ($29.99/month)</strong>. A free tier is always available. The
        price that applies to you is always shown on the upgrade screen and again at checkout before you
        confirm, and that displayed price controls.
      </p>
      <p className="text-sm leading-relaxed">
        <strong className="text-white">Retired plan — Ad-Free ($1.99/month).</strong> This tier is no longer
        offered to new subscribers. If you already subscribe to it, nothing changes: your plan continues at
        the same price with the same benefits and the same automatic renewal described below, until you
        cancel it. You can see and cancel it at any time from the upgrade screen or the billing portal. We
        will not move you to a different tier or a different price without telling you first and giving you
        the chance to cancel.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">8.2 Automatic renewal — what you are agreeing to</h3>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          <strong className="text-white">Your subscription renews by itself.</strong> When you subscribe, you
          authorize us and Stripe to charge your payment method the then-current price for your tier{' '}
          <strong className="text-white">every month, automatically, until you cancel</strong>. There is no
          fixed end date and no separate reminder is required before each ordinary monthly charge.
        </li>
        <li>
          <strong className="text-white">Billing date.</strong> Each renewal is charged on the monthly
          anniversary of the day you subscribed. If that day does not exist in a given month, the charge falls
          on the last day of that month.
        </li>
        <li>
          <strong className="text-white">Free trials convert to paid.</strong> A free trial runs for{' '}
          <strong className="text-white">7 days</strong>. If you have a payment method on file when it ends,
          the trial <strong className="text-white">automatically becomes a paid monthly subscription</strong>{' '}
          at your tier's then-current price and you will be charged. If you have no payment method on file,
          the trial simply ends and your account returns to the free tier. You can decline or cancel at any
          point during the trial and you will not be charged.
        </li>
        <li>
          <strong className="text-white">Price changes.</strong> We will give you at least{' '}
          <strong className="text-white">30 days' notice</strong> by email or in-app before any price increase
          takes effect on your plan. You can cancel before it applies; continuing past the effective date is
          acceptance of the new price.
        </li>
        <li>
          <strong className="text-white">Failed payments.</strong> If a renewal charge fails, we may retry it
          and may suspend paid features until payment succeeds.
        </li>
      </ul>

      <h3 className="text-base font-semibold text-white pt-1">8.3 How to cancel</h3>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          <strong className="text-white">Cancel a paid subscription yourself, in the app, at any time.</strong>{' '}
          Open <Link to="/upgrade" className="text-kunai hover:underline">Memberships</Link> — or the{' '}
          <strong className="text-white">Billing</strong> section of your{' '}
          <Link to="/profile" className="text-kunai hover:underline">profile</Link> — and press{' '}
          <strong className="text-white">"Manage or cancel subscription"</strong>. That opens your secure
          Stripe billing page, where you can cancel in a couple of clicks, change your payment method, or
          download past invoices. The cancellation takes effect immediately in our records when Stripe
          confirms it.
        </li>
        <li>
          <strong className="text-white">No hoops.</strong> You do not have to give a reason, email us, call
          anyone, or sit through a retention offer. Cancelling takes no more steps than subscribing did.
        </li>
        <li>
          <strong className="text-white">During a free trial</strong>, you can end the trial the same way, or
          from the trial banner on the upgrade screen. Your account returns to the free tier and you are not
          charged.
        </li>
        <li>
          Cancel at least <strong className="text-white">24 hours before</strong> your next renewal date to
          avoid being charged for the following month.
        </li>
        <li>
          <strong className="text-white">If you cannot reach the app</strong> — for example you have lost
          access to your account — email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Cancel%20Subscription`} className="text-kunai hover:underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          from the address on your account with the subject "Cancel Subscription" and we will action it
          promptly once we have verified the account. This is a backup route, not the required one.
        </li>
        <li>
          Cancelling stops future renewals. It does not end your current billing period —{' '}
          <strong className="text-white">you keep the tier you paid for until that period runs out</strong>.
        </li>
        <li>
          Charges already made are non-refundable except where required by law or where we say otherwise at
          the time of purchase. Digital goods, Tokens, and cosmetic items are non-refundable once delivered,
          except where required by law.
        </li>
      </ul>
      <p className="text-sm leading-relaxed">
        Some states and countries give subscribers extra automatic-renewal rights — for example the right to
        cancel online in the same way you signed up, advance notice of renewal, or a cooling-off period. Those
        rights apply to you in addition to this section wherever the law grants them, and nothing here limits
        them.
      </p>

      <h2 className="text-lg font-semibold text-white">9. Creator Payouts</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Eligible creators may earn revenue from features such as subscriptions, paid access, and tournament activity, paid out via Stripe Connect.</li>
        <li><strong className="text-white">Revenue split: 80% to the creator, 20% to {BRAND.name}</strong>, before payment-processing fees and any applicable taxes or reserves.</li>
        <li>Creators must complete Stripe Connect onboarding, including identity and banking verification, to receive funds, and must be at least 18.</li>
        <li><strong className="text-white">Taxes.</strong> Creators are solely responsible for reporting and paying all taxes on their earnings. Payouts may be reported to tax authorities and require applicable tax forms.</li>
        <li>We may withhold, delay, or reverse payouts pending verification, or in cases of suspected fraud, chargebacks, or violations of these Terms.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">10. Intellectual Property</h2>
      <p>
        The Service, including its software, design, logos, trademarks, and content we provide (excluding User
        Content), is owned by {BRAND.name} or its licensors and is protected by intellectual-property laws.
        We grant you a limited, revocable, non-exclusive, non-transferable license to use the Service for its
        intended purpose, subject to these Terms. "Shinobi Striker" and related marks are the property of their
        respective owners; {BRAND.name} is an independent, unaffiliated community platform.
      </p>
      <p>
        Ownership of video specifically is covered in section 4: uploads are jointly owned by you and{' '}
        {BRAND.name} (section 4.1), and anything our system produces — combined reels, live streams, and
        tournament broadcasts — is owned by {BRAND.name} (section 4.2).
      </p>

      <h2 className="text-lg font-semibold text-white">11. Copyright &amp; DMCA / Takedown</h2>
      <p>
        We respect intellectual-property rights and respond to notices of alleged infringement under the
        Digital Millennium Copyright Act (DMCA) and similar laws. If you believe content on the Service
        infringes your copyright, send a notice to our designated copyright agent including: (a) identification
        of the copyrighted work; (b) identification of the allegedly infringing material and its location;
        (c) your contact information; (d) a statement of good-faith belief that the use is not authorized;
        (e) a statement, under penalty of perjury, that the information is accurate and that you are authorized
        to act; and (f) your physical or electronic signature.
      </p>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-relaxed">
        <strong className="text-white">Designated copyright agent</strong>
        <br />
        Copyright Agent, {BRAND.name} ({BRAND.domain})
        <br />
        Email:{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=DMCA%20Notice`} className="text-kunai hover:underline">
          {SUPPORT_EMAIL}
        </a>{' '}
        (subject line: "DMCA Notice")
        <br />
        <span className="text-gray-400">
          A mailing address for service of notices is available on request at the same address.
        </span>
      </div>
      <p>
        We may remove or disable access to material that is the subject of a valid notice, and we terminate
        the accounts of repeat infringers. If your content was removed and you believe that was a mistake or a
        misidentification, you may send a counter-notice to the same agent with the information the DMCA
        requires, and we will handle it under the statutory process. Please note that knowingly making a
        material misrepresentation in a notice or counter-notice can make you liable for damages.
      </p>

      <h2 className="text-lg font-semibold text-white">12. Third-Party Platforms (YouTube, Stripe)</h2>
      <p>
        Parts of the Service depend on platforms we do not control, and your use of those parts is also
        governed by their terms.
      </p>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          <strong className="text-white">YouTube.</strong> {BRAND.name} uses YouTube API Services to publish,
          list, and play back video. By using those features you also agree to the{' '}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kunai hover:underline"
          >
            YouTube Terms of Service
          </a>
          , and information Google handles is governed by the{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kunai hover:underline"
          >
            Google Privacy Policy
          </a>
          . You can revoke {BRAND.name}'s access to your YouTube account at any time at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kunai hover:underline"
          >
            https://myaccount.google.com/permissions
          </a>
          . What we access and store is described in section 4 of our{' '}
          <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link>.
        </li>
        <li>
          <strong className="text-white">Stripe.</strong> Payments, identity verification, and creator payouts
          are handled by Stripe under Stripe's own terms and privacy policy.
        </li>
        <li>
          YouTube, Google, and Stripe are not parties to these Terms and are not responsible for the Service.
          If a third-party platform changes, restricts, or removes access to its services, features that
          depend on it may change or stop working.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-white">13. Disclaimers &amp; Warranties</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
        SECURE, OR THAT USER CONTENT OR PREDICTIONS WILL BE ACCURATE. Some jurisdictions do not allow the
        exclusion of certain warranties, so parts of this section may not apply to you.
      </p>

      <h2 className="text-lg font-semibold text-white">14. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {BRAND.name.toUpperCase()} AND ITS AFFILIATES WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
        PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING FROM OR RELATING TO YOUR USE OF THE
        SERVICE. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF
        (a) THE TOTAL AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR
        (b) US$100.
      </p>
      <p className="text-sm leading-relaxed">
        These limits do not apply to liability that cannot be limited by law — for example fraud or fraudulent
        misrepresentation, death or personal injury caused by negligence, or our gross negligence or willful
        misconduct. Some jurisdictions do not allow certain limitations of liability, so parts of this section
        may not apply to you; in that case our liability is limited to the smallest extent permitted by law.
      </p>

      <h2 className="text-lg font-semibold text-white">15. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless {BRAND.name} and its affiliates, officers, and
        employees from any claims, damages, liabilities, and expenses (including reasonable attorneys' fees)
        arising from your User Content, your use of the Service, or your violation of these Terms or of any law
        or third-party right.
      </p>

      <h2 className="text-lg font-semibold text-white">16. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time (see the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link> page). We may
        suspend or terminate your access at any time for violations of these Terms, for legal reasons, or to
        protect the Service or its users. Provisions that by their nature should survive termination (including
        content licenses for already-distributed content, disclaimers, limitation of liability, indemnification,
        and dispute resolution) will survive.
      </p>

      <h2 className="text-lg font-semibold text-white">17. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes, we will provide notice (for
        example, in-app or by email). Your continued use of the Service after changes take effect constitutes
        acceptance of the revised Terms.
      </p>

      <h2 className="text-lg font-semibold text-white">18. Governing Law &amp; Dispute Resolution</h2>

      <h3 className="text-base font-semibold text-white pt-1">18.1 Governing law</h3>
      <p>
        These Terms and any dispute arising out of them or the Service are governed by the laws of the{' '}
        <strong className="text-white">State of Arizona</strong>, United States, without regard to its
        conflict-of-laws rules, and by applicable U.S. federal law (including the Federal Arbitration Act).
        This choice of law does not deprive you of the protection of any mandatory consumer-protection law of
        the place where you live.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.2 Talk to us first</h3>
      <p>
        Most problems can be sorted out quickly. Before starting arbitration or a lawsuit, you agree to email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Dispute%20Notice`} className="text-kunai hover:underline">
          {SUPPORT_EMAIL}
        </a>{' '}
        with a short description of the dispute and the relief you want, and to give us{' '}
        <strong className="text-white">30 days</strong> to try to resolve it informally. We will do the same
        before bringing a claim against you.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.3 Binding individual arbitration</h3>
      <p>
        If we cannot resolve it informally, you and {BRAND.name} agree that any dispute arising out of or
        relating to these Terms or the Service will be resolved by{' '}
        <strong className="text-white">binding individual arbitration</strong> administered by the American
        Arbitration Association (AAA) under its Consumer Arbitration Rules, and not in court. The arbitrator
        decides the dispute and can award the same individual relief a court could. Arbitration is less formal
        than a lawsuit: there is no judge or jury, and review is limited. The arbitration will take place in{' '}
        <strong className="text-white">Maricopa County, Arizona</strong>, or — at your choice — by telephone,
        by video, or on written submissions only. Where AAA's rules make us responsible for filing and
        arbitrator fees for consumer claims, we will pay them.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.4 Small claims &amp; other carve-outs</h3>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>
          <strong className="text-white">Small-claims court is always open.</strong> Either of us may bring an
          individual claim in a small-claims court with jurisdiction instead of arbitrating, and doing so is
          not a breach of this section.
        </li>
        <li>
          Either of us may ask a court for temporary or preliminary injunctive relief to stop infringement or
          misuse of intellectual property or unauthorized access to the Service.
        </li>
        <li>
          Nothing here prevents you from reporting a matter to a government agency or regulator.
        </li>
      </ul>

      <h3 className="text-base font-semibold text-white pt-1">18.5 Your 30-day right to opt out of arbitration</h3>
      <p>
        <strong className="text-white">You can opt out.</strong> Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Arbitration%20Opt-Out`} className="text-kunai hover:underline">
          {SUPPORT_EMAIL}
        </a>{' '}
        with the subject "Arbitration Opt-Out", your name, and the email on your account, within{' '}
        <strong className="text-white">30 days</strong> of the date you first accepted these Terms (or first
        accepted a version containing this clause). That is all it takes — opting out costs nothing, does not
        affect your account or your use of the Service, and means sections 18.3 and 18.6 do not apply to you.
        If you opt out, disputes are resolved in the courts described in section 18.7.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.6 No class actions</h3>
      <p>
        Disputes must be brought <strong className="text-white">on an individual basis only</strong>. You and{' '}
        {BRAND.name} each waive any right to bring or participate in a class, collective, consolidated, or
        representative action, and the arbitrator may not consolidate more than one person's claims. If this
        waiver is found unenforceable as to a particular claim, that claim (and only that claim) will proceed
        in court under section 18.7 while the rest of this section still applies.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.7 Court venue</h3>
      <p>
        For any dispute not subject to arbitration — including small-claims matters, requests for injunctive
        relief, and claims by anyone who has opted out — you and {BRAND.name} agree to the exclusive
        jurisdiction and venue of the state and federal courts located in{' '}
        <strong className="text-white">Maricopa County, Arizona</strong>, and each of us consents to personal
        jurisdiction there.
      </p>

      <h3 className="text-base font-semibold text-white pt-1">18.8 Severability &amp; survival</h3>
      <p>
        If any part of these Terms is held unenforceable, the rest stays in effect. Section 18 survives
        termination of your account and of these Terms.
      </p>

      <h2 className="text-lg font-semibold text-white">19. Contact</h2>
      <p>
        Questions about these Terms? Contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-kunai hover:underline">{SUPPORT_EMAIL}</a>.
      </p>

      <div className="flex flex-wrap gap-4 pt-2 text-sm">
        <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link>
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link>
        <Link to="/" className="text-kunai hover:underline">← Home</Link>
      </div>
    </div>
  )
}
