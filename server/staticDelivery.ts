/**
 * Only client-side routes may fall through to the SPA shell.
 *
 * Returning index.html for a missing hashed asset is especially dangerous in a
 * PWA: the service worker can otherwise cache that HTML response under a
 * JavaScript URL and keep an installed client broken after the deploy finishes.
 */
export function shouldServeSpaShell(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0] || '/'
  if (path === '/api' || path.startsWith('/api/')) return false
  if (path === '/assets' || path.startsWith('/assets/')) return false

  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !/\.[a-z0-9]{1,16}$/i.test(lastSegment)
}
