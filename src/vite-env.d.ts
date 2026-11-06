/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Node backend, e.g. https://api.example.com (no trailing slash). */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
