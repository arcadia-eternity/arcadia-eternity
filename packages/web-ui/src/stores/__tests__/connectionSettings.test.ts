import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const mode = vi.hoisted(() => ({ isDesktop: false, isStaticMode: false }))
vi.mock('@/utils/env', () => mode)
import { useConnectionSettingsStore } from '../connectionSettings'

beforeEach(() => {
  localStorage.clear()
  mode.isDesktop = false
  mode.isStaticMode = false
  setActivePinia(createPinia())
})

it('defaults web deployments to automatic connection and persists opting out', () => {
  const settings = useConnectionSettingsStore()
  expect(settings.shouldAutoConnect).toBe(true)
  settings.autoConnect = false
  setActivePinia(createPinia())
  expect(useConnectionSettingsStore().shouldAutoConnect).toBe(false)
  useConnectionSettingsStore().autoConnect = true
  expect(localStorage.getItem('connection.autoConnect')).toBe('true')
})

it.each(['isDesktop', 'isStaticMode'] as const)('never auto-connects in local mode %s', modeKey => {
  mode[modeKey] = true
  localStorage.setItem('connection.autoConnect', 'true')
  expect(useConnectionSettingsStore().shouldAutoConnect).toBe(false)
})
