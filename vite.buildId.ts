import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Placeholder that public/sw.js ships with. It is rewritten to the real BUILD_ID
 * in the emitted output so (a) the worker's cache name is build-keyed and (b)
 * the script's bytes change every deploy — which is what makes the browser's
 * periodic registration.update() detect a new worker on a content-only build.
 */
const SW_BUILD_TOKEN = '__TKO_BUILD_ID__'

/**
 * Stamps every build with an id, so the running app can tell whether the server
 * is now serving something newer.
 *
 * Three outputs, on purpose:
 *   • `import.meta.env.VITE_BUILD_ID` — set on `process.env` before Vite
 *     resolves its env, so it is compiled into the JS chunk.
 *   • `<meta name="tko-build" content="…">` in the HTML shell — a second,
 *     independent source (src/lib/buildInfo.ts falls back to it), so one broken
 *     define does not silently disable the whole update prompt.
 *   • `version.json` next to the bundle — what the running app polls. Only the
 *     APP build emits it; the marketing site build reuses the app's, so there is
 *     exactly one authority on "what is live".
 *
 * The id is `BUILD_ID`/`VITE_BUILD_ID` from the environment when CI supplies one
 * (e.g. a git sha), otherwise a base-36 timestamp — monotonic, and different for
 * every build, which is all the comparison needs.
 */
export function resolveBuildId(env: NodeJS.ProcessEnv = process.env): string {
  const supplied = (env.VITE_BUILD_ID || env.BUILD_ID || '').trim()
  if (supplied) return supplied
  return Date.now().toString(36)
}

export interface BuildIdPluginOptions {
  buildId: string
  builtAt?: number
  /** Emit `version.json` into the output. App build only. */
  emitVersionFile?: boolean
}

export function buildIdPlugin({
  buildId,
  builtAt = Date.now(),
  emitVersionFile = false,
}: BuildIdPluginOptions): Plugin {
  // Captured from configResolved so closeBundle can find the emitted sw.js on
  // disk (public/ files are copied by Vite AFTER generateBundle, so they can only
  // be rewritten once the build has flushed — hence closeBundle, not
  // generateBundle).
  let outAbsDir = ''

  return {
    name: 'tko-build-id',
    configResolved(config) {
      outAbsDir = path.resolve(config.root, config.build.outDir)
    },
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: 'tko-build', content: buildId }, injectTo: 'head' as const },
      ]
    },
    generateBundle() {
      if (!emitVersionFile) return
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt }, null, 2),
      })
    },
    async closeBundle() {
      // Stamp the copied public/sw.js with this build's id. Best-effort: an
      // absent sw.js (e.g. a build that ships no worker) is not an error.
      if (!outAbsDir) return
      const swPath = path.join(outAbsDir, 'sw.js')
      try {
        const src = await readFile(swPath, 'utf8')
        if (!src.includes(SW_BUILD_TOKEN)) return
        await writeFile(swPath, src.split(SW_BUILD_TOKEN).join(buildId))
      } catch {
        /* no sw.js in this output — nothing to stamp. */
      }
    },
  }
}
