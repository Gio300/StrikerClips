import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Radio,
  Shield,
  Swords,
  Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AvailabilityHint } from '@/components/ui'
import { useIdentityAvailability } from '@/hooks/useIdentityAvailability'
import { CLAN_TAG_MAX } from '@/lib/identity'

type ClanPurpose = 'competitive' | 'creator' | 'social'
type ClanWizardStep = 'target' | 'configure' | 'review'

const CLAN_PURPOSES = {
  competitive: {
    title: 'Competitive',
    description: 'Build a roster for battles, rankings, and Conquest.',
    Icon: Swords,
  },
  creator: {
    title: 'Creator / Community',
    description: 'Organize viewers, content, events, and shared chat.',
    Icon: Radio,
  },
  social: {
    title: 'Social Squad',
    description: 'Keep friends together in one simple crew space.',
    Icon: Users,
  },
} as const

export function CreateServer() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<ClanWizardStep>('target')
  const [purpose, setPurpose] = useState<ClanPurpose | null>(null)
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [isRecruiting, setIsRecruiting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const nameCheck = useIdentityAvailability('clanName', name)
  const tagCheck = useIdentityAvailability('clanTag', tag, { required: false })

  const identityReady = !nameCheck.blocked && !tagCheck.blocked && name.trim() !== ''
  const canSubmit = !loading && identityReady && purpose !== null

  function choosePurpose(nextPurpose: ClanPurpose) {
    setPurpose(nextPurpose)
    setError('')
    setStep('configure')
  }

  function reviewClan() {
    if (!identityReady || !purpose) return
    setError('')
    setStep('review')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (step !== 'review') {
      reviewClan()
      return
    }
    if (!purpose || !canSubmit) return
    setError('')
    if (nameCheck.blocked) {
      setError(nameCheck.message || 'Pick an available clan name.')
      return
    }
    if (tagCheck.blocked) {
      setError(tagCheck.message || 'Pick an available clan tag.')
      return
    }

    setLoading(true)
    const { data: server, error: serverErr } = await supabase
      .from('servers')
      .insert({
        name: nameCheck.value,
        clan_tag: tagCheck.value || null,
        owner_id: user?.id,
        kind: 'clan',
        max_members: 100,
        is_recruiting: isRecruiting,
      })
      .select('id')
      .single()

    if (serverErr || !server) {
      const message = String(serverErr?.message ?? '')
      setError(
        /duplicate|unique/i.test(message)
          ? 'Someone just claimed that name or tag. Try another.'
          : message || 'Failed to create clan',
      )
      setLoading(false)
      return
    }

    await supabase.from('channels').insert({ server_id: server.id, name: 'general', type: 'text' })
    await supabase
      .from('server_members')
      .insert({ server_id: server.id, user_id: user?.id, role: 'owner' })
    await supabase
      .from('clan_members')
      .insert({ server_id: server.id, user_id: user?.id, role: 'leader' })
    navigate(`/boards/${server.id}`)
    setLoading(false)
  }

  const inputClass =
    'field w-full'
  const selectedPurpose = purpose ? CLAN_PURPOSES[purpose] : null

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6 sm:py-8">
      <ClanProgress step={step} />

      {step === 'target' && (
        <section className="mt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
              <Shield size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-white">Create a clan</h1>
              <p className="mt-0.5 text-sm text-gray-400">What kind of crew are you building?</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2">
            {(Object.entries(CLAN_PURPOSES) as [
              ClanPurpose,
              (typeof CLAN_PURPOSES)[ClanPurpose],
            ][]).map(([id, option]) => {
              const Icon = option.Icon
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => choosePurpose(id)}
                  className="group flex min-h-20 w-full items-center gap-4 rounded-lg border border-dark-border bg-dark-card px-4 py-3 text-left transition-colors hover:border-kunai/60 hover:bg-dark-elevated"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-white">{option.title}</span>
                    <span className="mt-0.5 block text-sm text-gray-400">{option.description}</span>
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-gray-600 transition-colors group-hover:text-kunai" />
                </button>
              )
            })}
          </div>
        </section>
      )}

      {step === 'configure' && selectedPurpose && purpose && (
        <form onSubmit={handleSubmit} className="mt-6">
          <ClanHeading
            title="Name your clan"
            context={selectedPurpose.title}
            backLabel="Choose another clan type"
            onBack={() => setStep('target')}
            icon={<selectedPurpose.Icon size={20} />}
          />

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm text-gray-400">
                Clan name <span className="text-kunai">*</span>
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
                placeholder={
                  purpose === 'competitive'
                    ? 'AI Clan'
                    : purpose === 'creator'
                      ? 'TKO Creators'
                      : 'Night Squad'
                }
                autoFocus
              />
              <AvailabilityHint
                state={nameCheck}
                onPick={setName}
                hint="Use at least 2 letters or numbers."
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm text-gray-400">
                Clan tag <span className="text-gray-600">(optional)</span>
              </span>
              <input
                type="text"
                value={tag}
                onChange={(event) => setTag(event.target.value.toUpperCase())}
                maxLength={CLAN_TAG_MAX}
                className={`${inputClass} font-semibold uppercase tracking-widest`}
                placeholder="AI"
                aria-describedby="clan-tag-hint"
              />
              <span id="clan-tag-hint">
                <AvailabilityHint
                  state={tagCheck}
                  onPick={setTag}
                  hint={`2-${CLAN_TAG_MAX} letters or numbers. Displays as [${tag || 'AI'}].`}
                />
              </span>
            </label>

            <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-lg border border-dark-border bg-dark-card px-4 py-3">
              <span>
                <span className="block font-semibold text-white">Open recruiting</span>
                <span className="mt-0.5 block text-sm text-gray-400">
                  {isRecruiting ? 'Players can find and request to join.' : 'Your clan stays invite-only.'}
                </span>
              </span>
              <input
                type="checkbox"
                checked={isRecruiting}
                onChange={(event) => setIsRecruiting(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-kunai"
              />
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="submit" disabled={!identityReady} className="btn-primary">
              Review
              <ArrowRight size={17} />
            </button>
            <button type="button" onClick={() => navigate('/boards')} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'review' && selectedPurpose && (
        <form onSubmit={handleSubmit} className="mt-6">
          <ClanHeading
            title="Review clan"
            context="Ready to create"
            backLabel="Edit clan"
            onBack={() => setStep('configure')}
            icon={<Check size={20} />}
          />

          <dl className="mt-5 divide-y divide-dark-border border-y border-dark-border">
            <ClanReviewRow label="Purpose" value={selectedPurpose.title} />
            <ClanReviewRow label="Name" value={nameCheck.value} />
            <ClanReviewRow label="Tag" value={tagCheck.value ? `[${tagCheck.value}]` : 'None'} />
            <ClanReviewRow label="Joining" value={isRecruiting ? 'Open recruiting' : 'Invite-only'} />
          </dl>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {loading ? 'Creating...' : 'Create clan'}
            </button>
            <button type="button" onClick={() => setStep('configure')} className="btn-ghost">
              Edit
            </button>
            <button type="button" onClick={() => navigate('/boards')} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function ClanProgress({ step }: { step: ClanWizardStep }) {
  const activeIndex = step === 'target' ? 0 : step === 'configure' ? 1 : 2
  const labels = ['Target', 'Configure', 'Review']

  return (
    <div aria-label={`Step ${activeIndex + 1} of 3: ${labels[activeIndex]}`}>
      <div className="flex gap-1.5">
        {labels.map((label, index) => (
          <span
            key={label}
            className={`h-1.5 flex-1 rounded-full ${index <= activeIndex ? 'bg-kunai' : 'bg-dark-elevated'}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-white">Step {activeIndex + 1} of 3</span>
        <span className="text-gray-500">{labels[activeIndex]}</span>
      </div>
    </div>
  )
}

function ClanHeading({
  title,
  context,
  backLabel,
  onBack,
  icon,
}: {
  title: string
  context: string
  backLabel: string
  onBack: () => void
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border text-gray-400 transition-colors hover:text-white"
      >
        <ChevronLeft size={20} />
      </button>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
        {icon}
      </span>
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-0.5 text-sm text-gray-400">{context}</p>
      </div>
    </div>
  )
}

function ClanReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-white">{value}</dd>
    </div>
  )
}
