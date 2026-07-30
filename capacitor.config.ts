import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Keep the shipped Android identifier so TKO updates the existing app.
  appId: 'app.killcam',
  appName: 'TKO',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // allow the in-app browser to load http(s) console/app sites in the WebView
    allowMixedContent: true,
    // NOTE: the Android WebView still blocks muted-autoplay of the YouTube
    // iframes without a user gesture (there is no supported Capacitor config
    // flag to force it on). We do NOT rely on autoplay: the in-app
    // CenterPlayOverlay in SyncedYouTubeReel gives the viewer a TKO-branded
    // center tap target whose click IS the required gesture. See that file.
  },
}

export default config
