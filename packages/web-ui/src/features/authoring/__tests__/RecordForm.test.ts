import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RecordForm from '../RecordForm.vue'
import type { ContentRow, SharedField } from '../types'

const shared = (path: (string | number)[], reason: SharedField['reason'] = 'alias'): SharedField => ({
  path,
  reason,
  anchor: 'status',
  sourcePath: [0, 'config'],
  line: 5,
  column: 5,
})
const form = (record: ContentRow, sharedFields: SharedField[], kind = 'marks') =>
  mount(RecordForm, {
    props: { record, kind, sharedFields, records: [], projectId: 'test', assets: [] },
  })

describe('shared YAML fields', () => {
  it('shows the existing element icon while localized choices retain their schema values', async () => {
    const wrapper = form({ id: 'hit', element: 'Water', category: 'Physical' }, [], 'skills')
    try {
      expect(wrapper.get('.element-icon').attributes('alt')).toBe('Water')
      await wrapper.get('select[aria-label="属性"]').setValue('Fire')
      expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({ element: 'Fire', category: 'Physical' })
      await wrapper.get('select[aria-label="类别"]').setValue('Special')
      expect(wrapper.emitted('change')?.[1]?.[0]).toMatchObject({ element: 'Water', category: 'Special' })
      expect(wrapper.get('option[value="Special"]').text()).toBe('特攻')
      await wrapper.setProps({ record: { id: 'hit', element: 'Fire', category: 'Special' } })
      expect(wrapper.get('.element-icon').attributes('alt')).toBe('Fire')
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps shared values visible, allows an independent edit and locates the source definition', async () => {
    const wrapper = form({ id: 'burn', name: 'Burn', config: { duration: 3, maxStacks: 6, stackable: true } }, [
      shared(['config']),
    ])
    try {
      const numbers = wrapper.findAll('input[type="number"]')
      expect(numbers.map(input => (input.element as HTMLInputElement).value)).toEqual(['3', '6'])
      expect(numbers.every(input => input.attributes('disabled') !== undefined)).toBe(true)
      expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
      await wrapper.get('.fields input').setValue('New name')
      expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({ name: 'New name', config: { duration: 3 } })
      await wrapper.get('.sharing button').trigger('click')
      expect(wrapper.emitted('external')).toEqual([[5, 5]])
    } finally {
      wrapper.unmount()
    }
  })

  it('allows a local merge override while keeping inherited siblings read-only', async () => {
    const wrapper = form({ id: 'burn', config: { duration: 5, maxStacks: 6 } }, [
      shared(['config', 'maxStacks'], 'merge'),
    ])
    try {
      const [duration, stacks] = wrapper.findAll('input[type="number"]')
      expect(duration!.attributes('disabled')).toBeUndefined()
      expect(stacks!.attributes('disabled')).toBeDefined()
      await duration!.setValue('7')
      expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({ config: { duration: 7, maxStacks: 6 } })
    } finally {
      wrapper.unmount()
    }
  })

  it('locks a shared definition itself and blocks structural edits to a reference list containing aliases', async () => {
    const wrapper = form(
      { id: 'pet', name: 'Pet', learnable_skills: [{ skill_id: 'hit', level: 1, hidden: false }] },
      [shared(['learnable_skills', 0])],
      'species',
    )
    try {
      const remove = wrapper.findAll('button').find(button => button.text() === '移除关联')!
      expect(remove.attributes('disabled')).toBeDefined()
      expect(wrapper.get('.reference input[type="number"]').attributes('disabled')).toBeDefined()
      await wrapper.setProps({ sharedFields: [shared([], 'anchor')] })
      expect(wrapper.get('.fields input').attributes('disabled')).toBeDefined()
      // Guard change handlers too, including synthetic events on disabled controls.
      await wrapper.get('.fields input').setValue('Blocked')
      expect(wrapper.emitted('change')).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
})

it('distinguishes local and dependency references with the same ID and name', async () => {
  const wrapper = form({ id: 'pet', learnable_skills: [{ skill_id: 'hit', level: 1 }] }, [], 'species')
  try {
    await wrapper.setProps({
      records: [
        { kind: 'skills', file: 'data/skills/hit.yaml', index: 0, version: '1', record: { id: 'hit', name: '撞击' } },
      ],
      dependencyCatalog: {
        items: [
          {
            kind: 'skills',
            projectId: 'base',
            packageName: '@arcadia-eternity/data-pack-base',
            id: 'hit',
            label: '撞击',
          },
          { kind: 'skills', projectId: 'friend', packageName: '@friend/skills', id: 'hit', label: '撞击' },
        ],
        diagnostics: [],
      },
    })
    await wrapper
      .findAll('button')
      .find(button => button.text() === '关联已有技能…')!
      .trigger('click')
    await wrapper.get('.choice-picker input').setValue('撞击')
    const options = wrapper.findAll('.choice-picker li button')
    expect(options).toHaveLength(3)
    expect(options.find(button => button.text().includes('data-pack-base'))!.attributes('disabled')).toBeDefined()
    await options.find(button => button.text().includes('@friend/skills'))!.trigger('click')
    const record = wrapper.emitted('change')![0]![0] as ContentRow
    expect(record.learnable_skills).toEqual([
      { skill_id: 'hit', level: 1 },
      {
        skill_id: { $ref: { projectId: 'friend', kind: 'skill', id: 'hit' } },
        level: 1,
        hidden: false,
      },
    ])
    await wrapper.setProps({ record })
    expect(wrapper.findAll('.reference-name').map(button => button.text())).toEqual([
      '撞击 · @arcadia-eternity/data-pack-base',
      '撞击 · @friend/skills',
    ])
  } finally {
    wrapper.unmount()
  }
})
