import { AVATAR_MAX_BYTES, AVATAR_SIZE_PX, dataUrlBytes } from '@/lib/avatar'

/**
 * avatarImage — the DOM half of profile pictures.
 *
 * Takes whatever the user picked (a 12 MP phone photo, typically) and produces
 * a centre-cropped AVATAR_SIZE_PX square JPEG data URL small enough to live in
 * `profiles.avatar_url`. Quality steps down until the result fits under
 * AVATAR_MAX_BYTES, so a busy photo doesn't sneak a huge blob into Postgres.
 *
 * Kept out of avatar.ts on purpose: that file is pure and unit-tested; this one
 * needs Image/canvas and only runs in the browser.
 */

const QUALITY_LADDER = [0.82, 0.7, 0.6, 0.5, 0.4]

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Downscale + centre-crop a picked image file to a square avatar data URL.
 * Throws with a human message when the file isn't an image or won't compress
 * small enough.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pick an image file (JPG, PNG or WebP).')
  }
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)

  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height)
  if (!side) throw new Error('That image looks empty.')
  const sx = ((img.naturalWidth || img.width) - side) / 2
  const sy = ((img.naturalHeight || img.height) - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE_PX
  canvas.height = AVATAR_SIZE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not process that image.')
  // Flatten onto the app background so transparent PNGs don't render black.
  ctx.fillStyle = '#0b0d12'
  ctx.fillRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)

  for (const q of QUALITY_LADDER) {
    const out = canvas.toDataURL('image/jpeg', q)
    if (dataUrlBytes(out) <= AVATAR_MAX_BYTES) return out
  }
  throw new Error('That image is too detailed to shrink — try a simpler picture.')
}
