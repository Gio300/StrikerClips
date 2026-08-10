import { Link } from 'react-router-dom'
import {
  ChevronRight,
  Film,
  Hammer,
  MessageSquare,
  RadioTower,
  Trophy,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

export type CreateIntent = {
  to: string
  label: string
  description: string
  Icon: LucideIcon
  iconClassName: string
}

export const CREATE_INTENTS: readonly CreateIntent[] = [
  {
    to: '/profile?tab=wall',
    label: 'My Profile',
    description: 'Post updates, share clips, and manage your wall.',
    Icon: UserRound,
    iconClassName: 'bg-accent/10 text-accent',
  },
  {
    to: '/messages',
    label: 'Messages',
    description: 'Start a direct message or private group thread.',
    Icon: MessageSquare,
    iconClassName: 'bg-trust/10 text-trust',
  },
  {
    to: '/highlight/create',
    label: 'Build a Reel',
    description: 'Turn your best clips into a highlight.',
    Icon: Film,
    iconClassName: 'bg-chakra/10 text-chakra',
  },
  {
    to: '/live',
    label: 'Live',
    description: 'Go live, host other players, or watch.',
    Icon: RadioTower,
    iconClassName: 'bg-kunai/10 text-kunai',
  },
  {
    to: '/tournaments?create=1',
    label: 'Create a Tournament',
    description: 'Pick a format, configure the bracket, then review.',
    Icon: Trophy,
    iconClassName: 'bg-chakra/10 text-chakra',
  },
  {
    to: '/boards/create',
    label: 'Create a Clan',
    description: 'Choose its purpose, identity, and recruiting settings.',
    Icon: UsersRound,
    iconClassName: 'bg-accent/10 text-accent',
  },
  {
    to: '/forge?create=1',
    label: 'Forge an Artifact',
    description: 'Choose a collectible or clan power, then configure it.',
    Icon: Hammer,
    iconClassName: 'bg-trust/10 text-trust',
  },
] as const

export function CreateIntentPicker({
  onSelect,
  className = '',
}: {
  onSelect?: () => void
  className?: string
}) {
  return (
    <div
      className={`divide-y divide-dark-border overflow-hidden rounded-lg border border-dark-border bg-dark ${className}`}
    >
      {CREATE_INTENTS.map(({ to, label, description, Icon, iconClassName }) => (
        <Link
          key={to}
          to={to}
          onClick={onSelect}
          className="flex min-h-[4.75rem] items-center gap-3 px-3 py-3 transition-colors hover:bg-dark-elevated focus-visible:bg-dark-elevated focus-visible:outline-none"
        >
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}>
            <Icon size={21} strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-white">{label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-gray-500">{description}</span>
          </span>
          <ChevronRight size={17} className="ml-auto shrink-0 text-gray-600" aria-hidden />
        </Link>
      ))}
    </div>
  )
}
