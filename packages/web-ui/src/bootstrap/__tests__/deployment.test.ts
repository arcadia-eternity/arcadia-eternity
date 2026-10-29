import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  delete window.arcadiaDesktop
  delete (window as typeof window & { arcadiaRemotePlay?: unknown }).arcadiaRemotePlay
  sessionStorage.clear()
})

it('binds all browser endpoints before stores initialize and ignores historical selection and URL parameters', async () => {
  const request = vi.fn(
    async () => new Response(JSON.stringify({ schemaVersion: 1, backendOrigin: 'https://paired.test' })),
  )
  vi.stubGlobal('fetch', request)
  sessionStorage.setItem('arcadia-selected-server', 'https://attacker.test')
  window.history.replaceState({}, '', '/?server=https://attacker.test')
  const deployment = await import('../deployment')
  await deployment.loadDeploymentConfig()
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/auth')
  const auth = useAuthStore()
  expect(auth.serverUrl).toBe('https://paired.test')
  expect(deployment.canSelectBackend()).toBe(false)
  expect(() => auth.checkServerUrl('https://attacker.test')).toThrow('配对')
  expect(() => auth.setServerUrl('https://attacker.test')).toThrow('配对')
  expect(request).toHaveBeenCalledWith('/arcadia-client.json', { cache: 'no-store', redirect: 'error' })
})
it('rejects missing, invalid, mixed-content and credentialed configuration', async () => {
  const { parseDeploymentConfig } = await import('../deployment')
  for (const backendOrigin of ['', 'ftp://host', 'https://name:secret@host', 'https://host/api', 'http://host']) {
    expect(() => parseDeploymentConfig({ schemaVersion: 1, backendOrigin }, 'https://site.test')).toThrow()
  }
  expect(() => parseDeploymentConfig({ schemaVersion: 2, backendOrigin: '/' }, 'https://site.test')).toThrow()
  expect(parseDeploymentConfig({ schemaVersion: 1, backendOrigin: '/' }, 'https://site.test').backendOrigin).toBe(
    'https://site.test',
  )
})
it('uses only host supplied remote window configuration without permitting switches', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  Object.assign(window, {
    arcadiaRemotePlay: {
      getBootConfig: async () => ({
        schemaVersion: 1,
        backendOrigin: 'http://remote.test',
        mode: 'remote-play',
        sessionId: 'window',
      }),
    },
  })
  const deployment = await import('../deployment')
  await deployment.loadDeploymentConfig()
  expect(deployment.getBackendOrigin()).toBe('http://remote.test')
  expect(deployment.canSelectBackend()).toBe(false)
  expect(() => deployment.checkBackendSelection('http://other.test')).toThrow()
  expect(request).not.toHaveBeenCalled()
})
it('fails closed on a missing configuration response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  )
  const deployment = await import('../deployment')
  await expect(deployment.loadDeploymentConfig()).rejects.toThrow('404')
  expect(() => deployment.getBackendOrigin()).toThrow('尚未加载')
})

it('manager permits only the exact host reported by its main process', async () => {
  Object.assign(window, {
    arcadiaDesktop: {
      getBackendConfig: async () => ({ schemaVersion: 1, backendOrigin: 'https://official.test' }),
      getLocalBattleStatus: async () => ({
        status: 'running',
        url: 'http://127.0.0.1:9999',
        serverId: 'local',
        projectName: 'demo',
      }),
    },
  })
  const deployment = await import('../deployment')
  await deployment.loadDeploymentConfig()
  expect(deployment.canSelectBackend()).toBe(true)
  expect(() => deployment.checkBackendSelection('http://127.0.0.1:9999')).not.toThrow()
  expect(() => deployment.checkBackendSelection('http://127.0.0.1:8888')).toThrow()
  expect(() => deployment.checkBackendSelection('http://localhost:9999')).toThrow()
  Object.assign(window.arcadiaDesktop!, { getLocalBattleStatus: async () => ({ status: 'idle' }) })
  await deployment.authorizeLocalBackend()
  expect(() => deployment.checkBackendSelection('http://127.0.0.1:9999')).toThrow()
})
