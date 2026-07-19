import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.killcam',
  appName: 'KillCam',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // allow the in-app browser to load http(s) console/app sites in the WebView
    allowMixedContent: true,
  },
}

export default config
