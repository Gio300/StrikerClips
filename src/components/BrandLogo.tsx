import { BRAND } from '@/lib/brand'

type BrandLogoProps = {
  className?: string
  as?: 'span' | 'h1'
}

export function BrandLogo({ className = '', as: Tag = 'span' }: BrandLogoProps) {
  return (
    <Tag className={`brand-gradient font-brand font-bold tracking-tight ${className}`}>
      {BRAND.name}
    </Tag>
  )
}
