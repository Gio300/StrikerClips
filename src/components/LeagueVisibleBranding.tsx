import { useLayoutEffect } from 'react'
import { rewriteVisibleBrandText, type LeagueDisplayBrand } from '@/lib/displayBrand'

const VISIBLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt'] as const

function isExcluded(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement
  return Boolean(element?.closest('[data-tko-attribution], [data-user-content], script, style'))
}

/**
 * One compatibility bridge for legacy hard-coded UI copy. It changes only
 * rendered platform copy and accessibility labels while the SSL address is
 * active. User-authored zones opt out with `data-user-content`; React data,
 * user records, routes, and API strings remain untouched.
 */
export function LeagueVisibleBranding({ display }: { display: LeagueDisplayBrand }) {
  useLayoutEffect(() => {
    if (!display.isSsl || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

    const originalText = new Map<Text, string>()
    const originalAttributes = new Map<Element, Map<string, string>>()

    const rewriteText = (node: Text) => {
      if (isExcluded(node)) return
      const value = node.data
      const next = rewriteVisibleBrandText(value, display)
      if (next === value) return
      const previous = originalText.get(node)
      if (!previous || value !== rewriteVisibleBrandText(previous, display)) originalText.set(node, value)
      node.data = next
    }

    const rewriteAttribute = (element: Element, name: string) => {
      if (isExcluded(element)) return
      const value = element.getAttribute(name)
      if (!value) return
      const next = rewriteVisibleBrandText(value, display)
      if (next === value) return
      let originals = originalAttributes.get(element)
      if (!originals) {
        originals = new Map()
        originalAttributes.set(element, originals)
      }
      const previous = originals.get(name)
      if (!previous || value !== rewriteVisibleBrandText(previous, display)) originals.set(name, value)
      element.setAttribute(name, next)
    }

    const scan = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        rewriteText(root as Text)
        return
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
      if (root.nodeType === Node.ELEMENT_NODE) {
        const element = root as Element
        for (const name of VISIBLE_ATTRIBUTES) rewriteAttribute(element, name)
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      let current = walker.nextNode()
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) rewriteText(current as Text)
        else for (const name of VISIBLE_ATTRIBUTES) rewriteAttribute(current as Element, name)
        current = walker.nextNode()
      }
    }

    scan(document.body)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') rewriteText(mutation.target as Text)
        else if (mutation.type === 'attributes' && mutation.attributeName) {
          rewriteAttribute(mutation.target as Element, mutation.attributeName)
        } else {
          mutation.addedNodes.forEach(scan)
        }
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...VISIBLE_ATTRIBUTES],
    })

    return () => {
      observer.disconnect()
      for (const [node, original] of originalText) {
        if (node.isConnected && node.data === rewriteVisibleBrandText(original, display)) node.data = original
      }
      for (const [element, originals] of originalAttributes) {
        if (!element.isConnected) continue
        for (const [name, original] of originals) {
          if (element.getAttribute(name) === rewriteVisibleBrandText(original, display)) element.setAttribute(name, original)
        }
      }
    }
  }, [display])

  return null
}

/** The sole TKO mention permitted in the SSL app, shared by every route. */
export function LeagueBottomAttribution({ display }: { display: LeagueDisplayBrand }) {
  if (!display.isSsl) return null
  return (
    <div
      data-tko-attribution
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex justify-center pb-[max(2px,env(safe-area-inset-bottom))]"
    >
      <span className="rounded-t bg-black/70 px-1.5 py-0.5 text-[8px] leading-none text-gray-500">
        Powered by TKO.cam
      </span>
    </div>
  )
}
