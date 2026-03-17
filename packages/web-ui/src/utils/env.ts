import type { ArcadiaDesktopApi } from '@/types/desktop'

export function getDesktopApi(): ArcadiaDesktopApi | null {
  if (typeof window === 'undefined') return null
  return window.arcadiaDesktop ?? null
}

export const isDesktop = getDesktopApi() !== null

export function onDesktop<T>(cb: () => T) {
  if (isDesktop) return cb()
}

export function onWeb<T>(cb: () => T) {
  if (!isDesktop) return cb()
}

export function runInEnv<T>(implementations: { desktop: () => T; web: () => T }): T {
  if (isDesktop) return implementations.desktop()
  return implementations.web()
}
