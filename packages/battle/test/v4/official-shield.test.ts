import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  Pet,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
  type MarkConfig,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createOfficialWaterShieldCandidate } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_add_mark_shuiwenpingzhang',
  markId = 'mark_shuiwenpingzhang'
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const markDefinitions = parse(readFileSync(new URL('../../../../packs/base/data/mark.yaml', import.meta.url), 'utf8'), {
  merge: true,
})
const definition = definitions.find((entry: { id: string }) => entry.id === id)
const markDefinition = markDefinitions.find((entry: { id: string }) => entry.id === markId)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'fractional',
  'zero',
  'negative',
  'over-cap',
  'late-max-hp',
  'late-config',
  'late-owner',
  'wrong-skill',
  'wrong-pet',
  'cancel-effect',
  'cancel-add',
  'redirect-add',
  'modify-stack',
  'existing-higher',
  'existing-lower',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const events: unknown[] = []
  // Deliberate dependency boundary: official config/tags, observable creation hook. Downstream
  // on-destroy/amplification effects are not replaced or claimed converted by this action test.
  const mark = new BaseMark(
    markId as baseMarkId,
    [
      defineNativeEffect({
        id: 'fixture/shield-created' as effectId,
        triggers: [EffectTrigger.OnMarkCreated],
        apply(context) {
          events.push({ created: context.parent.stack, duration: context.parent.duration })
        },
      }),
    ],
    markDefinition.config as MarkConfig,
    markDefinition.tags,
  )
  const repository = DataRepository.getInstance()
  const previous = repository.marks.get(markId)
  repository.marks.set(markId, mark)
  try {
    const candidate = createOfficialWaterShieldCandidate(mark)
    const effect = native ? candidate.effect : EffectParser.parse(definition)
    const f = makeScenario(241)
    const { battle, a, b } = f
    battles.push(battle)
    if (native) candidate.parameters.install(battle.configSystem)
    const skill = a.activePet.skills[0]
    const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
    const source =
      kind === 'skill'
        ? skill
        : (() => {
            const base = new BaseMark('fixture/source' as baseMarkId, [], f.debuff.config)
            battle.addMark(new AddMarkContext(parent, a.activePet, base))
            return a.activePet.marks.find(value => value.base === base)!
          })()
    source.effects.push(effect)
    a.activePet.attributeSystem.updateBaseValue('maxHp', 407)
    b.activePet.attributeSystem.updateBaseValue('maxHp', 811)
    const modify = (factor: number) => {
      const modifier = new ConfigModifier(
        ConfigDurationType.binding,
        'shield-factor',
        factor,
        ConfigModifierType.override,
        0,
      )
      if (native) candidate.parameters.modify(battle.configSystem, `${id}.multiply_value`, modifier, source)
      else battle.configSystem.addScopedConfigModifier(`${id}.multiply_value`, modifier, source)
    }
    if (variant === 'fractional') modify(1.5)
    if (variant === 'zero') modify(0)
    if (variant === 'negative') modify(-1)
    if (variant === 'over-cap') modify(2000)
    if (variant === 'existing-higher' || variant === 'existing-lower')
      battle.addMark(new AddMarkContext(parent, a.activePet, mark, variant === 'existing-higher' ? 200 : 50))
    events.length = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/shield-hook' as effectId,
        triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
        when: context =>
          context.trigger === EffectTrigger.OnBeforeAddMark ||
          (context.parent instanceof EffectContext && context.parent.effect?.id === id),
        apply(context) {
          if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
            if (variant === 'late-max-hp') a.activePet.attributeSystem.updateBaseValue('maxHp', 419)
            if (variant === 'late-owner') source.owner = b.activePet
            if (variant === 'late-config') modify(1.5)
            if (variant === 'cancel-effect') context.parent.available = false
          }
          if (context.trigger === EffectTrigger.OnBeforeAddMark) {
            events.push({
              requested: context.parent.stack,
              target: context.parent.target instanceof Pet ? context.parent.target.id : 'non-pet',
              base: context.parent.baseMark.id,
            })
            if (variant === 'cancel-add') context.parent.available = false
            if (variant === 'redirect-add') context.parent.target = b.activePet
            if (variant === 'modify-stack') context.parent.stack = 17
          }
        },
      }),
    )
    battle.applyEffects(
      new UseSkillContext(
        new TurnContext(battle),
        a,
        variant === 'wrong-pet' ? b.activePet : a.activePet,
        AttackTargetOpinion.opponent,
        variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
      ),
      EffectTrigger.OnHit,
      source,
    )
    return {
      marks: [a, b].map(player =>
        player.activePet.marks
          .filter(value => value.base.id === markId)
          .map(value => ({
            base: value.base.id,
            stack: value.stack,
            duration: value.duration,
            shield: value.config.isShield,
            tags: value.tags,
          })),
      ),
      events,
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repository.marks.set(markId, previous)
    else repository.marks.delete(markId)
  }
}
for (const kind of ['skill', 'mark'] as const) {
  it.each(variants)(`water shield ${kind} action matches current YAML for %s`, variant => {
    const actual = run(true, kind, variant)
    expect(actual).toEqual(run(false, kind, variant))
    if (variant === 'normal') expect(actual.marks[0][0]).toMatchObject({ stack: 101, duration: -1, shield: true })
    // floor(floor(407/4)*1.5) = 151, whereas a combined formula would yield 152.
    if (variant === 'fractional' || variant === 'late-config') expect(actual.marks[0][0].stack).toBe(151)
    if (variant === 'late-owner') expect(actual.marks[1][0].stack).toBe(202)
  })
}

it('requires the declared mark dependency rather than creating a fallback', () => {
  const f = makeScenario()
  battles.push(f.battle)
  expect(() => createOfficialWaterShieldCandidate(f.debuff)).toThrow('requires mark_shuiwenpingzhang')
})

it('pins both the source action and dependency configuration without claiming downstream equivalence', () => {
  const record = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/official-shield-candidate.json', import.meta.url), 'utf8'),
  )
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      )
    return value
  }
  const hash = (value: unknown) =>
    createHash('sha256')
      .update(JSON.stringify(normalize(value)))
      .digest('hex')
  expect(record.definitionSha256).toBe(hash(definition))
  expect(record.dependency.definitionSha256).toBe(hash(markDefinition))
  expect(record.dependency.effects).toEqual(markDefinition.effect)
  expect(record.classification).toBe('U')
})

it('keeps the unresolved downstream oracle dependency visible instead of silently dropping it', () => {
  const effects = parse(
    readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'),
    { merge: true },
  )
  const destroy = effects.find((entry: { id: string }) => entry.id === markDefinition.effect[0])
  expect(destroy.apply.mark.value).toBe('mark_shanghaizengjia')
  const nextMark = markDefinitions.find((entry: { id: string }) => entry.id === destroy.apply.mark.value)
  const amplification = effects.find((entry: { id: string }) => entry.id === nextMark.effect[0])
  expect(amplification.id).toBe('effect_mark_amplify_next_damage_skill_power_with_stack')
  expect(() => EffectParser.parse(amplification)).not.toThrow()
})
