import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const mode = vi.hoisted(() => ({ isDesktop: false, isStaticMode: false, defaultAutoConnect: true }))
vi.mock('@/bootstrap/deployment', () => ({ getDefaultAutoConnect: () => mode.defaultAutoConnect }))
vi.mock('@/utils/env', () => mode)
import { useConnectionSettingsStore } from '../connectionSettings'

beforeEach(() => {
  localStorage.clear()
  mode.defaultAutoConnect = true
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

it('uses the deployment default without persisting it as a user choice', () => {
  mode.defaultAutoConnect = false
  expect(useConnectionSettingsStore().shouldAutoConnect).toBe(false)
  expect(localStorage.getItem('connection.autoConnect')).toBeNull()
  mode.defaultAutoConnect = true
  setActivePinia(createPinia())
  expect(useConnectionSettingsStore().shouldAutoConnect).toBe(true)
})

it.each([true, false])('honors an explicit user preference of %s over the deployment default', value => {
  mode.defaultAutoConnect = !value
  localStorage.setItem('connection.autoConnect', String(value))
  expect(useConnectionSettingsStore().shouldAutoConnect).toBe(value)
})
