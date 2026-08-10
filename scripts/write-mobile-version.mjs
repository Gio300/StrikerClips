import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const versionCode = Number(process.env.TKO_VERSION_CODE)
const builtAt = Number(process.env.TKO_MOBILE_BUILT_AT || Date.now())

if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  throw new Error('TKO_VERSION_CODE must be a positive integer')
}

const manifest = {
  versionCode,
  versionName: process.env.TKO_VERSION_NAME || versionCode.toString(),
  buildId: process.env.VITE_BUILD_ID || `android-${versionCode}`,
  builtAt,
  apkUrl:
    process.env.VITE_DOWNLOAD_ANDROID ||
    'https://github.com/Gio300/StrikerClips/releases/latest/download/app-debug.apk',
}

const output = path.join(root, 'public', 'mobile-version.json')
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(
  `Prepared Android ${manifest.versionName} (${manifest.versionCode}) release manifest`,
)
