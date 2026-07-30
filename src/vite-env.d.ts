/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_MOCK_BACKEND?: string
  readonly VITE_REAL_BACKEND?: string
  /** Absolute origin of the Express API for non-same-origin builds (the APK). */
  readonly VITE_API_BASE?: string
  readonly VITE_CREATION_AD_SECONDS?: string
  readonly VITE_DEV_PREMIUM?: string
  readonly VITE_ADSENSE_CLIENT?: string
  readonly VITE_ADSENSE_CREATE_GATE?: string
  readonly VITE_ADSENSE_EXPORT_GATE?: string
  readonly VITE_FACEBOOK_APP_ID?: string
  readonly VITE_BASE_PATH?: string
  /** Per-build stamp injected by vite.buildId.ts; drives the update prompt. */
  readonly VITE_BUILD_ID?: string
  readonly VITE_DOWNLOAD_WIN?: string
  readonly VITE_DOWNLOAD_MAC?: string
  readonly VITE_DOWNLOAD_LINUX?: string
  readonly VITE_DOWNLOAD_IOS?: string
  readonly VITE_DOWNLOAD_ANDROID?: string
  /** Absolute Android release manifest URL used by the installed APK. */
  readonly VITE_MOBILE_VERSION_URL?: string
  /** Explicitly enables direct APK updates for sideload builds only. */
  readonly VITE_ANDROID_SIDELOAD_UPDATES?: string
  readonly VITE_SITE_BASE?: string
  readonly VITE_APP_URL?: string
  readonly VITE_CONTACT_EMAIL?: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string
  readonly VITE_YOUTUBE_AUTOUPLOAD?: string
  readonly VITE_OCR_MATCH_RESULTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
