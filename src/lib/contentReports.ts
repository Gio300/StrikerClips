import { supabase } from '@/lib/supabase'

export const CONTENT_REPORT_REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['violence', 'Violence or threats'],
  ['sexual', 'Sexual content'],
  ['spam', 'Spam'],
  ['scam', 'Scam or fraud'],
  ['impersonation', 'Impersonation'],
  ['self_harm', 'Self-harm concern'],
  ['other', 'Something else'],
] as const

export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number][0]

export type ContentReportTargetType =
  | 'profile'
  | 'post'
  | 'post_comment'
  | 'reel'
  | 'reel_comment'
  | 'chat_message'
  | 'dm_message'
  | 'stream_message'
  | 'tournament_message'
  | 'board_message'

export interface ContentReportInput {
  targetType: ContentReportTargetType
  targetId: string
  reason: ContentReportReason
  details?: string
  sourcePath?: string
}

type FunctionsClient = {
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, unknown> },
    ) => Promise<{ data: any; error: { message?: string } | null }>
  }
}

export async function submitContentReport(
  input: ContentReportInput,
  client: FunctionsClient = supabase as unknown as FunctionsClient,
): Promise<{ duplicate: boolean; id: string }> {
  const { data, error } = await client.functions.invoke('report-content', {
    body: {
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      details: input.details?.trim().slice(0, 1000) || null,
      source_path: input.sourcePath?.trim().slice(0, 1000) || null,
    },
  })
  if (error) throw new Error(error.message || 'The report could not be sent.')
  if (!data?.ok || !data?.report?.id) {
    throw new Error(data?.message || data?.error || 'The report could not be sent.')
  }
  return { duplicate: data.duplicate === true, id: String(data.report.id) }
}
