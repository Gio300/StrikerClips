import { useState } from 'react'

type ShareButtonsProps = {
  url?: string
  title?: string
  className?: string
}

/**
 * URL-based share to Facebook, Messenger, X, WhatsApp + native share + copy link.
 * No SDK keys required — just window.open with the share URL.
 *
 * For Messenger app deep link to actually work, end users must have the
 * Messenger app installed (mobile) or be signed into facebook.com (desktop).
 */
export function ShareButtons({ url, title, className = '' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false)
  const shareUrl = url ?? (typeof window !== 'undefined' ? window.location.href : '')
  const shareTitle = title?.trim() ? title : 'Check out this ReelOne reel'

  const enc = encodeURIComponent
  const fbAppId = import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined

  // If a Facebook App ID is configured we use the proper Messenger Send Dialog,
  // which works on desktop and mobile and respects FB's Share API. Without it,
  // we fall back to the fb-messenger:// deep link (mobile only).
  const messengerLink = fbAppId
    ? `https://www.facebook.com/dialog/send?app_id=${enc(fbAppId)}&link=${enc(shareUrl)}&redirect_uri=${enc(shareUrl)}`
    : `fb-messenger://share/?link=${enc(shareUrl)}`

  const links = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}${fbAppId ? `&app_id=${enc(fbAppId)}` : ''}`,
    messenger: messengerLink,
    x: `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(shareTitle)}`,
    whatsapp: `https://wa.me/?text=${enc(`${shareTitle} ${shareUrl}`)}`,
    reddit: `https://www.reddit.com/submit?url=${enc(shareUrl)}&title=${enc(shareTitle)}`,
  }

  function open(href: string) {
    window.open(href, '_blank', 'noopener,noreferrer,width=640,height=560')
  }

  async function nativeShare() {
    type Nav = Navigator & { share?: (data: { title?: string; url?: string }) => Promise<void> }
    const n = navigator as Nav
    if (n.share) {
      try {
        await n.share({ title: shareTitle, url: shareUrl })
      } catch { /* user cancelled */ }
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  type NavWithShare = Navigator & { share?: unknown }
  const hasNativeShare = typeof navigator !== 'undefined' && !!(navigator as NavWithShare).share

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {hasNativeShare && (
        <button
          type="button"
          onClick={nativeShare}
          className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-medium hover:opacity-90"
        >
          Share
        </button>
      )}
      <ShareIcon label="Facebook" onClick={() => open(links.facebook)} bg="bg-[#1877F2]" />
      <ShareIcon label="Messenger" onClick={() => open(links.messenger)} bg="bg-[#0084FF]" />
      <ShareIcon label="X" onClick={() => open(links.x)} bg="bg-black border border-dark-border" />
      <ShareIcon label="WhatsApp" onClick={() => open(links.whatsapp)} bg="bg-[#25D366]" />
      <ShareIcon label="Reddit" onClick={() => open(links.reddit)} bg="bg-[#FF4500]" />
      <button
        type="button"
        onClick={copyLink}
        className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

function ShareIcon({ label, onClick, bg }: { label: string; onClick: () => void; bg: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Share to ${label}`}
      className={`px-3 py-1.5 rounded-lg ${bg} text-white text-sm font-medium hover:opacity-90`}
    >
      {label}
    </button>
  )
}
