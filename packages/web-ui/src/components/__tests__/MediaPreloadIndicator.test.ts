import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { mediaEnvironment, preloadMedia } from '@/services/environmentMedia'
import MediaPreloadIndicator from '../MediaPreloadIndicator.vue'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('shows only sustained preload activity and stays visible until the last batch ends', async () => {
  vi.useFakeTimers()
  let respond!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(resolve => (respond = resolve))),
  )
  const indicator = mount(MediaPreloadIndicator)
  const environment = mediaEnvironment({ species: [], skills: [], marks: [] })
  const asset = { url: 'https://assets.test/indicator.swf', limit: 256 }
  const first = new AbortController()
  const pending = preloadMedia([asset], environment, first.signal)
  const shared = preloadMedia([asset], environment, new AbortController().signal)
  try {
    await nextTick()
    expect(indicator.text()).toBe('')
    await vi.advanceTimersByTimeAsync(200)
    expect(indicator.get('[role="status"]').text()).toBe('正在预载')
    first.abort()
    await pending
    expect(indicator.text()).toBe('正在预载')
    respond(new Response(Uint8Array.of(1, 2)))
    await shared
    await nextTick()
    expect(indicator.text()).toBe('')

    await preloadMedia([asset], environment, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(200)
    expect(indicator.text()).toBe('')
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    indicator.unmount()
  }
})

it('opens live resource details, revises the estimate on a stall and keeps the final result open', async () => {
  vi.useFakeTimers()
  const responses = new Map<string, (response: Response) => void>()
  vi.stubGlobal('fetch', (url: string) => new Promise<Response>(resolve => responses.set(url, resolve)))
  const indicator = mount(MediaPreloadIndicator, { attachTo: document.body })
  const environment = mediaEnvironment({ species: [], skills: [], marks: [] })
  const assets = ['迪兰 · SWF 动画', '迪兰 · 图标', '战斗背景', '战斗音乐'].map((label, i) => ({
    label,
    url: 'https://assets.test/details/' + i,
    limit: 256,
  }))
  const controller = new AbortController()
  const job = preloadMedia(assets, environment, controller.signal, undefined, '匹配队列')
  try {
    await vi.advanceTimersByTimeAsync(200)
    const trigger = indicator.get('button[aria-controls]')
    await trigger.trigger('click')
    const panel = indicator.get('section')
    const progress = panel.get('[role="progressbar"][aria-label="匹配队列"]')
    expect(progress.attributes('aria-valuemax')).toBe('4')
    expect(progress.attributes('aria-valuenow')).toBe('0')
    expect(panel.get('[aria-label="正在处理的资源"]').text()).toContain('迪兰 · SWF 动画')
    expect(panel.text()).toContain('正在估算剩余时间')
    await vi.advanceTimersByTimeAsync(1800)
    responses.get(assets[0]!.url)!(new Response('ok'))
    responses.get(assets[1]!.url)!(new Response(null, { status: 404 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(progress.attributes('aria-valuenow')).toBe('2')
    expect(panel.text()).toContain('预计还需约 5 秒')
    expect(panel.text()).toContain('失败 1 项')
    expect(panel.get('[aria-label="正在处理的资源"]').text()).toContain('战斗音乐')
    await vi.advanceTimersByTimeAsync(5000)
    expect(panel.text()).toContain('正在估算剩余时间')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(indicator.find('section').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    responses.get(assets[2]!.url)!(new Response('ok'))
    responses.get(assets[3]!.url)!(new Response('ok'))
    await job
    await nextTick()
    expect(indicator.get('section').text()).toContain('已处理 4 / 4')
    expect(indicator.get('section').text()).toContain('已结束')
    expect(indicator.find('[aria-label="正在处理的资源"]').exists()).toBe(false)
    await indicator.get('[aria-label="关闭预载详情"]').trigger('click')
    expect(indicator.text()).toBe('')
  } finally {
    controller.abort()
    await job
    indicator.unmount()
  }
})

it('reports concurrent batches independently and keeps cancelled work out of failure counts', async () => {
  vi.useFakeTimers()
  let respond!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(resolve => (respond = resolve))),
  )
  const indicator = mount(MediaPreloadIndicator)
  const environment = mediaEnvironment({ species: [], skills: [], marks: [] })
  const assets = [{ url: 'https://assets.test/pair.swf', limit: 256 }]
  const controller = new AbortController()
  const other = new AbortController()
  const jobs = [
    preloadMedia(assets, environment, controller.signal, undefined, '匹配预览'),
    preloadMedia(assets, environment, other.signal, undefined, '房间队伍'),
  ]
  try {
    await vi.advanceTimersByTimeAsync(200)
    await indicator.get('button[aria-controls]').trigger('click')
    controller.abort()
    await nextTick()
    const cancelled = indicator.get('[role="progressbar"][aria-label="匹配预览"]').element.closest('li')!
    expect(cancelled.textContent).toContain('已取消')
    expect(cancelled.textContent).not.toContain('失败')
    expect(indicator.get('[role="status"]').text()).toBe('正在预载')
    respond(new Response('ok'))
    await Promise.all(jobs)
    await nextTick()
    expect(indicator.get('[role="progressbar"][aria-label="房间队伍"]').attributes('aria-valuenow')).toBe('1')
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    controller.abort()
    other.abort()
    await Promise.all(jobs)
    indicator.unmount()
  }
})
