import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedRageModifiers,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  RageContext,
  SkillPhase,
  SkillInstance,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const specs = {
  effect_emblem_increase_rage_on_damage: 20,
  effect_mark_increase_rage_on_damage_10_percent: 10,
  effect_mark_increase_rage_on_damage_20_percent: 20,
} as const
type Id = keyof typeof specs
const ids = Object.keys(specs) as Id[]
const definitions = ['emblem', 'mark'].flatMap(kind =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
const legacy = new Map(ids.map(id => [id, EffectParser.parse(originals.get(id))]))
const references = new Map(
  ids.map(id => [
    id,
    defineNativeEffect({
      id: id as effectId,
      triggers: [EffectTrigger.OnRageGain],
      when(ctx) {
        const r = ctx.parent,
          pet = ctx.source.owner
        return (
          pet instanceof Pet &&
          r.reason === 'damage' &&
          r.modifiedType === 'add' &&
          r.target === pet.owner &&
          r.parent instanceof UseSkillContext &&
          r.parent.actualTarget === pet
        )
      },
      apply(ctx) {
        ctx.parent.modified[0] += specs[id]
      },
    }),
  ]),
)
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
  'skill-reason',
  'turn-reason',
  'loss',
  'wrong-player',
  'wrong-pet',
  'late-owner',
  'late-target',
  'cancel',
  'repeat',
  'phase',
  'skill-phase',
] as const
function run(id: Id, mode: 'native' | 'reference' | 'legacy', markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(2025)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  if (variant === 'skill-phase') {
    const attack = new SkillInstance(b.activePet.skills[0].base)
    attack.setOwner(a.activePet)
    a.activePet.skills[0] = attack
    battle.skillMap.set(attack.id, attack)
  }
  const owner = b.activePet
  const mark = new BaseMark('fixture/rage-modifier' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = markSource ? mark : owner.skills[0]
  source.effects.push(
    mode === 'native' ? generatedRageModifiers[id] : mode === 'reference' ? references.get(id)! : legacy.get(id)!,
  )
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0])
  use.updateActualTarget()
  if (variant === 'wrong-pet') use.actualTarget = b.team[1]
  const rage = new RageContext(
    use,
    variant === 'wrong-player' ? a : b,
    variant === 'skill-reason' ? 'skill' : variant === 'turn-reason' ? 'turn' : 'damage',
    variant === 'loss' ? 'reduce' : 'add',
    19,
  )
  a.currentRage = 40
  b.currentRage = 40
  let admitted = 0,
    observed: RageContext | undefined
  a.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/rage-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const effect = c.parent as EffectContext<EffectTrigger>
        if (effect.parent instanceof RageContext) observed = effect.parent
        if (variant === 'cancel') effect.available = false
        if (variant === 'late-owner') source.owner = b.team[1]
        if (variant === 'late-target') rage.target = a
      },
    }),
  )
  if (variant === 'skill-phase') {
    use.hitOverrides.push({ willHit: true, priority: 1000 })
    use.critOverrides.push({ willCrit: false, priority: 1000 })
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0], turn, use)
    phase.initialize()
    phase.execute()
  } else if (variant === 'phase') b.addRage(rage)
  else {
    battle.applyEffects(rage, EffectTrigger.OnRageGain, source)
    if (variant === 'repeat') battle.applyEffects(rage, EffectTrigger.OnRageGain, source)
    rage.updateRageChangeResult()
  }
  const result = observed ?? rage
  return {
    admitted,
    modified: result.modified,
    value: result.value,
    result: result.rageChangeResult,
    rage: [a.currentRage, b.currentRage],
    next: battle.random(),
  }
}
for (const id of ids) {
  it(`${id}: original trigger stays undispatched; C15 records both corrections`, () => {
    const result = run(id, 'legacy', true, 'phase')
    expect(result.admitted).toBe(0)
    expect(result.modified).toEqual([0, 0])
    expect(result.rage[1]).toBe(59)
    const ledger = JSON.parse(
      readFileSync(new URL('../../../../docs/v4/validation/rage-modifiers-candidates.json', import.meta.url), 'utf8'),
    )
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    expect(r.recipe.decisions).toEqual(['C15'])
    expect(r.recipe.corrections.map((c: { path: string }) => c.path)).toEqual(['/trigger', '/condition'])
  })
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(id, 'native', markSource, variant)
        expect(actual).toEqual(run(id, 'reference', markSource, variant))
        const eligible = !['skill-reason', 'turn-reason', 'loss', 'wrong-player', 'wrong-pet'].includes(variant),
          count = variant === 'repeat' ? 2 : 1
        expect(actual.admitted).toBe(eligible ? count : 0)
        const percent = eligible && variant !== 'cancel' ? specs[id] * count : 0
        expect(actual.modified).toEqual([percent, 0])
        expect(actual.result).toBe(Math.floor(actual.value * (1 + percent / 100)))
        if (variant === 'phase') expect(actual.rage[1]).toBe(40 + actual.result)
      }, 30000)
}
