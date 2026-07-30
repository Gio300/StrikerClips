/**
 * A small green "✓ Connected" pill. Used to show a connected/saved state
 * (YouTube linked, stream link saved, clip added) WITHOUT ever printing the
 * raw URL to the user. Matches the dark/green (leaf) theme.
 */
export function ConnectedBadge({
  label = 'Connected to TKO',
  className = '',
}: {
  label?: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-leaf/40 bg-leaf/10 px-2 py-0.5 text-xs font-medium text-leaf ${className}`}
    >
      <span className="leading-none">✓</span>
      {label}
    </span>
  )
}
