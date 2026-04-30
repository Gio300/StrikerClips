import { Link } from 'react-router-dom'
import { BRAND } from '@/lib/brand'

/**
 * High-level terms surface for sign-up consent. Not a substitute for a lawyer
 * finalizing your Terms of Service, privacy policy, and DMCA process.
 */
export function Terms() {
  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 text-gray-300">
      <h1 className="text-2xl font-bold text-white">Terms (summary)</h1>
      <p className="text-sm text-gray-500">
        {BRAND.name} is for creators who own the rights to the gameplay they post. This summary supports the consent
        checkbox on sign-up.
      </p>
      <ol className="list-decimal list-inside space-y-3 text-sm leading-relaxed">
        <li>
          <strong className="text-white">You own (or have permission to use) your content.</strong> You’re responsible
          for clearing music, logos, and third-party IP in your sources.
        </li>
        <li>
          <strong className="text-white">License to operate {BRAND.name}.</strong> You grant {BRAND.name} a
          non-exclusive, worldwide, royalty-free license to host, process, re-encode, combine, display, share
          (including on the {BRAND.name} YouTube channel, when applicable), and promote the reels you build — so the
          product and monetization (ads) can work.
        </li>
        <li>
          <strong className="text-white">Platform rules.</strong> We may remove or disable content that violates
          YouTube, Twitch, or other platforms’ terms, the law, or this policy.
        </li>
        <li>
          <strong className="text-white">Social & invites.</strong> You won’t use invites or share links to harass,
          doxx, or spam. Tournament and clan features may add extra rules in-product.
        </li>
      </ol>
      <p className="text-xs text-gray-500">
        This is not legal advice. Replace and expand with counsel before launch, especially for minors, DMCA, and
        state privacy laws.
      </p>
      <Link to="/" className="text-kunai hover:underline text-sm font-medium">← Home</Link>
    </div>
  )
}
