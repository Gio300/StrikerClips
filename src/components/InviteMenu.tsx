import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { notify } from '@/lib/notifications'
import {
  useInviteContext,
  invalidateInviteContext,
  type OwnedLiveGroup,
  type OwnedTournament,
  type PendingStatCheck,
} from '@/hooks/useInviteContext'

/**
 * UniversalInviteMenu — site-wide "Invite [user] to..." dropdown.
 *
 * Replaces the scattered single-purpose buttons (Invite to live group,
 * Invite to clan, Add as tournament admin, etc.) with one context-aware
 * menu. Each option is conditionally rendered based on what the current
 * user can actually offer (do I own a tournament? a clan? do I have a
 * pending stat check needing review?).
 *
 * Usage:
 *   <InviteMenu targetUserId={user.id} targetUsername={user.username} />
 *
 * The menu is keyboard / outside-click dismissable and renders inline
 * (not portaled) so callers can place it inside cards / lists.
 */

export type InviteMenuProps = {
  targetUserId: string
  targetUsername: string
  /** Optional context narrows the menu (e.g. on a tournament page,
   *  pre-select that tournament for the "make admin" action). */
  context?: {
    tournamentId?: string
    liveGroupId?: string
  }
  /** Override the trigger button label. Defaults to "Invite". */
  label?: string
  /** Compact mode renders a small icon-style button. */
  compact?: boolean
  /** Optional className for the trigger button. */
  className?: string
}

type ToastState = { kind: 'success' | 'error'; text: string } | null

