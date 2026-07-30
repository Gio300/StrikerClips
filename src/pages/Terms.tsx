import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'

/**
 * Terms of Service for {BRAND.name} ({BRAND.domain}).
 *
 * Published terms describing the Service's current operating rules.
 */
export function Terms() {
  const SUPPORT_EMAIL = 'awakengiovanni3000@gmail.com'
  const LAST_UPDATED = '2026-07-30'

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

      <h2 className="text-lg font-semibold text-white">8. Subscriptions &amp; Billing</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Paid subscription tiers and one-time purchases are processed through our payment processor, Stripe. We do not store your full card number.</li>
        <li><strong className="text-white">Auto-renewal.</strong> Subscriptions renew automatically at the then-current price for successive billing periods until you cancel. By subscribing, you authorize recurring charges.</li>
        <li><strong className="text-white">Cancellation.</strong> You may cancel at any time through your account settings or by contacting {SUPPORT_EMAIL}. Cancellation stops future renewals; access generally continues through the end of the paid period.</li>
        <li>Prices and features may change with notice. Applicable taxes may be added. Digital goods are generally non-refundable except as required by law or as stated at purchase.</li>
        <li>Before starting a subscription, we disclose its price, billing interval, renewal terms, and cancellation method. Required renewal reminders and notices are provided where applicable.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">9. Creator Payouts</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Eligible creators may earn revenue from features such as subscriptions, paid access, and tournament activity, paid out via Stripe Connect.</li>
        <li><strong className="text-white">Revenue split: 80% to the creator, 20% to {BRAND.name}</strong>, before payment-processing fees and any applicable taxes or reserves.</li>
        <li>Creators must complete Stripe Connect onboarding, including identity and banking verification, to receive funds, and must be at least 18.</li>
        <li><strong className="text-white">Taxes.</strong> Creators are solely responsible for reporting and paying all taxes on their earnings. Payouts may be reported to tax authorities and require applicable tax forms.</li>
        <li>We may withhold, delay, or reverse payouts pending verification, or in cases of suspected fraud, chargebacks, or violations of these Terms.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white">9A. Made-to-Order Physical Merchandise</h2>
      <ul className="list-disc list-inside space-y-1.5 text-sm leading-relaxed">
        <li>Physical Forge purchases are tangible, made-to-order products such as shirts. A physical purchase does not grant Tokens, digital content, app features, or any other digital entitlement.</li>
        <li>Product price, available sizes and colors, shipping charge, applicable tax, and the order total are shown before payment. Stripe processes payment, while Shopify and a manufacturing or print-fulfillment provider may be used to record, manufacture, ship, and track the order.</li>
        <li>Production and delivery estimates are estimates rather than guarantees. Tracking is shown when supplied by the fulfillment provider.</li>
        <li>Because products are made to order, returns for preference or sizing may be limited. Contact support promptly for an item that is defective, damaged, misprinted, or different from the confirmed order so we can investigate a replacement or refund as required by law.</li>
        <li>Creators may submit only artwork they own or are authorized to use. We may reject or remove a design, cancel an unfulfilled order, or withhold creator earnings when rights, safety, fraud, or print-quality concerns arise.</li>
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
        infringes your copyright, send a notice to {SUPPORT_EMAIL} including: (a) identification of the
        copyrighted work; (b) identification of the allegedly infringing material and its location; (c) your
        contact information; (d) a statement of good-faith belief that the use is not authorized; (e) a
        statement, under penalty of perjury, that the information is accurate and that you are authorized to
        act; and (f) your physical or electronic signature. We may remove infringing content, terminate
        repeat infringers, and process valid counter-notices where permitted.
      </p>

      <h2 className="text-lg font-semibold text-white">12. Disclaimers &amp; Warranties</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
        SECURE, OR THAT USER CONTENT OR PREDICTIONS WILL BE ACCURATE.
      </p>

      <h2 className="text-lg font-semibold text-white">13. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {BRAND.name.toUpperCase()} AND ITS AFFILIATES WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
        PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING FROM OR RELATING TO YOUR USE OF THE
        SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE GREATER OF THE AMOUNTS YOU PAID US IN
        THE 12 MONTHS BEFORE THE CLAIM OR US$100. THESE LIMITS DO NOT APPLY WHERE PROHIBITED BY LAW OR TO
        LIABILITIES THAT CANNOT LEGALLY BE LIMITED.
      </p>

      <h2 className="text-lg font-semibold text-white">14. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless {BRAND.name} and its affiliates, officers, and
        employees from any claims, damages, liabilities, and expenses (including reasonable attorneys' fees)
        arising from your User Content, your use of the Service, or your violation of these Terms or of any law
        or third-party right.
      </p>

      <h2 className="text-lg font-semibold text-white">15. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time (see the{' '}
        <Link to="/data-deletion" className="text-kunai hover:underline">Data Deletion</Link> page). We may
        suspend or terminate your access at any time for violations of these Terms, for legal reasons, or to
        protect the Service or its users. Provisions that by their nature should survive termination (including
        content licenses for already-distributed content, disclaimers, limitation of liability, indemnification,
        and dispute resolution) will survive.
      </p>

      <h2 className="text-lg font-semibold text-white">16. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes, we will provide notice (for
        example, in-app or by email). Your continued use of the Service after changes take effect constitutes
        acceptance of the revised Terms.
      </p>

      <h2 className="text-lg font-semibold text-white">17. Governing Law &amp; Disputes</h2>
      <p>
        These Terms are governed by applicable laws of the jurisdiction where the operator is established,
        without regard to conflict-of-laws rules. Before filing a claim, contact support and allow 30 days
        for informal resolution. If the dispute remains unresolved, claims may be brought in a court of
        competent jurisdiction. Nothing in these Terms limits mandatory consumer rights.
      </p>

      <h2 className="text-lg font-semibold text-white">18. Contact</h2>
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
