import { useState } from 'react'
import { Flag, X } from 'lucide-react'
import {
  CONTENT_REPORT_REASONS,
  submitContentReport,
  type ContentReportReason,
  type ContentReportTargetType,
} from '@/lib/contentReports'

export function ReportContentButton({
  reporterId,
  targetOwnerId,
  targetType,
  targetId,
  className = '',
  compact = true,
}: {
  reporterId: string | null | undefined
  targetOwnerId: string | null | undefined
  targetType: ContentReportTargetType
  targetId: string
  className?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ContentReportReason>('harassment')
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isProfileReport = targetType === 'profile'
  const reportLabel = isProfileReport ? 'profile' : 'content'
  const reportLabelTitle = isProfileReport ? 'Profile' : 'Content'

  // Guests cannot submit a durable authenticated report. People can delete
  // their own UGC, and the server rejects self-reports even if a stale client
  // renders the control.
  if (!reporterId || (targetOwnerId && reporterId === targetOwnerId)) return null

  async function send() {
    if (sending || sent) return
    setSending(true)
    setError(null)
    try {
      const sourcePath = typeof window === 'undefined'
        ? undefined
        : `${window.location.pathname}${window.location.search}`
      await submitContentReport({ targetType, targetId, reason, details, sourcePath })
      setSent(true)
      setOpen(false)
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'The report could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true) }}
        disabled={sent}
        className={`inline-flex items-center gap-1 rounded-md text-gray-500 hover:bg-dark-border/50 hover:text-kunai disabled:cursor-default disabled:text-gray-600 ${
          compact ? 'h-7 px-2 text-xs' : 'px-4 py-3 text-sm'
        } ${className}`}
        aria-label={sent ? `${reportLabelTitle} reported` : `Report ${reportLabel}`}
        title={sent ? 'Reported' : 'Report'}
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />
        {!compact && (sent ? 'Reported' : isProfileReport ? 'Report profile' : 'Report')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !sending) setOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`report-title-${targetId}`}
            className="w-full max-w-md rounded-xl border border-dark-border bg-dark-card p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={`report-title-${targetId}`} className="text-lg font-semibold text-white">
                Report {reportLabel}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                aria-label="Close report form"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-border hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-400">
              {isProfileReport
                ? 'Tell the moderation team what is wrong with this profile. The player will not see who reported them.'
                : 'Tell the moderation team what is wrong. The person who posted it will not see who reported it.'}
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-200">
              Reason
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value as ContentReportReason)}
                disabled={sending}
                className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
              >
                {CONTENT_REPORT_REASONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-200">
              Details <span className="font-normal text-gray-500">(optional)</span>
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={1000}
                rows={3}
                disabled={sending}
                className="mt-1 w-full resize-y rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                placeholder="What should the moderation team know?"
              />
            </label>
            {error && <p role="alert" className="mt-3 text-sm text-kunai">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="rounded-lg border border-dark-border px-4 py-2 text-sm font-medium text-gray-300 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="rounded-lg bg-kunai px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send report'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export default ReportContentButton
