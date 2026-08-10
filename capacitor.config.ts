import type { CapacitorConfig } from '@capacitor/cli'

const nativeBrand = process.env.TKO_NATIVE_BRAND?.trim().toLowerCase()
const isShinobiLeague = nativeBrand === 'shinobistrikerleague'

const config: CapacitorConfig = {
  // TKO remains the default update line. A league store build opts into its
  // own immutable identity so one league can never overwrite another.
  appId: process.env.TKO_NATIVE_APP_ID
    || (isShinobiLeague ? 'com.shinobistrikerleague.app' : 'app.killcam'),
  appName: process.env.TKO_NATIVE_APP_NAME
    || (isShinobiLeague ? 'Shinobi Striker League' : 'TKO'),
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Store builds never need insecure subresources inside the HTTPS WebView.
    // Keeping this off prevents accidental HTTP video/API loads in production.
    allowMixedContent: false,
    // NOTE: the Android WebView still blocks muted-autoplay of the YouTube
    // iframes without a user gesture (there is no supported Capacitor config
    // flag to force it on). We do NOT rely on autoplay: the in-app
    // CenterPlayOverlay in SyncedYouTubeReel gives the viewer a TKO-branded
    // center tap target whose click IS the required gesture. See that file.
  },
}

export default config
