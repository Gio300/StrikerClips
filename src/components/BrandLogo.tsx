type BrandLogoProps = {
  className?: string
  as?: 'span' | 'h1'
}

export function BrandLogo({ className = '', as: Tag = 'span' }: BrandLogoProps) {
  return (
    <Tag
      className={className}
      style={{
        background: 'linear-gradient(to right, #22c55e, #ef4444)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        fontFamily: "'Orbitron', sans-serif",
      }}
    >
      ButtonMasherz
    </Tag>
  )
}
