import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { NinjaIcon, type NinjaIconName } from './NinjaIcon'

/**
 * Menu / Dropdown — a small, reusable popover of actions. Phone-first.
 *
 *   • `trigger` is any node; tapping it toggles the menu.
 *   • Items either `to` (navigate) or `onClick`. A `danger` item renders red.
 *   • Closes on outside click, Escape, item select, and route change.
 *
 *   <Menu
 *     trigger={<NinjaIcon name="more" size={22} />}
 *     items={[
 *       { id: 'edit', label: 'Edit', icon: 'scroll', onClick: edit },
 *       { id: 'del', label: 'Delete', danger: true, onClick: del },
 *     ]}
 *   />
 */

export type MenuItem = {
  id: string
  label: ReactNode
  icon?: NinjaIconName
  to?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}

export type MenuProps = {
  trigger: ReactNode
  items: MenuItem[]
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: 'left' | 'right'
  /** aria-label for the trigger button. */
  label?: string
  className?: string
  /** Extra classes on the trigger button. */
  triggerClassName?: string
}

export function Menu({
  trigger,
  items,
  align = 'right',
  label = 'Open menu',
  className = '',
  triggerClassName = '',
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const location = useLocation()

  // Close on route change.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemCls = (item: MenuItem) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-left transition-colors ${
      item.disabled
        ? 'text-gray-600 cursor-not-allowed'
        : item.danger
          ? 'text-kunai hover:bg-kunai/10'
          : 'text-gray-200 hover:bg-dark-elevated hover:text-white'
    }`

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-[75] mt-2 min-w-[11rem] rounded-xl border border-dark-border bg-dark-card p-1.5 shadow-2xl animate-fade-in ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item) => {
            const content = (
              <>
                {item.icon && <NinjaIcon name={item.icon} size={17} className="shrink-0" />}
                <span className="truncate">{item.label}</span>
              </>
            )
            if (item.to && !item.disabled) {
              return (
                <Link key={item.id} to={item.to} role="menuitem" className={itemCls(item)} onClick={() => setOpen(false)}>
                  {content}
                </Link>
              )
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { if (!item.disabled) { item.onClick?.(); setOpen(false) } }}
                className={itemCls(item)}
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Menu
