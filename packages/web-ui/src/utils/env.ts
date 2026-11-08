import type { ArcadiaDesktopApi } from '@/types/desktop'

export function getDesktopApi(): ArcadiaDesktopApi | null {
  if (typeof window === 'undefined') return null
  return window.arcadiaDesktop ?? null
}

export const isDesktop = getDesktopApi() !== null
export const isStaticMode = import.meta.env.VITE_STATIC_MODE === '1'
