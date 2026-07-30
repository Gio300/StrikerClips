import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export type BigMenuItem = {
  id: string
  icon: LucideIcon
  label: string
  sub?: string
  to?: string
  onSelect?: () => void
  primary?: boolean
}

type BigMenuProps = {
  items: BigMenuItem[]
  title?: string
  subtitle?: string
  onBack?: () => void
}

export function BigMenu({ items, title, subtitle, onBack }: BigMenuProps) {
  const navigate = useNavigate()

  return (
    <div className="animate-slide-up">
      {(title || onBack) && (
        <div className="mb-5 flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              title="Back"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border bg-dark-card text-gray-300 transition-colors hover:border-kunai/60 hover:text-white"
            >
              <ChevronLeft size={21} />
            </button>
          )}
          {title && (
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold md:text-3xl">{title}</h1>
              {subtitle && <p className="mt-0.5 text-sm text-gray-400">{subtitle}</p>}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const Icon = item.icon
          const handle = () => {
            if (item.onSelect) item.onSelect()
            else if (item.to) navigate(item.to)
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={handle}
              className={`group flex min-h-20 w-full items-center gap-4 rounded-lg border px-4 py-4 text-left transition-all active:scale-[0.99] sm:min-h-24 sm:px-5 ${
                item.primary
                  ? 'border-kunai/70 bg-kunai text-dark shadow-kunai hover:bg-kunai/90'
                  : 'border-dark-border bg-dark-card text-white hover:border-kunai/60 hover:bg-dark-elevated'
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border sm:h-12 sm:w-12 ${
                  item.primary
                    ? 'border-black/10 bg-black/10 text-dark'
                    : 'border-dark-border bg-dark-elevated text-kunai group-hover:border-kunai/30'
                }`}
                aria-hidden
              >
                <Icon size={23} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold leading-tight sm:text-xl">{item.label}</span>
                {item.sub && (
                  <span className={`mt-1 block text-sm leading-snug ${item.primary ? 'text-dark/75' : 'text-gray-400'}`}>
                    {item.sub}
                  </span>
                )}
              </span>
              <span className={`shrink-0 transition-colors ${item.primary ? 'text-dark/65' : 'text-gray-500 group-hover:text-kunai'}`}>
                <ChevronRight size={21} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
