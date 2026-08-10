import { API_BASE } from '@/lib/apiBase'

const PREFIX = '[[tko-image:v1:'
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_UPLOAD_BYTES = 2_500_000
const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type ChatImage = { url: string; alt: string }
export type UserImageScope = 'dm' | 'channel' | 'stream' | 'tournament' | 'post'

function cleanAlt(value: string): string {
  return value.replace(/[|\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Shared image'
}

function mediaOrigin(): string {
  try {
    return new URL(API_BASE, typeof window === 'undefined' ? 'https://tko.cam' : window.location.origin).origin
  } catch {
    return 'https://tko.cam'
  }
}

export function encodeChatImage(image: ChatImage): string {
  const parsed = new URL(image.url, mediaOrigin())
  if (parsed.origin !== mediaOrigin() || !parsed.pathname.startsWith('/api/storage/chat-media/')) {
    throw new Error('Unsupported chat image URL.')
  }
  return `${PREFIX}${parsed.href}|${cleanAlt(image.alt)}]]`
}

export function parseChatImage(value: string): ChatImage | null {
  if (!value.startsWith(PREFIX) || !value.endsWith(']]')) return null
  const payload = value.slice(PREFIX.length, -2)
  const split = payload.indexOf('|')
  if (split < 1) return null
  try {
    const parsed = new URL(payload.slice(0, split), mediaOrigin())
    if (parsed.origin !== mediaOrigin() || !parsed.pathname.startsWith('/api/storage/chat-media/')) return null
    return { url: parsed.href, alt: cleanAlt(payload.slice(split + 1)) }
  } catch {
    return null
  }
}

async function imageForUpload(file: File): Promise<Blob> {
  if (!SAFE_IMAGE_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG, WebP, or GIF image.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Choose an image smaller than 8 MB.')
  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a GIF smaller than 2.5 MB.')
    return file
  }
  if (file.size <= MAX_UPLOAD_BYTES) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error('This image is still too large after resizing.')
  return blob
}

async function asBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function uploadUserImage(
  file: File,
  roomId: string,
  scope: UserImageScope,
): Promise<ChatImage> {
  if (!roomId) throw new Error(scope === 'post' ? 'Create the post first.' : 'Open a chat first.')
  const blob = await imageForUpload(file)
  const token = localStorage.getItem('kc_token')
  const response = await fetch(`${API_BASE}/storage/chat-media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      // `conversationId` keeps older DM-only servers compatible while the
      // typed target lets the current server authorize every chat surface and
      // post attachment against the actual row it belongs to.
      conversationId: scope === 'dm' ? roomId : undefined,
      roomId,
      scope,
      name: file.name,
      contentType: blob.type || file.type,
      data: await asBase64(blob),
    }),
  })
  const result = await response.json().catch(() => ({})) as { path?: string; error?: string }
  if (!response.ok || !result.path) throw new Error(result.error || 'Could not upload the image.')
  return {
    url: new URL(`${API_BASE}${result.path}`, window.location.origin).href,
    alt: file.name.replace(/\.[^.]+$/, ''),
  }
}

export function uploadChatImage(
  file: File,
  roomId: string,
  scope: Exclude<UserImageScope, 'post'> = 'dm',
): Promise<ChatImage> {
  return uploadUserImage(file, roomId, scope)
}
