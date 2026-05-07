import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render } from 'vue'
import { AnimationGsapManager } from '../animationGsapManager'

vi.mock('gsap', () => {
  const timeline = vi.fn(() => ({ kill: vi.fn() }))
  const to = vi.fn(() => ({ kill: vi.fn() }))
  return { default: { timeline, to } }
})

vi.mock('vue', () => ({
  render: vi.fn(),
}))

describe('AnimationGsapManager', () => {
  let gsapManager: AnimationGsapManager
  let mockStateMachine: {
    registerTween: ReturnType<typeof vi.fn>
    unregisterTween: ReturnType<typeof vi.fn>
    incrementTempDom: ReturnType<typeof vi.fn>
    decrementTempDom: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    gsapManager = new AnimationGsapManager()
    mockStateMachine = {
      registerTween: vi.fn(),
      unregisterTween: vi.fn(),
      incrementTempDom: vi.fn(),
      decrementTempDom: vi.fn(),
    }
    gsapManager.attach(mockStateMachine)
  })

  test('createTimeline registers tween and calls stateMachine.registerTween', () => {
    const id = `timeline-${Date.now()}-1`
    gsapManager.createTimeline({ id })
    expect(mockStateMachine.registerTween).toHaveBeenCalledWith(id)
  })

  test('createTween registers tween and calls stateMachine.registerTween', () => {
    const id = `tween-${Date.now()}-2`
    gsapManager.createTween({}, { id })
    expect(mockStateMachine.registerTween).toHaveBeenCalledWith(id)
  })

  test('registerTempHost adds DOM element to tracking set', () => {
    const host = document.createElement('div')
    gsapManager.registerTempHost(host)
    expect(mockStateMachine.incrementTempDom).toHaveBeenCalled()
    expect(gsapManager.getActiveCount()).toBe(0)
  })

  test('removeTempHost removes DOM element from tracking set', () => {
    const host = document.createElement('div')
    gsapManager.registerTempHost(host)
    gsapManager.removeTempHost(host)
    expect(mockStateMachine.decrementTempDom).toHaveBeenCalled()
  })

  test('killAll kills all tweens', () => {
    const id1 = `tween-${Date.now()}-kill1`
    const id2 = `tween-${Date.now()}-kill2`
    const tween1 = gsapManager.createTween({}, { id: id1 })
    const tween2 = gsapManager.createTween({}, { id: id2 })
    gsapManager.killAll()
    expect(tween1.kill).toHaveBeenCalled()
    expect(tween2.kill).toHaveBeenCalled()
  })

  test('killAll cleans up all temp DOM hosts', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    gsapManager.registerTempHost(host)
    gsapManager.killAll()
    expect(render).toHaveBeenCalledWith(null, host)
    expect(parent.contains(host)).toBe(false)
  })

  test('getActiveCount returns count of registered tweens', () => {
    expect(gsapManager.getActiveCount()).toBe(0)
    gsapManager.createTween({}, { id: `tween-${Date.now()}-count1` })
    expect(gsapManager.getActiveCount()).toBe(1)
    gsapManager.createTween({}, { id: `tween-${Date.now()}-count2` })
    expect(gsapManager.getActiveCount()).toBe(2)
  })

  test('isAnyActive returns true when tweens exist, false when empty', () => {
    expect(gsapManager.isAnyActive()).toBe(false)
    gsapManager.createTween({}, { id: `tween-${Date.now()}-active` })
    expect(gsapManager.isAnyActive()).toBe(true)
    gsapManager.killAll()
    expect(gsapManager.isAnyActive()).toBe(false)
  })

  test('reset calls killAll and clears tempHosts', () => {
    const id = `tween-${Date.now()}-reset`
    const tween = gsapManager.createTween({}, { id })
    const host = document.createElement('div')
    gsapManager.registerTempHost(host)
    gsapManager.reset()
    expect(tween.kill).toHaveBeenCalled()
    expect(render).toHaveBeenCalledWith(null, host)
    expect(gsapManager.getActiveCount()).toBe(0)
    expect(gsapManager.isAnyActive()).toBe(false)
  })
})
