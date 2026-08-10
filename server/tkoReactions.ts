import { createHash } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import reactionData from './tkoReactions.json'

export type TkoReaction = {
  id: string
  text: string
  tags: string[]
  delivery: string
  voice: string
}

export type ReactionAudio = {
  reaction: TkoReaction
  file: string
  fraction: number
}

export const TKO_REACTIONS = reactionData as TkoReaction[]

const VOICE_IDS: Record<string, string> = {
  hype: 'iP95p4xoKVk53GoZ742B',
  shout: 'CwhRBWXzGAHq8TQ4Fs17',
  crowd: 'TX3LPaxmHKxFdv7VOQHJ',
  analyst: 'bIHbv24MWmeRgasZH58o',
  sing: 'pNInz6obpgDQGcFmaJgB',
}

const DELIVERY_SETTINGS: Record<string, { stability: number; similarity_boost: number; style: number }> = {
  hype: { stability: 0.27, similarity_boost: 0.78, style: 0.78 },
  shout: { stability: 0.20, similarity_boost: 0.76, style: 0.92 },
  scream: { stability: 0.16, similarity_boost: 0.74, style: 0.96 },
  scared: { stability: 0.24, similarity_boost: 0.76, style: 0.88 },
  sing: { stability: 0.30, similarity_boost: 0.72, style: 0.90 },
  calm: { stability: 0.58, similarity_boost: 0.80, style: 0.40 },
}

function stableSeed(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0)
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function choose(
  tags: string[],
  random: () => number,
  used: Set<string>,
): TkoReaction {
  const wanted = new Set(tags)
  let candidates = TKO_REACTIONS.filter(
    (reaction) => !used.has(reaction.id) && reaction.tags.some((tag) => wanted.has(tag)),
  )
  if (candidates.length === 0) {
    candidates = TKO_REACTIONS.filter((reaction) => !used.has(reaction.id))
  }
  if (candidates.length === 0) {
    used.clear()
    candidates = [...TKO_REACTIONS]
  }
  const weighted = candidates.flatMap((reaction) => {
    const score = Math.max(1, reaction.tags.filter((tag) => wanted.has(tag)).length)
    return Array.from({ length: score }, () => reaction)
  })
  const selected = weighted[Math.floor(random() * weighted.length)] ?? weighted[0]
  used.add(selected.id)
  return selected
}

export function selectVideoReactions(seed: string, maxCount = 3): Array<{
  reaction: TkoReaction
  fraction: number
}> {
  const count = Math.max(0, Math.min(3, Math.floor(maxCount)))
  if (count === 0) return []
  const random = seededRandom(stableSeed(seed))
  const used = new Set<string>()
  const full = [
    { reaction: choose(['opening', 'live', 'hype'], random, used), fraction: 0.10 },
    { reaction: choose(['knockout', 'replay', 'hype'], random, used), fraction: 0.45 },
    { reaction: choose(['victory', 'closing', 'mvp'], random, used), fraction: 0.92 },
  ]
  if (count === 1) return [full[1]]
  if (count === 2) return [full[1], full[2]]
  return full
}

async function existingAudio(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 1_000
  } catch {
    return false
  }
}

async function synthesizeReaction(
  reaction: TkoReaction,
  cacheDir: string,
  apiKey: string,
): Promise<string> {
  const model = process.env.TKO_ELEVENLABS_MODEL || 'eleven_multilingual_v2'
  const voiceId = VOICE_IDS[reaction.voice] || VOICE_IDS.hype
  const digest = createHash('sha256')
    .update(`${reaction.text}|${reaction.delivery}|${voiceId}|${model}`)
    .digest('hex')
    .slice(0, 10)
  const target = join(cacheDir, `${reaction.id}-${digest}.mp3`)
  if (await existingAudio(target)) return target

  const settings = DELIVERY_SETTINGS[reaction.delivery] || DELIVERY_SETTINGS.hype
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: reaction.text,
        model_id: model,
        voice_settings: { ...settings, use_speaker_boost: true },
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.byteLength < 1_000) throw new Error(`ElevenLabs returned only ${audio.byteLength} bytes`)
  const temporary = `${target}.${process.pid}.part`
  await writeFile(temporary, audio)
  await rename(temporary, target)
  return target
}

export async function buildVideoReactionAudio(seed: string, maxCount = 3): Promise<ReactionAudio[]> {
  if (maxCount <= 0) return []
  const apiKey = process.env.TKO_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.warn('[reaction] no ElevenLabs key; fallback worker will keep game audio only')
    return []
  }
  const cacheDir = process.env.TKO_REACTION_CACHE_DIR || join(tmpdir(), 'tko-reaction-cache')
  await mkdir(cacheDir, { recursive: true })
  const output: ReactionAudio[] = []
  for (const selected of selectVideoReactions(seed, maxCount)) {
    try {
      const file = await synthesizeReaction(selected.reaction, cacheDir, apiKey)
      output.push({ ...selected, file })
      console.log(
        `[reaction] ${Math.round(selected.fraction * 100)}% ` +
        `${selected.reaction.id}: ${selected.reaction.text}`,
      )
    } catch (error) {
      console.warn(
        `[reaction] ${selected.reaction.id} synthesis failed:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
  return output
}
