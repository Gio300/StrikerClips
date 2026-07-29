import { basename, dirname, resolve } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

const root = resolve(process.cwd())
const dist = resolve(root, 'dist')
const target = resolve(dist, 'videos')

if (dirname(target) !== dist || basename(target) !== 'videos') {
  throw new Error(`Refusing to prune unexpected path: ${target}`)
}

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true })
  console.log(`[mobile] removed bundled showcase videos: ${target}`)
}
