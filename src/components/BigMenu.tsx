import { useNavigate } from 'react-router-dom'

// A single big, tall, full-width tappable choice.
// Provide EITHER `to` (navigate to a route) OR `onSelect` (drill into another
// BigMenu, handled by the parent's state).
export type BigMenuItem = {
  id: string
  icon: string          // emoji or short glyph — kept big and obvious
  label: string         // the one big word/phrase
  sub?: string          // one short line under it
  to?: string           // route to navigate to on tap
  onSelect?: () => void  // drill-down handler (slides to another BigMenu)
  primary?: boolean     // render with the orange gradient (main action)
}

type BigMenuProps = {
  items: BigMenuItem[]
  title?: string
  subtitle?: string
  onBack?: () => void  // when set, shows a big Back arrow at the top
}

/**
 * BigMenu — a vertical stack of large, tall, full-width tappable buttons.
 * Dead simple: icon + big label + one-line sub. No typing. Slides in on mount.
 * Each button either navigates to a route or drills to another BigMenu.
 */
export function BigMenu({ items, title, subtitle, onBack }: BigMenuProps) {
  const navigate = useNavigate()

  return (
    <div className="animate-slide-up">
      {(title || onBack) && (
        <div className="flex items-center gap-3 mb-6">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="shrink-0 w-11 h-11 rounded-xl border border-dark-border bg-dark-card flex items-center justify-center text-gray-300 hover:text-white hover:border-kunai/60 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {title && (
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold truncate">{title}</h1>
              {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
          )}
        </div>
      )}

      <div className="space-y-5">
        {items.map((item) => {
          const handle = () => {
            if (item.onSelect) item.onSelect()
            else if (item.to) navigate(item.to)
          }
          return (
            <button
              key={item.id}
              type="button"
              onClick={handle}
              className={`group w-full flex items-center gap-5 md:gap-6 text-left rounded-2xl px-6 md:px-9 py-8 md:py-11 border transition-all active:scale-[0.99] ${
                item.primary
                  ? 'bg-gradient-kunai text-dark border-transparent shadow-kunai hover:shadow-kunai-lg'
                  : 'bg-dark-card border-dark-border text-white hover:border-kunai/60 hover:bg-dark-elevated'
              }`}
            >
              <span
                className={`shrink-0 w-16 h-16 md:w-24 md:h-24 rounded-2xl flex items-center justify-center text-4xl md:text-6xl ${
                  item.primary ? 'bg-black/15' : 'bg-dark-elevated group-hover:bg-dark border border-dark-border'
                }`}
                aria-hidden
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xl md:text-4xl font-bold leading-tight">{item.label}</span>
                {item.sub && (
                  <span className={`block text-base md:text-xl mt-1.5 ${item.primary ? 'text-dark/80' : 'text-gray-400'}`}>
                    {item.sub}
                  </span>
                )}
              </span>
              <span className={`shrink-0 ${item.primary ? 'text-dark/70' : 'text-gray-500 group-hover:text-kunai'} transition-colors`}>
                <svg className="w-8 h-8 md:w-10 md:h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
