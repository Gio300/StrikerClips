import { Avatar } from '@/components/ui'
import type { ChatDraft } from '@/hooks/useChatDraft'

/**
 * MentionMenu — the @-autocomplete dropdown. Pure presentation over the state
 * useChatDraft already owns, so all four chat surfaces show the same list with
 * the same keyboard behaviour.
 *
 * Renders nothing at all when there is nothing to pick, which is also what
 * happens when people search is unavailable — the composer stays a plain input.
 */
export function MentionMenu({ draft, className = '' }: { draft: ChatDraft; className?: string }) {
  if (!draft.menuOpen) return null

  return (
    <ul
      role="listbox"
      aria-label="Mention a player"
      className={`absolute bottom-full left-2 right-2 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-dark-border bg-dark-card py-1 shadow-2xl ${className}`}
    >
      {draft.hits.map((person, index) => (
        <li key={person.id} role="option" aria-selected={index === draft.activeIndex}>
          <button
            type="button"
            // onMouseDown so the pick lands before the input's blur closes us.
            onMouseDown={(event) => {
              event.preventDefault()
              draft.pick(person)
            }}
            onMouseEnter={() => draft.setActiveIndex(index)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              index === draft.activeIndex
                ? 'bg-dark-border/60 text-white'
                : 'text-gray-300 hover:bg-dark-border/40'
            }`}
          >
            <Avatar src={person.avatar_url} name={person.username} seed={person.id} size={22} />
            <span className="truncate">@{person.username || 'player'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default MentionMenu
