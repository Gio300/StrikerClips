import { API_BASE } from '@/lib/apiBase'
import { uploadUserImage } from '@/lib/chatMedia'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const POST_IMAGE_PATH = new RegExp(`^/api/storage/post-media/${UUID}/${UUID}\\.(?:png|jpg|webp|gif)$`, 'i')

function mediaOrigin(): string {
  try {
    return new URL(
      API_BASE,
      typeof window === 'undefined' ? 'https://tko.cam' : window.location.origin,
    ).origin
  } catch {
    return 'https://tko.cam'
  }
}

/** Only render immutable images returned by our own media proxy. */
export function isSafePostImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value, mediaOrigin())
    return parsed.origin === mediaOrigin() && POST_IMAGE_PATH.test(parsed.pathname)
  } catch {
    return false
  }
}

/** Upload after the post row exists so the server can verify its owner. */
export async function uploadPostImage(file: File, postId: string): Promise<string> {
  const uploaded = await uploadUserImage(file, postId, 'post')
  if (!isSafePostImageUrl(uploaded.url)) throw new Error('The server returned an invalid image URL.')
  return uploaded.url
}

/** Best-effort object cleanup used when a post is rolled back or deleted. */
export async function deletePostImage(url: string): Promise<void> {
  if (!isSafePostImageUrl(url)) return
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('kc_token')
  const response = await fetch(url, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Could not remove the stored image.')
  }
}
