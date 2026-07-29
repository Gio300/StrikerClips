import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const videosDir = path.resolve('dist', 'videos')

let entries = []
try {
  entries = await readdir(videosDir, { withFileTypes: true })
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0)
  throw error
}

await Promise.all(
  entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
    .map((entry) => rm(path.join(videosDir, entry.name))),
)
