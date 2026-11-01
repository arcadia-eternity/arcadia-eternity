import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthorDescription from '../AuthorDescription'

describe('author description mark references', () => {
  it.each([
    [[], 'markName'],
    [['status'], 'status'],
    [['exceptional'], 'status'],
    [['xinzhiyinji_tag'], 'markName'],
  ] as const)('keeps %j in its display category and preserves navigation', async (tags, kind) => {
    const wrapper = mount(AuthorDescription, {
      props: {
        text: '<mark>demo:mark</mark>',
        language: 'zh-CN',
        context: {},
        marks: [{ id: 'mark', reference: 'demo:mark', name: '测试印记', tags }],
      },
    })
    try {
      expect(wrapper.get('button').attributes('data-description-kind')).toBe(kind)
      await wrapper.get('button').trigger('click')
      expect(wrapper.emitted('mark')).toEqual([['mark']])
      await wrapper.setProps({ interactive: false })
      expect(wrapper.get('span').attributes('data-description-kind')).toBe(kind)
      expect(wrapper.find('button').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it.each(['slow', 'my-pack:slow'])('resolves %s to the local mark and its translated name', async id => {
    const wrapper = mount(AuthorDescription, {
      props: {
        text: `施加 <mark>${id}</mark>，威力 {power}。`,
        language: 'zh-CN',
        context: { power: 63 },
        marks: [{ id: 'slow', reference: 'my-pack:slow', name: '减速' }],
      },
    })
    try {
      expect(wrapper.text()).toContain('63')
      expect(wrapper.get('button').text()).toBe('减速')
      await wrapper.get('button').trigger('click')
      expect(wrapper.emitted('mark')).toEqual([['slow']])
    } finally {
      wrapper.unmount()
    }
  })

  it('does not resolve a dependency reference to a same-named local mark', async () => {
    const wrapper = mount(AuthorDescription, {
      props: {
        text: '<mark>other:slow</mark>',
        language: 'zh-CN',
        context: {},
        marks: [{ id: 'slow', reference: 'my-pack:slow', name: '减速' }],
      },
    })
    try {
      expect(wrapper.get('button').text()).toBe('other:slow')
      await wrapper.get('button').trigger('click')
      expect(wrapper.emitted('mark')).toEqual([['other:slow']])
    } finally {
      wrapper.unmount()
    }
  })
})
