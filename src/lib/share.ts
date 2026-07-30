/**
 * shareLink — share a URL using the native share sheet when available
 * (great on phones), falling back to copying the link to the clipboard.
 * Returns what happened so the UI can flash the right confirmation.
 */
export async function shareLink(opts: { title?: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url })
      return 'shared'
    } catch (e) {
      // User dismissed the share sheet — don't then silently copy.
      if ((e as Error)?.name === 'AbortError') return 'failed'
      // Otherwise fall through to clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(opts.url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
