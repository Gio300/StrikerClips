import { Link } from 'react-router-dom'
import { REV_SHARE_PERCENT, CREATOR_AGREEMENT_VERSION } from '@/lib/creatorAgreement'
import { BRAND } from '@/lib/brand'

/**
 * Required consent shown at upload time. Unlike the one-time signup checkbox,
 * this captures a per-build license grant (an immutable creator_agreements row
 * is written on publish). Controlled component: parent owns `accepted`.
 */
export function CreatorLicenseGate({
  accepted,
  onChange,
}: {
  accepted: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
      <div className="text-sm font-semibold text-white">Creator Agreement</div>
      <p className="text-xs text-gray-400 leading-relaxed">
        By publishing you grant {BRAND.name} a license to <strong className="text-gray-200">host</strong>,{' '}
        <strong className="text-gray-200">edit &amp; combine</strong> your clip with other angles into derivative
        works, <strong className="text-gray-200">distribute</strong> them (including on the {BRAND.name} YouTube
        channel), and <strong className="text-gray-200">monetize</strong> them. In return you earn a{' '}
        <strong className="text-leaf">{REV_SHARE_PERCENT}% share of net ad revenue</strong> attributable to works that
        include your clip, tracked in your dashboard. You keep ownership of your original.
      </p>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <span className="text-xs text-gray-300">
          I own or have rights to this content and I agree to the{' '}
          <Link to="/terms" target="_blank" className="text-kunai hover:underline">
            {BRAND.name} Creator Agreement
          </Link>{' '}
          <span className="text-gray-500">({CREATOR_AGREEMENT_VERSION})</span>.
        </span>
      </label>
    </div>
  )
}
