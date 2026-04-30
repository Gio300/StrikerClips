/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_CREATION_AD_SECONDS?: string
  readonly VITE_DEV_PREMIUM?: string
  readonly VITE_ADSENSE_CLIENT?: string
  readonly VITE_ADSENSE_CREATE_GATE?: string
  readonly VITE_ADSENSE_EXPORT_GATE?: string
  readonly VITE_FACEBOOK_APP_ID?: string
  readonly VITE_BASE_PATH?: string
  readonly VITE_DOWNLOAD_WIN?: string
  readonly VITE_DOWNLOAD_MAC?: string
  readonly VITE_DOWNLOAD_LINUX?: string
  readonly VITE_DOWNLOAD_IOS?: string
  readonly VITE_DOWNLOAD_ANDROID?: string
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
