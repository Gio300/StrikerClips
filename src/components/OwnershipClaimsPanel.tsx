import { useEffect, useState } from 'react'
import { AlertCircle, ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import {
  fetchOnboardingDisputes,
  resolveOnboardingDispute,
  type OnboardingDispute,
  type OnboardingDisputeDecision,
  type OnboardingDisputeParty,
} from '@/lib/onboardingApi'

function personLabel(person: OnboardingDisputeParty | null): string {
  if (!person) return 'the current owner'
  return person.username?.trim() ? `@${person.username.trim()}` : 'the current owner'
}

function evidenceText(dispute: OnboardingDispute, key: string): string | null {
  const value = dispute.evidence[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeWebUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function claimTitle(dispute: OnboardingDispute): string {
  if (dispute.kind === 'youtube_channel') {
    return evidenceText(dispute, 'channel_title') || 'YouTube channel'
  }
  const name = evidenceText(dispute, 'name') || 'Clan'
  const tag = evidenceText(dispute, 'clan_tag')
  return tag ? `${name} [${tag.replace(/^\[|\]$/g, '')}]` : name
}

function statusLabel(dispute: OnboardingDispute): string {
  if (dispute.status === 'open') return dispute.can_resolve ? 'Needs your review' : 'Pending review'
  if (dispute.status === 'transferred') return 'Approved'
  if (dispute.status === 'rejected' || dispute.status === 'confirmed_current') return 'Rejected'
  return 'Cancelled'
}

function statusDescription(dispute: OnboardingDispute): string {
  if (dispute.status === 'open') {
    return dispute.can_resolve
      ? 'Current ownership stays in place until you approve or reject this claim.'
      : 'Current ownership stays in place while the claim is reviewed.'
  }
  if (dispute.status === 'transferred') {
    return dispute.viewer_role === 'challenger'
      ? 'The claim was approved and ownership was transferred to your account.'
      : `The claim was approved and ownership was transferred to ${personLabel(dispute.challenger)}.`
  }
  if (dispute.status === 'rejected' || dispute.status === 'confirmed_current') {
    return 'The claim was rejected and current ownership was kept.'
  }
  return 'This claim is no longer active.'
}

function confirmationText(
  dispute: OnboardingDispute,
  decision: OnboardingDisputeDecision,
  productName: string,
): string {
  const title = claimTitle(dispute)
  const challenger = personLabel(dispute.challenger)
  const owner = personLabel(dispute.current_owner)
  if (decision === 'reject') {
    return `Keep current ownership of “${title}”? This rejects ${challenger}'s claim. No ownership will transfer.`
  }
  if (dispute.kind === 'clan') {
    return `Approve this transfer? ${owner} will lose clan ownership of “${title}”, and ${challenger} will become the clan owner immediately in ${productName}.`
  }
  return `Approve this transfer? “${title}” will be removed from ${owner} and assigned to ${challenger}. This changes who owns the YouTube channel in ${productName}.`
}

export function OwnershipClaimsPanel({ productName }: { productName: string }) {
  const [disputes, setDisputes] = useState<OnboardingDispute[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void fetchOnboardingDisputes()
      .then((next) => { if (active) setDisputes(next) })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load ownership claims.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function decide(dispute: OnboardingDispute, decision: OnboardingDisputeDecision) {
    if (!dispute.can_resolve || dispute.status !== 'open' || resolvingId) return
    if (!globalThis.confirm(confirmationText(dispute, decision, productName))) return
    setResolvingId(dispute.id)
    setError('')
    try {
      const updated = await resolveOnboardingDispute(dispute.id, decision)
      setDisputes((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not resolve the ownership claim.')
    } finally {
      setResolvingId(null)
    }
  }

  if (!loading && disputes.length === 0 && !error) return null

  return (
    <section id="ownership-claims" className="scroll-mt-6 border-b border-dark-border py-7" aria-labelledby="ownership-claims-title">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <ShieldCheck size={20} aria-hidden />
        </span>
        <div>
          <h2 id="ownership-claims-title" className="font-semibold text-white">Ownership claims</h2>
          <p className="mt-1 text-sm text-gray-400">Review YouTube and clan ownership claims connected to {productName}.</p>
        </div>
      </div>

      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking ownership claims...
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-kunai/30 bg-kunai/5 px-3 py-2 text-sm text-kunai">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {!loading && disputes.length > 0 && (
        <div className="space-y-3">
          {disputes.map((dispute) => {
            const title = claimTitle(dispute)
            const channelUrl = safeWebUrl(evidenceText(dispute, 'channel_url'))
            const videoUrl = safeWebUrl(evidenceText(dispute, 'video_url'))
            const busy = resolvingId === dispute.id
            return (
              <article key={dispute.id} className="rounded-xl border border-dark-border bg-dark-card p-4" aria-label={`${title} ownership claim`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {dispute.kind === 'youtube_channel' ? 'YouTube channel claim' : 'Clan ownership claim'}
                    </p>
                    <h3 className="mt-1 font-semibold text-white">{title}</h3>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    dispute.status === 'transferred'
                      ? 'bg-leaf/10 text-leaf'
                      : dispute.status === 'rejected' || dispute.status === 'confirmed_current' || dispute.status === 'cancelled'
                        ? 'bg-dark-elevated text-gray-400'
                        : dispute.can_resolve ? 'bg-kunai/10 text-kunai' : 'bg-accent/10 text-accent'
                  }`}>
                    {statusLabel(dispute)}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-5 text-gray-400">{statusDescription(dispute)}</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-600">Current owner</dt>
                    <dd className="mt-0.5 text-gray-300">{personLabel(dispute.current_owner)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-600">Claim submitted by</dt>
                    <dd className="mt-0.5 text-gray-300">{personLabel(dispute.challenger)}</dd>
                  </div>
                </dl>

                {(channelUrl || videoUrl) && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {channelUrl && (
                      <a href={channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                        View YouTube channel <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                    {videoUrl && (
                      <a href={videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                        Review submitted video <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </div>
                )}

                {dispute.resolution_note && (
                  <p className="mt-3 rounded-lg bg-dark px-3 py-2 text-xs text-gray-400">
                    <span className="font-medium text-gray-300">Review note:</span> {dispute.resolution_note}
                  </p>
                )}

                {dispute.can_resolve && dispute.status === 'open' && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void decide(dispute, 'approve')}
                      disabled={Boolean(resolvingId)}
                      className="min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-50"
                    >
                      {busy ? 'Saving decision...' : 'Approve transfer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(dispute, 'reject')}
                      disabled={Boolean(resolvingId)}
                      className="min-h-11 rounded-lg border border-dark-border px-3 text-sm font-medium text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
                    >
                      Keep current ownership
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
