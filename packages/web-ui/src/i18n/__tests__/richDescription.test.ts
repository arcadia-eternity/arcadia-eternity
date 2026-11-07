import { h } from 'vue'
import { expect, it } from 'vitest'
import {
  compileRichDescription,
  descriptionMarkKind,
  descriptionValues,
  formatRichDescription,
} from '../richDescription'
import { descriptionProblem } from '@/features/authoring/AuthorDescription'

it.each([
  ['<font color=#93E312>必中</font>', 'INVALID_TAG'],
  ['回合结束时受到{{mark.stack}}点伤害', 'MALFORMED_ARGUMENT'],
  ['{mark.stack}', 'MALFORMED_ARGUMENT'],
  ['<damage>缺少结束标签', 'UNCLOSED_TAG'],
  ['<script>alert(1)</script>', 'Unsupported description tag'],
  ['[93E312]必中[-]', 'Legacy description color markup'],
  ['{category, select, Physical {攻击} other {<unknown>隐藏分支</unknown>}}', 'Unsupported description tag'],
])('rejects invalid author descriptions: %s', (text, problem) => {
  expect(() => compileRichDescription(text, 'zh-CN')).toThrow(problem)
  expect(descriptionProblem(text, 'zh-CN')).toContain(problem)
})

it('groups adverse and exceptional marks together without treating every mark as a status', () => {
  expect(descriptionMarkKind(['status'])).toBe('status')
  expect(descriptionMarkKind(['exceptional'])).toBe('status')
  expect(descriptionMarkKind(['status', 'exceptional'])).toBe('status')
  expect(descriptionMarkKind(['statStage'])).toBe('markName')
  expect(descriptionMarkKind(['xinzhiyinji_tag'])).toBe('markName')
  expect(descriptionMarkKind()).toBe('markName')
})

it('keeps the sureHit rule field separate from its display tag', () => {
  const text = '{sureHit, select, true {<guaranteedHit>必中</guaranteedHit>} other {普通命中}}'
  expect(formatRichDescription(text, 'zh-CN', { sureHit: true })).toEqual([
    expect.objectContaining({
      children: ['必中'],
      props: expect.objectContaining({ 'data-description-kind': 'guaranteedHit' }),
    }),
  ])
  expect(formatRichDescription(text, 'zh-CN', { sureHit: false })).toEqual(['普通命中'])
})

it('keeps ICU plural/select branches, semantic tags and mark references working', () => {
  const template =
    '{power, plural, =0 {无伤害} one {<damage>#</damage> point} other {<damage>#</damage> points}} <mark>demo:slow</mark>'
  expect(descriptionProblem(template, 'en')).toBe('')
  const output = formatRichDescription(template, 'en', { power: 2 }, id => h('button', id))
  expect(output).toEqual([
    expect.objectContaining({ type: 'span', children: ['2'] }),
    ' points ',
    expect.objectContaining({ type: 'button', children: 'demo:slow' }),
  ])
})

it('exposes flat scalar values and preserves real zero stacks', () => {
  expect(descriptionValues({ mark: { stack: 0, config: { stackable: true } } })).toEqual({ stack: 0 })
  expect(formatRichDescription('受到{stack}点伤害', 'zh-CN', { stack: 0 })).toEqual(['受到0点伤害'])
  expect(formatRichDescription('受到{stack}点伤害', 'zh-CN', {})).toEqual(['受到{stack}点伤害'])
  expect(() => formatRichDescription('{misspelled}', 'zh-CN', {})).toThrow('misspelled')
})
