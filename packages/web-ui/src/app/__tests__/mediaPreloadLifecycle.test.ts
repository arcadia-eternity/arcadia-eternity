import { shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { AppBootstrap } from '@/app/bootstrap'
import { installMediaPreload } from '@/app/mediaPreload'
import { loadDeploymentConfig } from '@/bootstrap/deployment'
import { setServerContentText } from '@/i18n/serverContent'
import { registerMediaEnvironment, setPackMedia } from '@/services/mediaLoader'
import { mediaPreloadBatches } from '@/services/mediaPreloadProgress'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('retries only failed environment assets with exponential delays without a router', async () => {
  vi.useFakeTimers()
  const catalog = { species: [], skills: [], marks: [] }
  const available = 'https://assets.test/available'
  const transient = 'https://assets.test/transient'
  registerMediaEnvironment(catalog, 'retry', [
    { id: 'available', source: available },
    { id: 'transient', source: transient },
  ])
  setServerContentText(catalog)
  let availableReads = 0
  const retries: number[] = []
  const start = Date.now()
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === available) availableReads++
    if (url === transient) {
      retries.push(Date.now() - start)
      if (retries.length <= 3) return new Response(null, { status: 503 })
    }
    return new Response('media')
  })
  const pinia = createPinia()
  const app = shallowMount({ render: () => null }, { global: { plugins: [pinia, [installMediaPreload, pinia]] } })
  try {
    await vi.advanceTimersByTimeAsync(15_000)
    expect(retries).toEqual([0, 1000, 3000, 7000])
    expect(availableReads).toBe(1)
    expect(mediaPreloadBatches.value[0]).toMatchObject({ state: 'finished', total: 1, failed: 0 })
  } finally {
    app.unmount()
    setServerContentText(null)
  }
})

it('replaces pending retries on a resource revision change and cancels them on app unmount', async () => {
  vi.useFakeTimers()
  const catalog = { species: [], skills: [], marks: [] }
  const oldUrl = 'https://assets.test/old-revision'
  const newUrl = 'https://assets.test/new-revision'
  registerMediaEnvironment(catalog, 'revision-1', [{ id: 'icon', source: oldUrl }])
  setServerContentText(catalog)
  const attempts: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    attempts.push(url)
    return new Response(null, { status: 503 })
  })
  const pinia = createPinia()
  const app = shallowMount({ render: () => null }, { global: { plugins: [pinia, [installMediaPreload, pinia]] } })
  try {
    await vi.advanceTimersByTimeAsync(500)
    registerMediaEnvironment(catalog, 'revision-2', [{ id: 'icon', source: newUrl }])
    await vi.advanceTimersByTimeAsync(1200)
    expect(attempts).toEqual([oldUrl, newUrl, newUrl])
  } finally {
    app.unmount()
    setServerContentText(null)
  }
  await vi.advanceTimersByTimeAsync(15_000)
  expect(attempts).toEqual([oldUrl, newUrl, newUrl])
})

it('starts the environment sweep on a direct local battle visit and keeps it running across navigation', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/local-battle', name: 'LocalBattle', component: {} },
      { path: '/team-builder', name: 'TeamBuilder', component: {} },
    ],
  })
  await router.push('/local-battle')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ schemaVersion: 1, backendOrigin: location.origin })))
  await loadDeploymentConfig()
  vi.spyOn(AppBootstrap.prototype, 'runAll').mockResolvedValue([])
  const read = Promise.withResolvers<Response>()
  const fetchMedia = vi.fn(() => read.promise)
  vi.stubGlobal('fetch', fetchMedia)
  const pinia = createPinia()
  const app = shallowMount(App, { global: { plugins: [router, pinia, [installMediaPreload, pinia], ElementPlus] } })
  try {
    const source = 'https://assets.test/unused-by-current-team'
    setPackMedia('local', [{ id: 'unused', source }], { species: [], skills: [], marks: [] })
    await vi.waitFor(() => expect(fetchMedia).toHaveBeenCalledWith(source, expect.anything()))
    const batch = mediaPreloadBatches.value.find(row => row.label === '环境全量预载')!
    expect(batch.state).toBe('active')
    await router.push('/team-builder')
    expect(batch.state).toBe('active')
    read.resolve(new Response('media'))
    await vi.waitFor(() => expect(batch.state).toBe('finished'))
    expect(batch.failed).toBe(0)
    expect(fetchMedia).toHaveBeenCalledOnce()
  } finally {
    app.unmount()
  }
})
