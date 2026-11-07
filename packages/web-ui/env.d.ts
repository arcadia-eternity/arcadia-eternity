/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAX_CONCURRENT_BATTLES?: string
  readonly VITE_MAX_IDLE_WORKERS?: string
  readonly VITE_MAX_QUEUED_BATTLES?: string
  readonly VITE_BATTLE_QUEUE_TIMEOUT_MS?: string
}
