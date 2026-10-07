import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import Tooltip from '../Tooltip.vue'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('battle detail portal', () => {
  it('renders outside a scrolling card strip and keeps details within the viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 5,
        right: 100,
        bottom: 55,
        width: this.classList.contains('fixed') ? 300 : 100,
        height: this.classList.contains('fixed') ? 200 : 50,
        toJSON() {},
      }
    })
    const wrapper = mount(Tooltip, {
      attachTo: document.body,
      props: { portal: true, position: 'top' },
      slots: { trigger: '<button>详情</button>', default: '完整技能说明' },
    })
    await wrapper.get('.relative.inline-block').trigger('mouseenter')
    await nextTick()
    await nextTick()
    const detail = document.body.querySelector('.fixed') as HTMLElement
    expect(wrapper.element.contains(detail)).toBe(false)
    expect(document.body.contains(detail)).toBe(true)
    expect(detail.style.left).toBe('8px')
    expect(detail.style.top).toBe('8px')
    expect(detail.textContent).toContain('完整技能说明')
    wrapper.unmount()
  })
  it.each(['left', 'right'] as const)('places side details on the %s of their scaled anchor', async position => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const tooltip = this.classList.contains('fixed')
      return {
        left: 500,
        right: 540,
        top: 100,
        bottom: 140,
        width: tooltip ? 100 : 40,
        height: tooltip ? 80 : 40,
        x: 500,
        y: 100,
        toJSON() {},
      }
    })
    const wrapper = mount(Tooltip, {
      attachTo: document.body,
      props: { portal: true, position },
      slots: { trigger: '<button>精灵</button>', default: '精灵详情' },
    })
    await wrapper.get('.relative.inline-block').trigger('mouseenter')
    await nextTick()
    await nextTick()
    const detail = document.body.querySelector('.fixed') as HTMLElement
    expect(detail.style.left).toBe(position === 'left' ? '392px' : '548px')
    expect(detail.style.top).toBe('80px')
    wrapper.unmount()
  })
  it('dismisses a manually opened detail with Escape and updates its control', async () => {
    const wrapper = mount(Tooltip, {
      props: { show: true, trigger: 'click' },
      slots: { trigger: '<button>详情</button>' },
    })
    await wrapper.get('button').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:show')).toEqual([[false]])
    wrapper.unmount()
  })
})
