import { ReportContentButton } from '@/components/ReportContentButton'

/**
 * A direct profile-report action for another signed-in player. The explicit
 * guard keeps the action off a person's own profile; ReportContentButton and
 * the server repeat that guard so stale UI cannot turn it into a self-report.
 */
export function ProfileReportControl({
  viewerId,
  profileId,
}: {
  viewerId: string | null | undefined
  profileId: string | null | undefined
}) {
  if (!viewerId || !profileId || viewerId === profileId) return null

  return (
    <ReportContentButton
      reporterId={viewerId}
      targetOwnerId={profileId}
      targetType="profile"
      targetId={profileId}
      compact={false}
      className="border border-dark-border"
    />
  )
}

export default ProfileReportControl
