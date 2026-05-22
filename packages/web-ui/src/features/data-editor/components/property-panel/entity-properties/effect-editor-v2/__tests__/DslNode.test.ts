import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DslNode from '../DslNode.vue'

describe('DslNode nullable optional value', () => {
  it('should render "未设置" placeholder when nullable=true, kind=value, modelValue=undefined', () => {
    const wrapper = mount(DslNode, {
      props: {
        kind: 'value',
        modelValue: undefined,
        nullable: true,
        label: '测试字段',
      },
    })

    expect(wrapper.text()).toContain('未设置')
    expect(wrapper.text()).not.toContain('缺少数据')
  })
})
