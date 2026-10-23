import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Conditions } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  executeTurnOperation,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedSkillOutcomeEffects } from '@arcadia-eternity/data-pack-base/native'

const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const ids = [
  'effect_mark_evade',
  'effect_mark_evade_with_stack',
  'effect_mark_evasion_special_attacks',
  'effect_mark_evade_physical_attacks',
  'effect_mark_evade_physical_with_stack',
] as const
const sourceDefinitions = new Map(ids.map(id => [id, definitions.find((d: { id: string }) => d.id === id)]))
// Independent C07 reference: these five definitions only use the alias in target/base fields.
function repair(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(repair)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['base', 'target'].includes(key) && item === 'useSkillContext' ? 'usingSkillContext' : repair(item),
      ]),
    )
  return value
}
const oracles = new Map(ids.map(id => [id, EffectParser.parse(repair(sourceDefinitions.get(id)))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'actor',
  'same-player-bench',
  'enemy-bench',
  'global',
  'missing',
  'nested',
  'wrong-category',
  'retarget-before',
  'late-owner',
  'late-target',
  'late-category',
  'cancel',
  'repeat',
  'phase',
  'turn',
] as const
const markVariants = [
  'one-stack',
  'one-stack-repeat',
  'late-zero',
  'suppressed',
  'late-suppress',
  'late-deactivate',
] as const
function run(
  id: (typeof ids)[number],
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | (typeof markVariants)[number],
) {
  const { battle, a, b, debuff } = makeScenario(403)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const s of pet.skills) s.effects.splice(0)
  const category = id.includes('special') ? Category.Special : Category.Physical
  const base = new BaseSkill(
    'fixture/defensive' as baseSkillId,
    category,
    Element.Normal,
    1,
    100,
    0,
    0,
    AttackTargetOpinion.opponent,
  )
  const skill = new SkillInstance(base)
  skill.owner = a.activePet
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const mark = new BaseMark('fixture/defensive-source' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 5,
    duration: -1,
  }).createInstance()
  mark.owner = b.activePet
  mark.stack = variant.startsWith('one-stack') ? 1 : 3
  b.activePet.marks.push(mark)
  const other = new SkillInstance(base)
  other.owner = b.activePet
  b.activePet.skills[0] = other
  battle.skillMap.set(other.id, other)
  const source = kind === 'mark' ? mark : other
  if (variant === 'actor') source.owner = a.activePet
  if (variant === 'same-player-bench') source.owner = a.team[1]
  if (variant === 'enemy-bench') source.owner = b.team[1]
  if (variant === 'global') {
    // Global source only exists for marks; the caller skips this variant for skills.
    mark.owner = battle
  }
  if (variant === 'suppressed') mark.isSuppressed = true
  const effect = native ? generatedSkillOutcomeEffects[id] : oracles.get(id)!
  source.effects.push(effect)
  const turn = new TurnContext(battle)
  let use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  const destruction: { stack: number; overrides: number }[] = []
  mark.effects.push(
    defineNativeEffect({
      id: 'fixture/defensive-destroy' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply() {
        destruction.push({ stack: mark.stack, overrides: use.hitOverrides.length })
      },
    }),
  )
  use.updateActualTarget()
  if (variant === 'wrong-category') use.category = category === Category.Physical ? Category.Special : Category.Physical
  if (variant === 'retarget-before') use.actualTarget = b.team[1]
  const admitted: number[] = [],
    after: number[] = []
  a.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/defensive-hooks' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        if (c.trigger === EffectTrigger.AfterEffect) {
          after.push(mark.stack)
          return
        }
        admitted.push(mark.stack)
        if (variant === 'late-owner') source.owner = a.activePet
        if (variant === 'late-target') use.actualTarget = b.team[1]
        if (variant === 'late-category') use.category = Category.Status
        if (variant === 'late-zero' && c.parent instanceof EffectContext) mark.consumeStack(c.parent, mark.stack)
        if (variant === 'late-suppress') mark.isSuppressed = true
        if (variant === 'late-deactivate') mark.isActive = false
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  let reached = 0
  if (variant === 'phase' || variant === 'turn') {
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/defensive-stage' as effectId,
        triggers: [EffectTrigger[sourceDefinitions.get(id).trigger as 'BeforeUseSkillCheck' | 'AfterUseSkillCheck']],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply() {
          reached++
        },
      }),
    )
    a.currentRage = a.maxRage
    if (variant === 'phase') {
      const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
      phase.initialize()
      phase.execute()
    } else {
      a.selection = { player: a.id, type: 'use-skill', skill: skill.id, target: skill.target }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
      use = turn.appledContexts.find((c): c is UseSkillContext => c instanceof UseSkillContext)!
    }
    expect(reached).toBe(1)
  } else {
    const parent =
      variant === 'missing'
        ? turn
        : variant === 'nested'
          ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
          : use
    const trigger = EffectTrigger[sourceDefinitions.get(id).trigger as 'BeforeUseSkillCheck' | 'AfterUseSkillCheck']
    battle.applyEffects<EffectTrigger>(parent, trigger, source)
    if (variant === 'repeat' || variant === 'one-stack-repeat')
      battle.applyEffects<EffectTrigger>(parent, trigger, source)
    use.updateHitResult()
  }
  return {
    admitted,
    after,
    destruction,
    stack: mark.stack,
    active: mark.isActive,
    attached: b.activePet.marks.includes(mark),
    overrides: use.hitOverrides,
    hit: use.hitResult,
    next: battle.random(),
  }
}
for (const id of ids) {
  const requiresTarget = !['effect_mark_evasion_special_attacks', 'effect_mark_evade_physical_attacks'].includes(id)
  const requiresCategory = id.includes('physical') || id.includes('special')
  const consumes = id.includes('with_stack')
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of [...variants, ...(kind === 'mark' ? markVariants : [])]) {
      if (kind === 'skill' && variant === 'global') continue
      it(`${id} ${kind}: ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const admitted =
          !['actor', 'missing', 'suppressed'].includes(variant) &&
          !(
            requiresTarget &&
            ['same-player-bench', 'enemy-bench', 'global', 'nested', 'retarget-before'].includes(variant)
          ) &&
          !(requiresCategory && variant === 'wrong-category')
        const applies = admitted && !['cancel', 'late-suppress', 'late-deactivate', 'late-zero'].includes(variant)
        const count = variant === 'repeat' || (variant === 'one-stack-repeat' && !consumes) ? 2 : 1
        expect(actual.admitted).toHaveLength(admitted ? count : 0)
        expect(actual.overrides).toEqual(
          applies ? Array.from({ length: count }, () => ({ willHit: false, priority: -1 })) : [],
        )
        const initial = variant.startsWith('one-stack') ? 1 : 3
        expect(actual.stack).toBe(
          variant === 'late-zero' ? 0 : initial - (kind === 'mark' && consumes && applies ? count : 0),
        )
        expect(actual.hit).toBe(!applies)
        if (variant.startsWith('one-stack') && consumes) {
          expect(actual.active).toBe(false)
          expect(actual.attached).toBe(false)
          expect(actual.after).toEqual([0])
          expect(actual.destruction).toEqual([{ stack: 0, overrides: 0 }])
        }
      })
    }
}

it('skill actor inequality matches legacy for all owners and nearest/missing contexts', () => {
  const { battle, a, b, debuff } = makeScenario()
  battles.push(battle)
  const turn = new TurnContext(battle),
    skill = a.activePet.skills[0]
  const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  const mark = new BaseMark('fixture/inequality' as baseMarkId, [], debuff.config).createInstance()
  for (const owner of [a.activePet, a.team[1], b.activePet, b.team[1], battle, null]) {
    mark.owner = owner
    for (const mode of ['direct', 'nested', 'missing']) {
      const parent =
        mode === 'missing' ? turn : mode === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, skill) : use
      const expected = mode !== 'missing' && owner !== a.activePet
      const ctx = new EffectContext<EffectTrigger>(parent, EffectTrigger.BeforeHit, mark)
      const seen: boolean[] = []
      const effect = effectAuthoring.compileEffect(
        effectAuthoring.defineEffect({
          id: 'fixture/inequality',
          on: 'BeforeHit',
          execute(frame) {
            seen.push(effectAuthoring.conditions.skillActorDiffersFromOwner(frame))
          },
        }),
      )
      // Invoke the compiled action so inactive/unattached source filtering cannot hide predicate behavior.
      const action = effect.apply
      if (typeof action !== 'function') throw new Error('Expected compiled action')
      action(ctx)
      expect(seen).toEqual([expected])
      expect(Conditions.opponentUseSkill()(ctx)).toBe(expected)
    }
  }
})
