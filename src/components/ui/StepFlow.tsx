import { Children, isValidElement, cloneElement, useState, type ReactNode, type ReactElement } from 'react'
import { NinjaIcon } from './NinjaIcon'

/**
 * StepFlow / Step — a guided, numbered task layout.
 *
 * Drop <Step> children inside <StepFlow>. REQUIRED steps render in order with a
 * numbered chakra badge that flips to a check when the step marks itself
 * `complete`. OPTIONAL steps DON'T take a number and DON'T show up-front — they
 * collapse behind a "+ Add …" reveal that slides open on tap, so a 4-step task
 * shows only what's needed and the nice-to-haves stay out of the way until
 * wanted.
 *
 *   <StepFlow>
 *     <Step title="Stream link" complete={!!url}>…</Step>
 *     <Step title="Placement" complete={!!placement}>…</Step>
 *     <Step title="Title" optional addLabel="Add a title">…</Step>
 *   </StepFlow>
 *
 * The required-step numbering is computed from child order, so adding/removing a
 * step just renumbers. Optional steps reuse the same slide-open technique as
 * CollapsibleSection (grid-rows transition, children stay mounted).
 */

export type StepProps = {
  /** Short step title (e.g. "Stream link", "Placement"). */
  title: ReactNode
  /** Marks the step done — required steps show a check instead of the number. */
  complete?: boolean
  /** Optional steps hide behind a "+ Add …" reveal instead of showing a number. */
  optional?: boolean
  /** The "+ Add …" button text for an optional step. Defaults to "Add {title}". */
  addLabel?: string
  /** Seed an optional step open on first render. */
  defaultOpen?: boolean
  /** Right-aligned hint next to a required step's title. */
  hint?: ReactNode
  children: ReactNode
  className?: string
  /** Injected by StepFlow — the 1-based number for required steps. */
  _number?: number
  /** Injected by StepFlow — true for the last child (drops the connector line). */
  _last?: boolean
}

export function Step({
  title,
  complete = false,
  optional = false,
  addLabel,
  defaultOpen = false,
  hint,
  children,
  className = '',
  _number,
  _last = false,
}: StepProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen)

  // ── Optional step: a "+ Add …" reveal that slides open ────────────────────
  if (optional) {
    const btnLabel = addLabel ?? `Add ${typeof title === 'string' ? title.toLowerCase() : 'more'}`
    return (
      <div className={`relative ${className}`}>
        <div className="flex">
          {/* rail spacer to align with numbered steps */}
          <div className="shrink-0 w-9 flex justify-center" aria-hidden>
            <span className="mt-1 w-7 h-7 rounded-full border border-dashed border-dark-border flex items-center justify-center text-gray-500">
              <NinjaIcon name={open ? 'chevron-down' : 'plus'} size={14} />
            </span>
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              {open ? title : btnLabel}
              <span className="text-gray-600 font-normal"> · optional</span>
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="pt-3">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Required step: numbered badge (→ check when complete) ──────────────────
  return (
    <div className={`relative flex ${className}`}>
      <div className="shrink-0 w-9 flex flex-col items-center">
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
            complete
              ? 'bg-gradient-kunai text-dark'
              : 'bg-dark-elevated border border-dark-border text-gray-300'
          }`}
        >
          {complete ? <NinjaIcon name="check" size={15} /> : _number ?? '•'}
        </span>
        {!_last && <span className="flex-1 w-px my-1 bg-dark-border" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {hint && <span className="ml-auto text-xs text-gray-500 truncate">{hint}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

export type StepFlowProps = {
  children: ReactNode
  className?: string
}

export function StepFlow({ children, className = '' }: StepFlowProps) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<StepProps>[]

  // Number only the REQUIRED steps, in order. Optional steps are skipped.
  let n = 0
  const numbered = items.map((child) => {
    const isOptional = child.props.optional === true
    const number = isOptional ? undefined : ++n
    return { child, number }
  })

  return (
    <div className={className}>
      {numbered.map(({ child, number }, i) => (
        cloneElement(child, {
          key: child.key ?? i,
          _number: number,
          _last: i === numbered.length - 1,
        })
      ))}
    </div>
  )
}

export default StepFlow