export function InviteMenu({
  targetUserId,
  targetUsername,
  context,
  label = 'Invite',
  compact = false,
  className = '',
}: InviteMenuProps) {
  const { user } = useAuth()
  const ctx = useInviteContext()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<
    null | 'liveGroup' | 'tournamentAdmin' | 'statCheck'
  >(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setActiveSubmenu(null)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setActiveSubmenu(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const isSelf = user?.id === targetUserId
  const canDM = !!user && !isSelf
  const canFollow = !!user && !isSelf

  const liveGroups: OwnedLiveGroup[] = context?.liveGroupId
    ? ctx.ownedLiveGroups.filter((g) => g.id === context.liveGroupId)
    : ctx.ownedLiveGroups

  const tournaments: OwnedTournament[] = context?.tournamentId
    ? ctx.ownedTournaments.filter((t) => t.id === context.tournamentId)
    : ctx.ownedTournaments

  const statChecks: PendingStatCheck[] = ctx.myPendingStatChecks

  // ── Action handlers ────────────────────────────────────────────────

  async function inviteToLiveGroup(groupId: string, groupName: string) {
    if (!user) return
    const { error } = await supabase
      .from('live_group_members')
      .insert({ group_id: groupId, user_id: targetUserId, accepted: false })
    closeAll()
    if (error) {
      setToast({ kind: 'error', text: humanizeRow(error.message, `${targetUsername} may already be in ${groupName}.`) })
    } else {
      notify({
        userId: targetUserId,
        kind: 'live_group_invite',
        title: `You were invited to a live group`,
        body: `Join "${groupName}" to share your live feed.`,
        link: `/live`,
        relatedId: groupId,
      })
      setToast({ kind: 'success', text: `Invited ${targetUsername} to ${groupName}.` })
    }
  }

  async function makeTournamentAdmin(tournamentId: string, tournamentName: string) {
    if (!user) return
    const { error } = await supabase
      .from('tournament_admins')
      .insert({ tournament_id: tournamentId, user_id: targetUserId })
    closeAll()
    if (error) {
      setToast({ kind: 'error', text: humanizeRow(error.message, `${targetUsername} is already an admin of ${tournamentName}.`) })
    } else {
      notify({
        userId: targetUserId,
        kind: 'tournament_admin_invite',
        title: `You were added as a tournament admin`,
        body: `You can review stat checks for "${tournamentName}".`,
        link: `/tournaments/${tournamentId}?section=admins`,
        relatedId: tournamentId,
      })
      setToast({ kind: 'success', text: `${targetUsername} is now a ${tournamentName} admin.` })
    }
  }

  async function inviteToReviewStatCheck(submissionId: string, tournamentName: string) {
    if (!user) return
    const { error } = await supabase
      .from('stat_check_submissions')
      .update({ invited_admin_id: targetUserId })
      .eq('id', submissionId)
      .eq('user_id', user.id)
    closeAll()
    if (error) {
      setToast({ kind: 'error', text: error.message })
    } else {
      invalidateInviteContext()
      notify({
        userId: targetUserId,
        kind: 'stat_check_review_request',
        title: 'New stat check review requested',
        body: `Asked you to review their stat check for "${tournamentName}".`,
        link: `/tournaments?section=stat-check`,
        relatedId: submissionId,
      })
      setToast({ kind: 'success', text: `Invited ${targetUsername} to review your ${tournamentName} stat check.` })
    }
  }

  async function followTarget() {
    if (!user) return
    const { error } = await supabase
      .from('follows')
      .insert({ follower_id: user.id, following_id: targetUserId })
    closeAll()
    if (error) {
      setToast({ kind: 'error', text: humanizeRow(error.message, `Already following ${targetUsername}.`) })
    } else {
      setToast({ kind: 'success', text: `Now following ${targetUsername}.` })
    }
  }

  function startDM() {
    closeAll()
    navigate(`/profile/${targetUserId}?dm=1`)
  }

  function closeAll() {
    setOpen(false)
    setActiveSubmenu(null)
  }

  // ── Render ────────────────────────────────────────────────────────

  if (isSelf) return null

  const triggerCls = compact
    ? 'inline-flex items-center justify-center w-8 h-8 rounded text-gray-300 hover:text-accent hover:bg-dark-elevated'
    : 'inline-flex items-center gap-1 px-3 py-1.5 rounded border border-dark-border text-gray-200 text-sm hover:border-accent/50 hover:text-accent'

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Actions for ${targetUsername}`}
      >
        {compact ? (
          <span className="text-lg leading-none" aria-hidden>⋯</span>
        ) : (
          <>
            {label}
            <span className="text-xs opacity-70">▾</span>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[230px] rounded-lg border border-dark-border bg-dark-card shadow-xl py-1"
        >
          <MenuLabel text={targetUsername} />

          {/* Universal actions */}
          <Link
            to={`/profile/${targetUserId}`}
            onClick={closeAll}
            className="block px-3 py-1.5 text-sm text-gray-200 hover:bg-accent/10 hover:text-accent"
          >
            View profile
          </Link>

          {canDM && (
            <button
              type="button"
              onClick={startDM}
              className="block w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-accent/10 hover:text-accent"
            >
              Send a message
            </button>
          )}

          {canFollow && (
            <button
              type="button"
              onClick={followTarget}
              className="block w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-accent/10 hover:text-accent"
            >
              Follow
            </button>
          )}

          <Divider />

          {/* Invite to live group */}
          {user && liveGroups.length > 0 && (
            <SubmenuRow
              label={`Invite to live group${liveGroups.length > 1 ? '…' : ` (${liveGroups[0].name})`}`}
              isOpen={activeSubmenu === 'liveGroup'}
              onToggle={() => setActiveSubmenu(activeSubmenu === 'liveGroup' ? null : 'liveGroup')}
              singleAction={liveGroups.length === 1
                ? () => inviteToLiveGroup(liveGroups[0].id, liveGroups[0].name)
                : undefined}
            >
              {liveGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => inviteToLiveGroup(g.id, g.name)}
                  className="block w-full text-left px-5 py-1.5 text-sm text-gray-300 hover:bg-accent/10 hover:text-accent"
                >
                  {g.name}
                </button>
              ))}
            </SubmenuRow>
          )}

          {/* Make tournament admin */}
          {user && tournaments.length > 0 && (
            <SubmenuRow
              label={`Add as tournament admin${tournaments.length > 1 ? '…' : ` (${tournaments[0].name})`}`}
              isOpen={activeSubmenu === 'tournamentAdmin'}
              onToggle={() => setActiveSubmenu(activeSubmenu === 'tournamentAdmin' ? null : 'tournamentAdmin')}
              singleAction={tournaments.length === 1
                ? () => makeTournamentAdmin(tournaments[0].id, tournaments[0].name)
                : undefined}
            >
              {tournaments.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => makeTournamentAdmin(t.id, t.name)}
                  className="block w-full text-left px-5 py-1.5 text-sm text-gray-300 hover:bg-accent/10 hover:text-accent"
                >
                  {t.name}
                </button>
              ))}
            </SubmenuRow>
          )}

          {/* Invite to review my stat check */}
          {user && statChecks.length > 0 && (
            <SubmenuRow
              label={`Ask to review my stat check${statChecks.length > 1 ? '…' : ''}`}
              isOpen={activeSubmenu === 'statCheck'}
              onToggle={() => setActiveSubmenu(activeSubmenu === 'statCheck' ? null : 'statCheck')}
              singleAction={statChecks.length === 1
                ? () => inviteToReviewStatCheck(statChecks[0].id, statChecks[0].tournament_name)
                : undefined}
            >
              {statChecks.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => inviteToReviewStatCheck(s.id, s.tournament_name)}
                  className="block w-full text-left px-5 py-1.5 text-sm text-gray-300 hover:bg-accent/10 hover:text-accent"
                >
                  {s.tournament_name}
                  {s.invited_admin_id && (
                    <span className="ml-1 text-[10px] text-gray-500">(reassign)</span>
                  )}
                </button>
              ))}
            </SubmenuRow>
          )}

          {!user && (
            <p className="px-3 py-2 text-xs text-gray-500">
              <Link to="/login" onClick={closeAll} className="text-accent hover:underline">Log in</Link> to send invites.
            </p>
          )}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
            toast.kind === 'success'
              ? 'bg-leaf/15 border border-leaf/40 text-leaf'
              : 'bg-kunai/15 border border-kunai/40 text-kunai'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

function MenuLabel({ text }: { text: string }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-gray-500 truncate">
      {text}
    </div>
  )
}

function Divider() {
  return <div className="my-1 border-t border-dark-border" />
}

function SubmenuRow({
  label,
  isOpen,
  onToggle,
  children,
  singleAction,
}: {
  label: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  /** When defined, clicking the parent row fires this directly (single-target shortcut). */
  singleAction?: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={singleAction ? singleAction : onToggle}
        className="block w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-accent/10 hover:text-accent"
      >
        <span className="inline-flex w-full items-center justify-between">
          <span className="truncate">{label}</span>
          {!singleAction && (
            <span className="text-xs opacity-70 ml-2">{isOpen ? '▾' : '▸'}</span>
          )}
        </span>
      </button>
      {isOpen && !singleAction && (
        <div className="pl-3 border-l border-dark-border ml-3 my-0.5">{children}</div>
      )}
    </div>
  )
}

/** Replace ugly Postgres unique-violation messages with friendlier text. */
function humanizeRow(message: string, friendly: string): string {
  if (/duplicate key|unique constraint|violates unique/i.test(message)) return friendly
  return message
}
