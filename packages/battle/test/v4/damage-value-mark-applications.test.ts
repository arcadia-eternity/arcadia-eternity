import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  DamagePhase,
  DamageContext,
  DamageType,
  SkillInstance,
  GameRng,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  effectAuthoring,
  parameterAddress,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createGeneratedMarkApplications } from '@arcadia-eternity/data-pack-base/native'

type RecordEntry = {
  id: keyof ReturnType<typeof createGeneratedMarkApplications>
  sourceFile: string
  status: string
  recipe: { markId: string; when: string; triggers: string[]; parameters?: { name: string; value: number }[] }
  dependency: { sourceFile: string }
}
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.status === 'generated-candidate')
const records = allRecords.filter(
  r => r.recipe.triggers.includes('OnDamage') && r.recipe.when.includes('conditions.selfUsesSkill'),
)
const files = new Map<string, { id: string }[]>()
for (const r of allRecords)
  for (const path of [r.sourceFile, r.dependency.sourceFile])
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
const marks = new Map(
  allRecords.map(r => [
    r.recipe.markId,
    MarkParser.parse({ ...files.get(r.dependency.sourceFile)!.find(d => d.id === r.recipe.markId), effect: [] }),
  ]),
)
const candidates = createGeneratedMarkApplications(marks)
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(files.get(r.sourceFile)!.find(d => d.id === r.id))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'below',
  'equal',
  'above',
  'zero',
  'overkill',
  'shield',
  'wrong-owner',
  'other-skill',
  'no-skill',
  'nested-skill',
  'no-damage',
  'cancel-damage',
  'late-damage',
  'late-owner',
  'late-opponent',
  'cancel-effect',
  'cancel-add',
  'config-low',
  'config-high',
  'foreign-config',
  'removed-config',
  'late-config',
] as const
function run(r: RecordEntry, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(31)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0],
    target = b.activePet
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/damage-value-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  const effect = native ? candidates[r.id] : oracles.get(r.id)!
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  if (variant === 'wrong-owner') source.owner = target
  const key = native
    ? parameterAddress(r.id, 'parameters', r.recipe.parameters![0].name)
    : battle.configSystem.getRegisteredKeys().filter(k => k.startsWith(`${r.id}.`))[0]
  if (!key) throw new Error('Missing threshold parameter')
  function modifyThreshold(value: number, foreign = false, removed = false) {
    const cleanup = battle.configSystem.addScopedConfigModifier(
      key,
      new ConfigModifier(ConfigDurationType.binding, 'fixture/threshold', value, ConfigModifierType.override, 0),
      foreign ? a.team[1].skills[0] : source,
    )
    if (removed) cleanup()
  }
  if (variant === 'config-low' || variant === 'foreign-config' || variant === 'removed-config')
    modifyThreshold(50, variant === 'foreign-config', variant === 'removed-config')
  if (variant === 'config-high') modifyThreshold(200)
  const base = marks.get(r.recipe.markId)!,
    repo = DataRepository.getInstance(),
    previous = repo.marks.get(base.id)
  repo.marks.set(base.id, base)
  if (variant === 'shield') {
    const shield = new BaseMark('fixture/value-shield' as baseMarkId, [], {
      ...debuff.config,
      isShield: true,
      maxStacks: 1000,
      stackable: true,
    }).createInstance({ stack: 50 })
    shield.owner = target
    target.marks.push(shield)
  }
  if (variant === 'overkill') target.currentHp = 10
  const hpBefore = target.currentHp
  const amount = ['equal', 'above', 'shield', 'config-high'].includes(variant)
    ? variant === 'equal'
      ? 100
      : 101
    : variant === 'zero'
      ? 0
      : variant === 'overkill'
        ? 200
        : 99
  const inputs: { target: string; stack: number; duration: number; hp: number }[] = []
  target.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/damage-value-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark, EffectTrigger.OnBeforeCalculateDamage],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.OnBeforeCalculateDamage && variant === 'cancel-damage')
          ctx.parent.available = false
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-damage' && ctx.parent.parent instanceof DamageContext)
            ctx.parent.parent.damageResult = 200
          if (variant === 'late-config') modifyThreshold(0)
          if (variant === 'late-owner') source.owner = target
          if (variant === 'late-opponent') b.activePet = b.team[1]
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && ctx.parent.baseMark === base) {
          inputs.push({
            target: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
            hp: target.currentHp,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
        }
      },
    }),
  )
  try {
    const turn = new TurnContext(battle)
    const selected = variant === 'other-skill' ? new SkillInstance(skill.base, { effects: [] }) : skill
    if (variant === 'other-skill') {
      selected.owner = owner
      owner.skills.push(selected)
    }
    const use = new UseSkillContext(turn, a, owner, AttackTargetOpinion.opponent, selected)
    use.updateActualTarget()
    const phase = new DamagePhase(
      battle,
      variant === 'no-skill'
        ? turn
        : variant === 'nested-skill'
          ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
          : use,
      owner,
      target,
      amount,
      DamageType.Physical,
    )
    phase.initialize()
    if (variant === 'no-damage') {
      // @ts-expect-error Deliberately malformed dispatch: types reject it; runtime must not treat absence as zero.
      battle.applyEffects(use, EffectTrigger.OnDamage)
    } else phase.execute()
    return {
      inputs,
      hpBefore,
      hp: target.currentHp,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks.filter(m => m.baseId === base.id).map(m => ({ owner: pet.id, stack: m.stack, duration: m.duration })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repo.marks.set(base.id, previous)
    else repo.marks.delete(base.id)
  }
}
for (const r of records)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind} damage-result threshold: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      expect(actual.nextRandom).toBe(new GameRng(31).next())
      const admitted =
        ![
          'equal',
          'above',
          'overkill',
          'wrong-owner',
          'no-skill',
          'no-damage',
          'cancel-damage',
          'config-low',
          'cancel-effect',
        ].includes(variant) && !(variant === 'other-skill' && kind === 'skill')
      expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
      const damage =
        variant === 'shield'
          ? 51
          : variant === 'equal'
            ? 100
            : ['above', 'config-high'].includes(variant)
              ? 101
              : ['zero', 'no-damage', 'cancel-damage'].includes(variant)
                ? 0
                : variant === 'overkill'
                  ? 200
                  : 99
      expect(actual.hp).toBe(Math.max(0, actual.hpBefore - damage))
      if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
      else {
        const target = variant === 'late-owner' ? 'A/lead' : variant === 'late-opponent' ? 'B/reserve' : 'B/lead'
        expect(actual.inputs[0]).toEqual({
          target,
          stack: marks.get(r.recipe.markId)!.config.maxStacks,
          duration: marks.get(r.recipe.markId)!.config.duration,
          hp: actual.hp,
        })
        expect(actual.marks).toHaveLength(1)
        expect(actual.marks[0].owner).toBe(target)
      }
    })
it('covers both configured below-100 damage-result mark applications', () => {
  expect(records).toHaveLength(2)
  for (const r of records) expect(r.recipe.parameters).toEqual([{ name: 'condition_1_value', value: 100 }])
})
