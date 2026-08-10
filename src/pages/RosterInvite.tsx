import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, ShieldCheck, UsersRound } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  acceptRosterInvite,
  previewRosterInvite,
  type RosterMemberRole,
} from '@/lib/organizerApi'

type Invitation = {
  id: string
  status: string
  member_role: RosterMemberRole
  fee_tokens_snapshot: number
  expires_at: string
  expired: boolean
  roster_id: string
  roster_name: string
  game: string
  clan_id: string
  clan_name: string
  inviter_name: string
}

const ROLE_LABEL: Record<RosterMemberRole, string> = {
  captain: 'Captain',
  starter: 'Starter',
  substitute: 'Substitute',
  coach: 'Coach',
}

function invitationError(error: string | null): string {
  const messages: Record<string, string> = {
    invitation_not_found: 'This invitation could not be found.',
    invitation_unavailable: 'This invitation has already been used or withdrawn.',
    invitation_expired: 'This invitation has expired. Ask the clan leader to send a new one.',
    invitation_belongs_to_another_email: 'Sign in with the email address that received this invitation.',
    invitation_belongs_to_another_account: 'This invitation belongs to another account.',
    applicant_insufficient_tokens: 'You do not currently have enough Tokens for the clan join fee.',
    clan_is_full: 'This clan is currently full.',
    roster_is_full: 'This competition roster is currently full.',
  }
  return messages[error || ''] || error || 'The invitation could not be accepted.'
}

export function RosterInvite() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    previewRosterInvite(token)
      .then((result) => {
        if (!alive) return
        if (!result.ok || !result.data) {
          setError(invitationError(result.error))
          return
        }
        setInvitation(result.data.invitation)
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [token])

  async function accept() {
    if (!user || !invitation || accepting) return
    setAccepting(true)
    setError('')
    const result = await acceptRosterInvite(token)
    setAccepting(false)
    if (!result.ok || !result.data) {
      setError(invitationError(result.error))
      return
    }
    setAccepted(true)
  }

  const from = location.pathname + location.search
  const unavailable = Boolean(invitation && (invitation.expired || invitation.status !== 'pending'))

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <div className="border-y border-dark-border py-6">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <UsersRound size={22} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold text-white">Competition roster invitation</h1>
            <p className="mt-1 text-sm text-gray-400">Review the lineup and account terms before joining.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-44 items-center justify-center text-gray-400">
            <Loader2 size={20} className="mr-2 animate-spin" aria-hidden /> Loading invitation
          </div>
        ) : invitation ? (
          <div className="mt-6 space-y-5">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-y border-dark-border py-5 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Clan</dt>
                <dd className="mt-1 font-semibold text-white">{invitation.clan_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Roster</dt>
                <dd className="mt-1 font-semibold text-white">{invitation.roster_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Role</dt>
                <dd className="mt-1 text-gray-200">{ROLE_LABEL[invitation.member_role]}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Game</dt>
                <dd className="mt-1 text-gray-200">{invitation.game}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Invited by</dt>
                <dd className="mt-1 text-gray-200">{invitation.inviter_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Join fee</dt>
                <dd className="mt-1 text-gray-200">
                  {invitation.fee_tokens_snapshot > 0
                    ? `${invitation.fee_tokens_snapshot.toLocaleString()} TKN when accepted`
                    : 'No fee'}
                </dd>
              </div>
            </dl>

            {accepted ? (
              <div className="flex items-start gap-3 border border-leaf/30 bg-leaf/10 p-4 text-sm text-gray-200">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-leaf" aria-hidden />
                <div>
                  <p className="font-semibold text-white">You joined {invitation.roster_name}</p>
                  <button
                    type="button"
                    onClick={() => navigate(`/boards/${invitation.clan_id}`)}
                    className="mt-2 text-accent hover:underline"
                  >
                    Open clan
                  </button>
                </div>
              </div>
            ) : unavailable ? (
              <p className="border border-dark-border bg-dark px-4 py-3 text-sm text-gray-400">
                {invitation.expired ? 'This invitation has expired.' : `This invitation is ${invitation.status}.`}
              </p>
            ) : authLoading ? (
              <p className="text-sm text-gray-400">Checking your account...</p>
            ) : !user ? (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-gray-300">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  Sign in with the email address that received this invitation.
                </p>
                <div className="flex gap-2">
                  <Link
                    to="/login"
                    state={{ from, reason: `Sign in to join ${invitation.roster_name}` }}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-dark"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/signup"
                    state={{ from, reason: `Create an account to join ${invitation.roster_name}` }}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-dark-border px-4 text-sm font-semibold text-white"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void accept()}
                disabled={accepting}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-dark disabled:opacity-50 sm:w-auto"
              >
                {accepting && <Loader2 size={17} className="animate-spin" aria-hidden />}
                {accepting ? 'Joining roster...' : 'Accept and join roster'}
              </button>
            )}
          </div>
        ) : null}

        {error && <p className="mt-5 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  )
}

export default RosterInvite
