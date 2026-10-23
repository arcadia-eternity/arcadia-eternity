import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  RemoveMarkContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedMarkConsumption } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedMarkConsumption
const originals = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const ids = Object.keys(generatedMarkConsumption) as Id[]
const definitions = new Map(ids.map(id => [id, originals.find((d: { id: string }) => d.id === id)]))
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.get(id))]))
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'below',
  'equal',
  'cancel',
  'empty',
  'wrong-owner',
  'late-add',
  'late-stack',
  'late-target',
  'remove-next',
  'add-during',
  'indestructible',
  'repeat',
  'nested',
  'phase',
  'multihit',
  'miss',
] as const
function run(native: boolean, id: Id, markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1301)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 2001
  }
  const d = definitions.get(id)!,
    amount: number = d.apply.value,
    opponent = d.apply.target.base === 'opponentMarks'
  const target = opponent ? b.activePet : a.activePet
  const destroyed: string[] = [],
    tracked: { label: string; mark: ReturnType<BaseMark['createInstance']> }[] = []
  const add = (label: string, owner = target, stack = amount + 3, baseId = d.apply.target.chain[0].evaluator.value) => {
    const mark = new BaseMark(baseId as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 1000,
      persistent: true,
      duration: -1,
      destroyable: variant !== 'indestructible',
    }).createInstance()
    mark.setOwner(owner, battle.emitter)
    mark.stack = stack
    owner.marks.push(mark)
    tracked.push({ label, mark })
    mark.effects.push(
      defineNativeEffect({
        id: `fixture/consume/${label}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          destroyed.push(label)
        },
      }),
    )
    return mark
  }
  const sourceMark = add('source', a.activePet, 1, 'fixture/source')
  const source = markSource ? sourceMark : a.activePet.skills[0]
  source.effects.push(native ? generatedMarkConsumption[id] : oracles.get(id)!)
  const initial =
    variant === 'below'
      ? Math.max(0, amount - 1)
      : ['equal', 'remove-next', 'add-during', 'indestructible'].includes(variant)
        ? amount
        : amount + 3
  const first = add('first', target, initial),
    second = add('second', target, amount + 4)
  if (variant === 'empty') {
    first.owner = null
    second.owner = null
    target.marks = target.marks.filter(m => m !== first && m !== second)
  }
  const reserve = add('reserve', opponent ? b.team[1] : a.team[1], amount + 5)
  add('unrelated', target, 12, 'fixture/unrelated')
  const actor = variant === 'wrong-owner' ? b : a
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, actor, actor.activePet, AttackTargetOpinion.opponent, actor.activePet.skills[0])
  use.updateActualTarget()
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/consume-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted++
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-add') add('late')
        if (variant === 'late-stack') first.stack = amount + 7
        if (variant === 'late-target') {
          if (opponent) use.actualTarget = b.team[1]
          else source.owner = a.team[1]
        }
      },
    }),
  )
  first.effects.push(
    defineNativeEffect({
      id: 'fixture/consume-callback' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply(c) {
        if (variant === 'remove-next') battle.removeMark(new RemoveMarkContext(c, second))
        if (variant === 'add-during') add('during')
      },
    }),
  )
  if (variant === 'phase' || variant === 'miss' || variant === 'multihit') {
    if (variant === 'multihit') use.multihit = 2
    use.hitOverrides.push({ willHit: variant !== 'miss', priority: 1000 })
    const p = new SkillPhase(
      battle,
      actor,
      actor.activePet,
      AttackTargetOpinion.opponent,
      actor.activePet.skills[0],
      turn,
      use,
    )
    p.initialize()
    p.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnHit, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnHit, source)
  }
  return {
    admitted,
    destroyed,
    states: tracked.map(({ label, mark }) => ({
      label,
      stack: mark.stack,
      active: mark.isActive,
      owned: mark.owner !== null,
    })),
    next: battle.random(),
    reserve: reserve.stack,
  }
}
for (const id of ids)
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const result = run(true, id, markSource, variant)
        expect(result).toEqual(run(false, id, markSource, variant))
        const first = result.states.find(s => s.label === 'first')!,
          second = result.states.find(s => s.label === 'second')!
        if (['normal', 'phase'].includes(variant)) {
          expect(result.admitted).toBe(1)
          expect(first.stack).toBe(3)
          expect(second.stack).toBe(4)
          expect(result.destroyed).toEqual([])
        }
        if (variant === 'wrong-owner') expect(result.admitted).toBe(definitions.get(id)!.condition ? 0 : 1)
        if (variant === 'repeat' || variant === 'multihit') {
          expect(result.admitted).toBe(2)
          expect(first.stack).toBe(Math.max(0, 3 - definitions.get(id)!.apply.value))
          expect(second.stack).toBe(Math.max(0, 4 - definitions.get(id)!.apply.value))
        }
        if (variant === 'miss') {
          expect(result.admitted).toBe(0)
          expect(result.destroyed).toEqual([])
        }
        if (variant === 'cancel') {
          expect(result.admitted).toBe(1)
          expect(first.stack).toBe(definitions.get(id)!.apply.value + 3)
        }
        if (variant === 'equal' || variant === 'below') {
          expect(first.stack).toBe(0)
          expect(first.active).toBe(false)
          expect(result.destroyed).toEqual(['first'])
        }
        if (variant === 'late-stack') expect(first.stack).toBe(7)
        if (variant === 'late-add') expect(result.states.find(s => s.label === 'late')!.stack).toBe(3)
        if (variant === 'late-target') {
          expect(first.stack).toBe(definitions.get(id)!.apply.value + 3)
          expect(result.reserve).toBe(5)
        }
        if (variant === 'add-during') {
          expect(result.destroyed).toEqual(['first'])
          expect(result.states.find(s => s.label === 'during')!.stack).toBe(definitions.get(id)!.apply.value + 3)
        }
        if (variant === 'remove-next') {
          expect(result.destroyed).toEqual(['first', 'second'])
          // Later V1 rejects consumption after the first callback removed this mark.
          expect(second.stack).toBe(definitions.get(id)!.apply.value + 4)
        }
        if (variant === 'indestructible') {
          expect(first.stack).toBe(0)
          expect(first.active).toBe(true)
          expect(result.destroyed).toEqual([])
        }
      })
it('pins all seven source hashes, fixed amounts and action paths', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/mark-consumption-candidates.json', import.meta.url), 'utf8'),
  )
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
          )
        : v
  expect(ids).toHaveLength(7)
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  expect(ledger.rejected).toEqual([])
  for (const r of ledger.records) {
    const d = definitions.get(r.id)!
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.priority).toBe(-50)
    expect(r.recipe.actions[0].sourcePath).toBe('/apply')
    expect(r.recipe.actions[0].code).toContain(`ops.consumeStacks(${d.apply.value})`)
    expect(r.recipe.repairedPaths).toEqual([])
  }
})
