/// <reference types="vite/client" />

declare const __BASE_BATTLE_UI__: import('./scripts/build-web-content.mjs').BaseBattleUi

interface ImportMetaEnv {
  readonly VITE_MAX_CONCURRENT_BATTLES?: string
  readonly VITE_MAX_IDLE_WORKERS?: string
  readonly VITE_MAX_QUEUED_BATTLES?: string
  readonly VITE_BATTLE_QUEUE_TIMEOUT_MS?: string
}
