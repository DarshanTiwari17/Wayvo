/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SUPABASE_EMAIL_REDIRECT_URL?: string
  readonly VITE_WAYVO_HERO_IMAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
