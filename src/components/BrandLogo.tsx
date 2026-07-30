import { BRAND } from '@/lib/brand'

type BrandLogoVariant = 'horizontal' | 'mark' | 'icon'

type BrandLogoProps = {
  className?: string
  as?: 'span' | 'h1'
  variant?: BrandLogoVariant
}

/**
 * Product-shell lockup. Campaign raster assets stay available for exports,
 * while this code-native mark remains sharp in compact navigation.
 */
export function BrandLogo({ className = '', as: Tag = 'span', variant = 'horizontal' }: BrandLogoProps) {
  const markOnly = variant === 'mark'
  const iconOnly = variant === 'icon'

  return (
    <Tag
      className={`inline-flex select-none items-center ${markOnly ? 'flex-col gap-3' : 'gap-2.5'} ${className}`}
      aria-label={BRAND.domain}
    >
      <svg
        viewBox="0 0 40 40"
        role="img"
        aria-hidden="true"
        className={markOnly ? 'h-[1.55em] w-[1.55em]' : 'h-[1.8em] w-[1.8em] shrink-0'}
      >
        <path
          d="M4 13V6h7M29 6h7v7M36 27v7h-7M11 34H4v-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="20" cy="20" r="10" fill="#ff5b3d" />
        <path d="M17 14.8 26 20l-9 5.2Z" fill="white" />
        <path d="M8 37h24" stroke="#2ed3dc" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {!iconOnly && (
        <span className={`font-brand font-bold leading-none ${markOnly ? 'text-[0.72em]' : 'text-[1em]'}`}>
          <span className="text-white">TKO</span>
          <span className="text-kunai">.cam</span>
        </span>
      )}
    </Tag>
  )
}
