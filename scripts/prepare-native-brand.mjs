import { cp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requested = (process.env.TKO_NATIVE_BRAND || process.argv[2] || '').trim().toLowerCase()
const platforms = new Set(
  (process.env.TKO_NATIVE_PLATFORMS || 'android,ios')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
)

if (!requested) {
  throw new Error('Set TKO_NATIVE_BRAND or pass a brand slug.')
}

const brandDir = path.join(root, 'native-brands', requested)
const brandFile = path.join(brandDir, 'brand.json')
if (!existsSync(brandFile)) {
  throw new Error(`Unknown native brand: ${requested}`)
}

const brand = JSON.parse(await readFile(brandFile, 'utf8'))

async function replace(file, transforms) {
  let value = await readFile(file, 'utf8')
  for (const [pattern, replacement] of transforms) value = value.replace(pattern, replacement)
  await writeFile(file, value, 'utf8')
}

async function prepareAndroid() {
  const android = path.join(root, 'android', 'app')
  if (!existsSync(android)) return false

  await replace(path.join(android, 'build.gradle'), [
    [/applicationId\s+"[^"]+"/, `applicationId "${brand.appId}"`],
  ])
  await replace(path.join(android, 'src', 'main', 'res', 'values', 'strings.xml'), [
    [/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${brand.appName}</string>`],
    [/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${brand.appName}</string>`],
    [/<string name="package_name">[^<]*<\/string>/, `<string name="package_name">${brand.appId}</string>`],
    [/<string name="custom_url_scheme">[^<]*<\/string>/, `<string name="custom_url_scheme">${brand.androidDeepLinkScheme}</string>`],
  ])
  await replace(path.join(android, 'src', 'main', 'AndroidManifest.xml'), [
    [/android:scheme="[^"]+"\s+android:host="auth"/, `android:scheme="${brand.androidDeepLinkScheme}" android:host="auth"`],
  ])
  await cp(path.join(brandDir, 'android', 'res'), path.join(android, 'src', 'main', 'res'), {
    recursive: true,
    force: true,
  })
  return true
}

async function prepareIos() {
  const ios = path.join(root, 'ios', 'App')
  if (!existsSync(ios)) return false

  await replace(path.join(ios, 'App', 'Info.plist'), [
    [/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${brand.appName}$2`],
    [/(<key>CFBundleURLName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${brand.appId}.auth$2`],
    [/(<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>)[^<]*(<\/string>)/, `$1${brand.androidDeepLinkScheme}$2`],
    [/TKO uses the camera/g, `${brand.appName} uses the camera`],
    [/TKO uses the microphone/g, `${brand.appName} uses the microphone`],
    [/TKO accesses selected photos and videos/g, `${brand.appName} accesses selected photos and videos`],
    [/TKO saves exported clips/g, `${brand.appName} saves exported clips`],
  ])
  await replace(path.join(ios, 'App.xcodeproj', 'project.pbxproj'), [
    [/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${brand.appId};`],
  ])

  const icon = path.join(brandDir, 'ios', 'app-icon-1024.png')
  await cp(icon, path.join(ios, 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'), { force: true })
  const splash = path.join(brandDir, 'ios', 'splash-2732.png')
  const splashDir = path.join(ios, 'App', 'Assets.xcassets', 'Splash.imageset')
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await cp(splash, path.join(splashDir, name), { force: true })
  }
  return true
}

const [androidPrepared, iosPrepared] = await Promise.all([
  platforms.has('android') ? prepareAndroid() : false,
  platforms.has('ios') ? prepareIos() : false,
])
if (!androidPrepared && !iosPrepared) {
  throw new Error('No Android or iOS native project is present.')
}

console.log(JSON.stringify({
  brand: requested,
  appId: brand.appId,
  appName: brand.appName,
  androidPrepared,
  iosPrepared,
}))
