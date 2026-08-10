/**
 * The conspicuous legal-link row: Privacy Policy · Terms of Service ·
 * Data Deletion.
 *
 * WHY (compliance, 2026-08-04): Google's YouTube API Developer Policies
 * require a *conspicuous* link to the privacy policy on the surface a visitor
 * lands on, and the API-audit submission is a screenshot of the homepage
 * showing it. The pages themselves already existed and already served 200
 * (/privacy, /terms, /data-deletion in src/App.tsx) — but nothing on the
 * signed-out ROOT linked to them. An audit crawl of https://tko.cam/ found 39
 * links and zero legal ones, because `/` redirects a signed-out visitor to the
 * league gateway (src/lib/leagueDomain.ts → signedOutLandingPath), whose
 * footer only carried the "powered by" line.
 *
 * So the rule this module exists to hold: every surface a signed-out visitor
 * can land on at `/` — the gateway on tko.cam, the league-branded login on a
 * league's own domain, the launcher once signed in, and the standalone
 * marketing bundle — renders these links plainly. Not inside a menu, not
 * behind auth.
 *
 * PLAIN <a href>, NOT react-router <Link>, on purpose:
 *   • This renders in BOTH the routed app bundle and the ROUTER-LESS marketing
 *     bundle (src/site-main.tsx mounts <Marketing/> with no <BrowserRouter>),
 *     where a <Link> throws.
 *   • `hrefFor` lets that marketing bundle aim the same row at the deployed app
 *     origin (Marketing's appHref) when it is hosted separately from the app.
 * A full page load on a legal page is a fine trade for markup that a crawler,
 * an auditor and a screenshot all read the same way.
 *
 * COLOR rides the surface-aware INK slots (src/lib/leagueTheme.ts) rather than
 * hardcoded grays, so the row is WCAG-AA on the light TKO_NEUTRAL board, on the
 * dark app chrome, AND on a league's own skin — leagueThemeVars derives
 * `--league-ink` / `--league-ink-muted` from the active background's luminance,
 * so no league palette can render this illegible. Underlined ink (not the
 * accent hue) keeps it unambiguously a link without depending on a league's
 * secondary color clearing contrast.
 */

/** The links, in the order they render. One source of truth for the tests. */
export const LEGAL_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/data-deletion', label: 'Data Deletion' },
]

export type LegalLinksProps = {
  /** Extra classes on the <nav> (spacing at the call site). */
  className?: string
  /**
   * Map a legal path to the href to actually emit. Defaults to identity —
   * the app serves these routes on its own origin. The marketing bundle
   * passes its `appHref` so the row points at the deployed app.
   */
  hrefFor?: (path: string) => string
}

/**
 * The bare link row — for surfaces that ALREADY have a <footer> (the league
 * gateway, the marketing page). Nesting a second <footer> inside one would be
 * invalid, so those call sites drop this in instead.
 */
export function LegalLinks({ className = '', hrefFor = (p) => p }: LegalLinksProps) {
  return (
    <nav
      aria-label="Legal"
      className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs ${className}`}
    >
      {LEGAL_LINKS.map((link) => (
        <a
          key={link.href}
          href={hrefFor(link.href)}
          className="text-ink underline underline-offset-2 hover:text-accent"
        >
          {link.label}
        </a>
      ))}
    </nav>
  )
}

/**
 * The whole footer — for surfaces with no footer of their own (login, signup,
 * the signed-in launcher). Hairline rule above, muted band, links centered.
 */
export function LegalFooter({ className = '', hrefFor }: LegalLinksProps) {
  return (
    <footer
      className={`border-t border-dark-border px-4 py-6 text-ink-muted ${className}`}
    >
      <LegalLinks hrefFor={hrefFor} />
    </footer>
  )
}
