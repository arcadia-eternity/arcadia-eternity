import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import YAML from 'yaml'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import i18next from 'i18next'
import I18NextVue from 'i18next-vue'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { descriptionValues, formatRichDescription } from '../richDescription'
import { setServerContentText } from '../serverContent'
import AuthorDescription from '@/features/authoring/AuthorDescription'
import ContentDescription from '@/components/ContentDescription'

const root = resolve(import.meta.dirname, '../../../../../')
const namespaces = /^(species|skill|mark(?:_ability|_emblem|_global)?)\.(json|ya?ml)$/
function descriptions(
  directory: string,
): Array<{ file: string; namespace: string; language: string; id: string; text: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return descriptions(file)
    const namespace = namespaces.exec(entry.name)?.[1]
    if (!namespace) return []
    const rows = YAML.parse(readFileSync(file, 'utf8')) as Record<string, { description?: string }>
    return Object.entries(rows).map(([id, row]) => ({
      file: relative(root, file),
      namespace,
      language: directory.split(/[\\/]/).at(-1)!,
      id,
      text: row.description ?? '',
    }))
  })
}
const base = descriptions(join(root, 'packs/base/locales'))
const template = descriptions(join(root, 'packages/content-dev/template/locales'))
const official = (id: string) => base.find(row => row.id === id)!.text

it('keeps every official content translation attached to a declared object', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'packs/base/pack.json'), 'utf8')) as {
    data: Record<string, string[]>
  }
  const ids = Object.fromEntries(
    ['species', 'skills', 'marks'].map(kind => [
      kind,
      new Set(
        manifest.data[kind].flatMap(file => {
          const value = YAML.parse(readFileSync(join(root, 'packs/base/data', file), 'utf8'), { merge: true })
          return (Array.isArray(value) ? value : [value]).map((row: { id: string }) => row.id)
        }),
      ),
    ]),
  )
  const orphaned = base
    .filter(
      row =>
        !ids[row.namespace.startsWith('mark') ? 'marks' : row.namespace === 'skill' ? 'skills' : 'species'].has(row.id),
    )
    .map(row => `${row.file} → ${row.id}`)
  expect(orphaned, orphaned.join('\n')).toEqual([])
})

it.each([
  ['skill_ruodiangongji', 'markName', '弱点记号'],
  ['skill_xuehongyinji', 'markName', '血红印记'],
  ['skill_fangqing', 'markName', '晴天'],
  ['skill_lirendaoye', 'status', '流血'],
  ['skill_chaozhongliangongji', 'status', '瘫痪'],
  ['skill_wuxianbingjie', 'guaranteedHit', '必中'],
])('preserves the semantic highlight of %s', (id, kind, text) => {
  const wrapper = mount(AuthorDescription, {
    props: { text: official(id), language: 'zh-CN', context: {} },
  })
  try {
    expect(wrapper.get(`[data-description-kind="${kind}"]`).text()).toBe(text)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it.each([
  ['base pack', base],
  ['author template', template],
] as const)('renders every %s description with the production formatter', (_name, rows) => {
  expect(rows.length).toBeGreaterThan(0)
  const errors: string[] = []
  for (const row of rows) {
    // Exercise plural zero/one/other and all skill categories, not just syntax compilation.
    for (const [power, category] of [
      [0, 'Physical'],
      [1, 'Special'],
      [40, 'Status'],
    ] as const) {
      try {
        formatRichDescription(row.text, row.language, descriptionValues({ power, category, accuracy: 95, stack: 12 }))
      } catch (error) {
        errors.push(`${row.file} → ${row.id}.description: ${(error as Error).message}`)
        break
      }
    }
  }
  expect(errors, errors.join('\n')).toEqual([])
})

beforeEach(async () => {
  setServerContentText(null)
  await i18next.init({ lng: 'zh-CN', resources: {} })
})
afterEach(() => setServerContentText(null))

it('previews actual official skill styling and mark values in the workbench', async () => {
  const wrapper = mount(AuthorDescription, {
    props: { text: official('skill_ruodiangongji'), language: 'zh-CN', context: {} },
  })
  try {
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('暴击率增加5% 使对手获得1个弱点记号')
    expect(wrapper.find('span').exists()).toBe(true)
    await wrapper.setProps({ text: official('mark_liuxie'), context: { mark: { stack: 12 } } })
    expect(wrapper.text()).toBe('回合结束时受到12点伤害')
    await wrapper.setProps({ context: {} })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('回合结束时受到{stack}点伤害')
  } finally {
    wrapper.unmount()
  }
})

it.each([false, true])('renders official descriptions in the game (locale overlay: %s)', async overlay => {
  if (overlay)
    setServerContentText({
      species: [],
      skills: [],
      marks: [],
      locales: {
        defaultLocale: 'zh-CN',
        bundles: {
          'zh-CN': {
            mark: {
              mark_liuxie: { description: official('mark_liuxie') },
            },
          },
        },
      },
    })
  const wrapper = mount(ContentDescription, {
    global: { plugins: [createPinia(), [I18NextVue, { i18next }]] },
    props: {
      namespace: 'mark',
      contentId: 'mark_liuxie',
      fallback: official('mark_liuxie'),
      context: { mark: { stack: 12 } },
    },
  })
  try {
    expect(wrapper.attributes('data-format-error')).toBeUndefined()
    expect(wrapper.text()).toBe('回合结束时受到12点伤害')
    await wrapper.setProps({ context: { mark: { stack: 0 } } })
    expect(wrapper.text()).toBe('回合结束时受到0点伤害')
    await wrapper.setProps({ context: {} })
    expect(wrapper.attributes('data-format-error')).toBeUndefined()
    expect(wrapper.text()).toBe('回合结束时受到{stack}点伤害')
  } finally {
    wrapper.unmount()
  }
})
