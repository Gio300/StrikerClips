import { BRAND } from '@/lib/brand'

type BrandLogoProps = {
  className?: string
  as?: 'span' | 'h1'
}

/**
 * Wordmark: "Kill" in white + "Cam" in the KillCam gradient, matching the logo.
 */
export function BrandLogo({ className = '', as: Tag = 'span' }: BrandLogoProps) {
  const name = BRAND.name // "KillCam"
  const head = name.slice(0, 4) // Kill
  const tail = name.slice(4) // Cam
  return (
    <Tag className={`font-brand font-bold tracking-tight ${className}`}>
      <span className="text-white">{head}</span>
      <span className="brand-gradient">{tail}</span>
    </Tag>
  )
}

/** The KillCam viewfinder mark as an inline SVG (matches favicon.svg). */
export function BrandMark({ className = '', size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="kcmark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF3B1F" />
          <stop offset="0.55" stopColor="#FF7A18" />
          <stop offset="1" stopColor="#FFB800" />
        </linearGradient>
      </defs>
      <g stroke="url(#kcmark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 9 H9 V18" />
        <path d="M46 9 H55 V18" />
        <path d="M18 55 H9 V46" />
        <path d="M46 55 H55 V46" />
      </g>
      <path d="M42 22 A12 12 0 1 0 44 30" stroke="url(#kcmark)" strokeWidth="3.1" strokeLinecap="round" />
      <path d="M39 18 L45 22 L41 28 Z" fill="url(#kcmark)" />
      <g stroke="url(#kcmark)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M6 27 H15" />
        <path d="M4 32 H14" />
        <path d="M6 37 H15" />
      </g>
      <path d="M27 25 L27 39 L40 32 Z" fill="url(#kcmark)" />
    </svg>
  )
}
