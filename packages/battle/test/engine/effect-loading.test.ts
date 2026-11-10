import { expect, it } from 'vitest'
import { effectGroup, loadEffectGroups, type EffectLoadingContext, type EffectSource } from '../../effect-loading'
import { compileEffect, EffectTrigger, numberParam, effectParameters } from '@arcadia-eternity/battle/authoring'

const simple = (id: string) => compileEffect({ id, triggers: [EffectTrigger.TurnStart], apply() {} })
function source(
  id: string,
  build: (context: EffectLoadingContext) => ReturnType<typeof simple>,
  dependsOn: string[] = [],
): EffectSource {
  class Group {
    static build = build
  }
  effectGroup({ id, dependsOn })(Group, {} as ClassDecoratorContext)
  return { file: `${id}.effect.ts`, exports: { Group } }
}
it('links dependency groups regardless of discovered filename order and keeps canonical parameter identities', () => {
  const parameter = numberParam({ default: 5 })
  const first = compileEffect({
    id: 'first',
    triggers: [EffectTrigger.TurnStart],
    parameters: { parameter },
    apply() {},
  })
  const dependency = source('z-dependency', () => first)
  const consumer = source(
    'a-consumer',
    context => {
      expect(context.effects.get('first')).toBe(first)
      expect(context.parameters.get('first')).toBe(effectParameters(first))
      return simple('second')
    },
    ['z-dependency'],
  )
  const catalog = loadEffectGroups([consumer, dependency], new Map())
  expect([...catalog.effects.keys()]).toEqual(['first', 'second'])
  expect(catalog.families.get('second')).toBe('a-consumer')
})
it('reports duplicate IDs, missing providers and initialization cycles with provenance', () => {
  expect(() =>
    loadEffectGroups([source('a', () => simple('same')), source('b', () => simple('same'))], new Map()),
  ).toThrow('b.effect.ts [b]: Duplicate effect same: a, b')
  expect(() => loadEffectGroups([source('a', () => simple('one'), ['missing'])], new Map())).toThrow('a -> missing')
  expect(() =>
    loadEffectGroups([source('a', () => simple('one'), ['b']), source('b', () => simple('two'), ['a'])], new Map()),
  ).toThrow('a -> b -> a')
})
it('does not retain a catalog or parameter directory between loads', () => {
  const definition = source('one', () => simple('one'))
  const first = loadEffectGroups([definition], new Map())
  const second = loadEffectGroups([definition], new Map())
  expect(first.effects.get('one')).not.toBe(second.effects.get('one'))
  expect(first.parameters).not.toBe(second.parameters)
})
