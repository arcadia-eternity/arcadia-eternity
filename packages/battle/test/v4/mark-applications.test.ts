import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  generatedMarkApplicationDependencies,
  defineNativeEffect,
  BaseMark,
  Pet,
  Gender,
  Element,
  GameRng,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  parameterAddress,
  effectAuthoring,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

type Candidates = ReturnType<typeof createGeneratedMarkApplications>
interface RecordEntry {
  id: keyof Candidates
  status: string
  sourceFile: string
  definitionSha256: string
  recipe: {
    when: string
    tags?: string[]
    additionalDecisions?: string[]
    target: 'self' | 'opponent' | 'battle'
    markId: string
    stackValue?: string
    durationValue?: string
    parameters?: { name: string; value: number; configId?: string; tags?: string[] }[]
    stack?: number
    duration?: number
    triggers: ('BeforeHit' | 'OnHit' | 'OnMiss' | 'OnSwitchIn' | 'OnBattleStart')[]
  }
  dependency: { id: string; sourceFile: string; definitionSha256: string; effectIds: string[] }
}
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((record: RecordEntry) => record.status === 'generated-candidate')
type SkillRecord = RecordEntry & { recipe: RecordEntry['recipe'] & { triggers: ('BeforeHit' | 'OnHit' | 'OnMiss')[] } }
const records = allRecords.filter((record): record is SkillRecord =>
  record.recipe.triggers.every(trigger => ['BeforeHit', 'OnHit', 'OnMiss'].includes(trigger)),
)
const files = new Map<string, { id: string; effect?: string[] }[]>()
for (const record of allRecords)
  for (const path of [record.sourceFile, record.dependency.sourceFile]) {
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
  }
// Explicit dependency test doubles: preserve official normalized config/tags, replace downstream
// mark behavior with an observable creation hook. No downstream effect migration is claimed here.
const baseMarks = new Map<string, BaseMark>()
for (const record of allRecords)
  if (!baseMarks.has(record.recipe.markId)) {
    const definition = files.get(record.dependency.sourceFile)!.find(d => d.id === record.recipe.markId)!
    baseMarks.set(record.recipe.markId, MarkParser.parse({ ...definition, effect: [] }))
  }
// Parse once before battle construction so legacy literal configurations exist in each battle.
const oracles = new Map(
  allRecords.map(record => [
    record.id,
    EffectParser.parse(files.get(record.sourceFile)!.find(d => d.id === record.id)),
  ]),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

const consecutiveStackId = 'effect_skill_add_self_yuansuzhufu_increase_on_consecutive_hits_10_max_20'
const valueRecords = records.filter(
  record => record.id !== consecutiveStackId && (record.recipe.stackValue || record.recipe.durationValue),
)
const probabilityRecords = records.filter(record =>
  record.recipe.parameters?.some(parameter => parameter.name.startsWith('condition_')),
)
const branchingProbabilityId = 'effect_skill_add_mark_opponent_zhixi_10_or_40_percent_if_has_xukongganying'
const elementRecords = records.filter(record => record.recipe.when.includes('pets[0]?.element'))
const conditionalRecords = records.filter(
  record =>
    record.id !== consecutiveStackId &&
    !valueRecords.includes(record) &&
    !elementRecords.includes(record) &&
    !probabilityRecords.includes(record) &&
    record.recipe.when !== 'conditions.selfUsesSkill' &&
    record.recipe.when !== 'conditions.all(conditions.selfUsesSkill)',
)
const probabilityId = 'effect_skill_add_mark_opponent_haipa_10_if_heavier_40'
const supportMarks: Record<string, ['self' | 'opponent', string]> = {
  effect_skill_add_mark_opponent_nishui_50_percent_if_has_shunliu: ['self', 'mark_shunliu'],
  effect_skill_add_mark_hunmi_50_percent_if_opponent_has_mark_mabi: ['opponent', 'mark_mabi'],
  effect_skill_add_mark_opponent_haipa_if_has_cuimian_10_percent: ['opponent', 'mark_cuimian'],
  effect_skill_add_mark_opponent_haipa_if_has_cuimian_15_percent: ['opponent', 'mark_cuimian'],
  effect_skill_add_mark_opponent_taobi_60_percent_if_opponent_has_kaowen: ['opponent', 'mark_kaowen'],
  effect_skill_add_mark_opponent_zhixi_10_or_40_percent_if_has_xukongganying: ['self', 'mark_xukongganying'],
  effect_skill_add_mark_huifu_1_16_if_aideminyi: ['self', 'mark_aideminyi'],
  effect_skill_add_mark_opponent_liuxie_40_if_pofang: ['opponent', 'mark_pofang'],
  effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_has_jinbao: ['self', 'mark_jinbao'],
  effect_skill_add_mark_opponent_liuxie_50_if_has_cuimian: ['opponent', 'mark_cuimian'],
  effect_skill_add_mark_shanbiwugong_if_shabaolingyu: ['self', 'mark_shabaolingyu'],
  effect_skill_add_mark_opponent_shoudaoshanghaizengjia_50_if_opponent_has_kaowen: ['opponent', 'mark_kaowen'],
  effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_opponent_has_kaowen_and_last: ['opponent', 'mark_kaowen'],
}
// Independent scenario inputs, not an evaluator for the source condition tree.
function admissionState(
  record: SkillRecord,
  battle: Battle,
  use: UseSkillContext,
  valid: boolean,
  missingWeight = false,
) {
  const self = battle.playerA.team[0],
    opponent = battle.playerB.team[0]
  if (elementRecords.includes(record)) opponent.element = Element.Fire
  if (record.id === 'effect_skill_add_mark_opponent_liuxie_50_if_field_yemu') {
    battle.marks.splice(0, battle.marks.length, ...battle.marks.filter(mark => mark.baseId !== 'mark_global_yemu'))
    if (valid) {
      const mark = baseMarks.get('mark_global_yemu')!.createInstance()
      mark.owner = battle
      battle.marks.push(mark)
    }
  }
  const support = supportMarks[record.id]
  if (support) {
    const pet = support[0] === 'self' ? self : opponent
    pet.marks.splice(0, pet.marks.length, ...pet.marks.filter(mark => mark.baseId !== support[1]))
    if (valid) {
      const instance = new BaseMark(support[1] as baseMarkId, []).createInstance()
      instance.owner = pet
      pet.marks.push(instance)
    }
  }
  self.gender = valid === record.id.endsWith('_female') ? Gender.Female : Gender.Male
  if (record.id.includes('_if_hp_above_half')) self.currentHp = valid ? self.stat.maxHp : 1
  if (record.id.includes('_below_1_8_hp')) self.currentHp = valid ? 1 : self.stat.maxHp
  if (record.id.includes('_if_max_hp_gt_opponent')) self.attributeSystem.updateBaseValue('maxHp', valid ? 9999 : 1)
  if (record.id === probabilityId) {
    Object.defineProperty(self, 'weight', {
      value: missingWeight ? undefined : valid ? 200 : 10,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(opponent, 'weight', {
      value: missingWeight ? undefined : 100,
      writable: true,
      configurable: true,
    })
    self.attributeSystem.updateBaseValue('weight', 1)
    opponent.attributeSystem.updateBaseValue('weight', 999)
  }
  self.lastSkill = use.skill
  self.lastSkillUsedTimes = valid ? 2 : 3
  const turn = use.parent
  turn.appledContexts.splice(0)
  turn.contexts.splice(0)
  if (valid) {
    turn.appledContexts.push(use)
    turn.contexts.push(use)
  }
}

const valueSupport: Record<string, ['self' | 'opponent', string]> = {
  effect_skill_add_mark_kongqihudun_stack_with_kongqichuliang_stack: ['self', 'mark_kongqichuliang'],
  effect_skill_add_mark_opponent_liuxie_with_zhongzinengliang: ['self', 'mark_zhongzinengliang'],
  effect_skill_add_mark_opponent_zhongdu_duration_2: ['opponent', 'mark_zhongdu'],
  effect_skill_add_mark_shanghaizengjia_stack_with_zengzhong_stack_x75: ['self', 'mark_zengzhong'],
  effect_skill_double_mark_liuxie_stack: ['opponent', 'mark_liuxie'],
}
function defaultAmount(record: RecordEntry, key: 'stack' | 'duration') {
  const dynamic: Record<string, number> = {
    [consecutiveStackId]: 10,
    effect_skill_add_mark_fansheguike: 301,
    effect_skill_add_mark_hanbinghujia_2x_self_max_hp_minus_500: 602,
    effect_skill_add_mark_kongqihudun_stack_with_kongqichuliang_stack: 7,
    effect_skill_add_mark_opponent_liuxie_with_zhongzinengliang: 10,
    effect_skill_add_mark_opponent_zhongdu_duration_2: 9,
    effect_skill_add_mark_shanghaizengjia_stack_with_zengzhong_stack_x75: 525,
    effect_skill_double_mark_liuxie_stack: 14,
    effect_skill_add_mark_zhifanghudun_stack_with_weight: 231,
  }
  return record.recipe[`${key}Value`]
    ? (record.recipe.parameters?.find(parameter => parameter.name === key)?.value ?? dynamic[record.id])
    : (record.recipe[key] ?? baseMarks.get(record.recipe.markId)!.config[key === 'stack' ? 'maxStacks' : 'duration'])
}
const valueVariants = [
  'late-values',
  'empty-values',
  'multi-values',
  'late-actual-target',
  'config-zero',
  'config-custom',
  'foreign-config',
  'late-config',
  'removed-config',
  'tag-config',
  'missing-at-collection',
] as const
const probabilityVariants = [
  'prob-default',
  'prob-zero',
  'prob-hundred',
  'prob-foreign',
  'prob-removed',
  'prob-late',
  'prob-tag',
  'prob-alias',
  'prob-no-support',
] as const
const variants = [
  'normal',
  'wrong-skill',
  'late-owner',
  'late-opponent',
  'cancel-effect',
  'cancel-add',
  'modify',
  'existing',
] as const
function run(
  record: SkillRecord,
  native: boolean,
  kind: 'skill' | 'mark',
  trigger: 'BeforeHit' | 'OnHit' | 'OnMiss',
  variant:
    | (typeof variants)[number]
    | 'wrong-condition'
    | 'late-condition'
    | 'missing-weight'
    | 'other-weather'
    | 'cancel-other-weather'
    | (typeof valueVariants)[number]
    | (typeof probabilityVariants)[number],
  seed = record.id === probabilityId ? 1 : 269,
  probabilityOverrides?: readonly number[],
  elementCase?: { immune: boolean; lateImmune?: boolean; uses?: number; lateUses?: number },
) {
  const f = makeScenario(seed),
    { battle, a, b } = f
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  const events: unknown[] = [],
    inputs: { target: string; stack: number; duration: number }[] = []
  const base = baseMarks.get(record.recipe.markId)!
  const mark = new BaseMark(
    base.id,
    [
      defineNativeEffect({
        id: 'fixture/application-created' as effectId,
        triggers: [EffectTrigger.OnMarkCreated],
        apply(context) {
          events.push({
            created: context.parent.baseMark.id,
            target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
            stack: context.parent.stack,
            duration: context.parent.duration,
          })
        },
      }),
    ],
    base.config,
    base.tags,
  )
  const dependencies = new Map(baseMarks)
  dependencies.set(mark.id, mark)
  const repository = DataRepository.getInstance(),
    previous = repository.marks.get(mark.id)
  repository.marks.set(mark.id, mark)
  try {
    const candidates = native ? createGeneratedMarkApplications(dependencies) : undefined
    dependencies.clear() // Published candidates retain the exact validated dependency objects.
    const effect = candidates ? candidates[record.id] : oracles.get(record.id)!
    const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
    let source: typeof skill | (typeof owner.marks)[number] = skill
    if (kind === 'mark') {
      const sourceMark = new BaseMark('fixture/application-source' as baseMarkId, [], f.debuff.config)
      battle.addMark(new AddMarkContext(setup, owner, sourceMark))
      source = owner.marks.find(m => m.base === sourceMark)!
    }
    if (record.recipe.tags) expect(effect.tags).toEqual(record.recipe.tags)
    if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
    const configKey = (name: string) => {
      if (native) return parameterAddress(record.id, 'parameters', name)
      const parameter = record.recipe.parameters!.find(parameter => parameter.name === name)!
      if (parameter.configId) return `${record.id}.${parameter.configId}`
      const anonymous = record.recipe.parameters!.filter(parameter => !parameter.configId)
      const aliases = record.recipe
        .parameters!.filter(parameter => parameter.configId)
        .map(parameter => `${record.id}.${parameter.configId}`)
      const keys = battle.configSystem
        .getRegisteredKeys()
        .filter(key => key.startsWith(`${record.id}.`) && !aliases.includes(key))
      if (keys.length !== anonymous.length) throw new Error('Ambiguous anonymous mark parameters')
      return keys[anonymous.indexOf(parameter)]
    }
    const changeConfig = (amount: number, foreign = false, remove = false) => {
      for (const parameter of record.recipe.parameters ?? []) {
        const cleanup = battle.configSystem.addScopedConfigModifier(
          configKey(parameter.name),
          new ConfigModifier(ConfigDurationType.binding, 'fixture/mark-option', amount, ConfigModifierType.override, 0),
          foreign ? a.team[1].skills[0] : source,
        )
        if (remove) cleanup()
      }
    }
    if (probabilityRecords.includes(record)) {
      const explicitProbabilityVariant = probabilityVariants.includes(variant as (typeof probabilityVariants)[number])
      const initial =
        !explicitProbabilityVariant || variant === 'prob-late'
          ? 100
          : variant === 'prob-default' || variant === 'prob-no-support'
            ? undefined
            : 0
      if (initial !== undefined)
        for (const parameter of record.recipe.parameters!) battle.configSystem.set(configKey(parameter.name), initial)
      if (variant === 'prob-hundred') changeConfig(100)
      if (variant === 'prob-zero') changeConfig(0)
      if (variant === 'prob-foreign') changeConfig(100, true)
      if (variant === 'prob-removed') changeConfig(100, false, true)
      if (variant === 'prob-alias')
        for (const parameter of record.recipe.parameters!)
          if (native)
            effectAuthoring
              .effectParameters(effect)
              .modify(
                battle.configSystem,
                parameter.configId ? `${record.id}.${parameter.configId}` : configKey(parameter.name),
                new ConfigModifier(
                  ConfigDurationType.binding,
                  'fixture/legacy-alias',
                  100,
                  ConfigModifierType.override,
                  0,
                ),
                source,
              )
          else
            battle.configSystem.addScopedConfigModifier(
              configKey(parameter.name),
              new ConfigModifier(
                ConfigDurationType.binding,
                'fixture/legacy-alias',
                100,
                ConfigModifierType.override,
                0,
              ),
              source,
            )
      if (variant === 'prob-tag')
        for (const tag of new Set(record.recipe.parameters!.flatMap(parameter => parameter.tags ?? [])))
          battle.configSystem.addTaggedConfigModifier(
            tag,
            ConfigModifierType.override,
            100,
            0,
            ConfigDurationType.binding,
            undefined,
            source,
          )
    }
    if (probabilityOverrides)
      record.recipe.parameters!.forEach((parameter, index) =>
        battle.configSystem.set(configKey(parameter.name), probabilityOverrides[index]),
      )
    if (variant === 'config-zero') changeConfig(0)
    if (variant === 'config-custom') changeConfig(11)
    if (variant === 'foreign-config') changeConfig(11, true)
    if (variant === 'removed-config') changeConfig(11, false, true)
    if (variant === 'tag-config')
      for (const parameter of record.recipe.parameters ?? []) {
        for (const tag of parameter.tags ?? [])
          battle.configSystem.addTaggedConfigModifier(
            tag,
            ConfigModifierType.override,
            13,
            0,
            ConfigDurationType.binding,
            undefined,
            source,
          )
      }
    const support = valueSupport[record.id]
    const setValues = (amount: number, empty = false, duplicate = false, onlyPet?: Pet) => {
      for (const player of [a, b])
        for (const pet of player.team) {
          if (onlyPet && pet !== onlyPet) continue
          if (record.recipe.stackValue?.includes('maxHp'))
            pet.attributeSystem.updateBaseValue('maxHp', empty ? 500 : amount === 7 ? 801 : 901)
          if (record.id === 'effect_skill_add_mark_zhifanghudun_stack_with_weight')
            Object.defineProperty(pet, 'weight', {
              value: empty ? undefined : amount === 7 ? 231 : 321,
              configurable: true,
              writable: true,
            })
          if (support) {
            pet.marks.splice(0, pet.marks.length, ...pet.marks.filter(mark => mark.baseId !== support[1]))
            if (!empty && player === (support[0] === 'self' ? a : b)) {
              for (const count of duplicate ? [amount, 23] : [amount]) {
                const base = support[1] === mark.id ? mark : new BaseMark(support[1] as baseMarkId, [])
                const instance = base.createInstance({ stack: count, config: { maxStacks: 10000 } })
                instance.owner = pet
                pet.marks.push(instance)
              }
            }
          }
        }
    }
    if (valueRecords.includes(record)) setValues(7, variant === 'missing-at-collection')
    source.effects.push(effect)
    if (variant === 'existing')
      battle.addMark(
        new AddMarkContext(
          setup,
          record.recipe.target === 'battle' ? battle : record.recipe.target === 'self' ? owner : b.activePet,
          mark,
          1,
        ),
      )
    let previousWeather: (typeof battle.marks)[number] | undefined
    if (variant === 'other-weather' || variant === 'cancel-other-weather') {
      const previous = new BaseMark('fixture/previous-weather' as baseMarkId, [], base.config)
      battle.addMark(new AddMarkContext(setup, battle, previous))
      previousWeather = battle.marks.find(instance => instance.base === previous)!
      if (!previousWeather) throw new Error('Previous weather was not installed')
    }
    events.length = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/application-hook' as effectId,
        triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
        when: context =>
          context.trigger !== EffectTrigger.BeforeEffect ||
          (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
        apply(context) {
          if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
            if (elementCase?.lateUses !== undefined) owner.lastSkillUsedTimes = elementCase.lateUses
            if (elementCase?.lateImmune)
              b.activePet.element = record.id.includes('dongshang') ? Element.Ice : Element.Water
            if (variant === 'late-values') setValues(11)
            if (variant === 'empty-values') setValues(7, true)
            if (variant === 'multi-values') setValues(7, false, true)
            if (variant === 'late-actual-target') {
              setValues(11, false, false, b.team[1])
              parent.actualTarget = b.team[1]
            }
            if (variant === 'prob-late') changeConfig(0)
            if (variant === 'late-config') changeConfig(11)
            if (variant === 'late-condition') admissionState(record, battle, parent, false)
            if (variant === 'cancel-effect') context.parent.available = false
            if (variant === 'late-owner') source.owner = b.activePet
            if (variant === 'late-opponent') b.activePet = b.team[1]
          }
          if (context.trigger === EffectTrigger.OnBeforeAddMark && context.parent.baseMark === mark) {
            inputs.push({
              target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
              stack: context.parent.stack,
              duration: context.parent.duration,
            })
            if (variant === 'cancel-add' || variant === 'cancel-other-weather') context.parent.available = false
            if (variant === 'modify') {
              context.parent.setStack(2)
              context.parent.setDuration(7)
            }
          }
        },
      }),
    )
    const parent = new UseSkillContext(
      new TurnContext(battle),
      a,
      owner,
      AttackTargetOpinion.opponent,
      variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
    )
    parent.updateActualTarget()
    admissionState(
      record,
      battle,
      parent,
      variant !== 'wrong-condition' && variant !== 'prob-no-support',
      variant === 'missing-weight',
    )
    if (elementCase) {
      b.activePet.element = elementCase.immune
        ? record.id.includes('dongshang')
          ? Element.Ice
          : Element.Water
        : Element.Fire
      if (elementCase.uses !== undefined) owner.lastSkillUsedTimes = elementCase.uses
    }
    const beforeStacks = [...a.team, ...b.team, battle].flatMap(pet =>
      pet.marks.filter(m => m.baseId === mark.id).map(m => m.stack),
    )
    battle.applyEffects(parent, EffectTrigger[trigger], source)
    return {
      marks: [...a.team, ...b.team, battle].map(pet =>
        pet.marks
          .filter(m => m.baseId === mark.id)
          .map(m => ({
            id: m.baseId,
            stack: m.stack,
            duration: m.duration,
            active: m.isActive,
            owner: m.owner instanceof Pet ? m.owner.id : m.owner === battle ? 'battle' : undefined,
          })),
      ),
      fieldMarks: battle.marks.map(mark => ({ id: mark.baseId, active: mark.isActive })),
      previousWeatherActive: previousWeather?.isActive,
      inputs,
      beforeStacks,
      events,
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repository.marks.set(mark.id, previous)
    else repository.marks.delete(mark.id)
  }
}
for (const record of records)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${record.id} ${kind} matches YAML for %s`, variant => {
      for (const trigger of record.recipe.triggers) {
        const actual = run(record, true, kind, trigger, variant)
        expect(actual).toEqual(run(record, false, kind, trigger, variant))
        if (variant === 'normal') {
          const target = record.recipe.target === 'battle' ? 4 : record.recipe.target === 'self' ? 0 : 2
          expect(actual.inputs).toEqual([
            {
              target: target === 4 ? 'battle' : target === 0 ? 'A/lead' : 'B/lead',
              stack: defaultAmount(record, 'stack'),
              duration: defaultAmount(record, 'duration'),
            },
          ])
          expect(actual.marks[target]).toHaveLength(1)
          if (valueSupport[record.id]?.[1] !== record.recipe.markId) expect(actual.events.length).toBeGreaterThan(0)
        }
        if (variant === 'cancel-effect' || (variant === 'wrong-skill' && kind === 'skill'))
          expect(actual.inputs).toEqual([])
        if (variant === 'cancel-add') expect(actual.marks.flat().map(mark => mark.stack)).toEqual(actual.beforeStacks)
      }
    })
it('requires all exact dependencies before publishing any candidate and captures the supplied catalog', () => {
  expect(() => createGeneratedMarkApplications(new Map())).toThrow('Missing or mismatched')
  const invalid = new Map(baseMarks)
  invalid.set(generatedMarkApplicationDependencies[0], baseMarks.get(generatedMarkApplicationDependencies[1])!)
  expect(() => createGeneratedMarkApplications(invalid)).toThrow('Missing or mismatched')
  const candidates = createGeneratedMarkApplications(baseMarks)
  expect(Object.keys(candidates).sort()).toEqual(allRecords.map(record => record.id).sort())
  expect(Object.isFrozen(candidates)).toBe(true)
})
it('pins each effect and its entire mark dependency definition to current sources', () => {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value
  const hash = (value: unknown) =>
    createHash('sha256')
      .update(JSON.stringify(normalize(value)))
      .digest('hex')
  for (const record of allRecords) {
    expect(hash(files.get(record.sourceFile)!.find(d => d.id === record.id))).toBe(record.definitionSha256)
    const mark = files.get(record.dependency.sourceFile)!.find(d => d.id === record.dependency.id)!
    expect(hash(mark)).toBe(record.dependency.definitionSha256)
    expect(record.dependency.effectIds).toEqual(mark.effect ?? [])
  }
  expect([...generatedMarkApplicationDependencies].sort()).toEqual(
    [...new Set(allRecords.map(record => record.recipe.markId))].sort(),
  )
})

for (const record of conditionalRecords)
  for (const kind of ['skill', 'mark'] as const)
    it.each(['wrong-condition', 'late-condition'] as const)(
      `${record.id} ${kind} checks admission once: %s`,
      variant => {
        for (const trigger of record.recipe.triggers) {
          const actual = run(record, true, kind, trigger, variant)
          expect(actual).toEqual(run(record, false, kind, trigger, variant))
          expect(actual.inputs).toHaveLength(variant === 'wrong-condition' ? 0 : 1)
        }
      },
    )
it('covers exactly seventeen additional conditional definitions and records turn-order corrections', () => {
  expect(conditionalRecords).toHaveLength(18)
  const corrected = conditionalRecords.filter(record => record.recipe.additionalDecisions?.includes('C08'))
  expect(corrected.map(record => record.id).sort()).toEqual(
    [
      'effect_skill_add_mark_shanbi_if_first',
      'effect_skill_add_mark_opponent_shiming_if_first',
      'effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_opponent_has_kaowen_and_last',
      'effect_skill_add_mark_opponent_liuxie_40_if_last',
    ].sort(),
  )
})
for (const seed of [1, 2, 6, 11])
  it(`weight probability preserves both thresholds and subsequent RNG: seed ${seed}`, () => {
    const record = records.find(record => record.id === probabilityId)!
    for (const variant of ['normal', 'wrong-condition', 'missing-weight', 'late-condition'] as const) {
      const actual = run(record, true, 'skill', 'OnHit', variant, seed)
      expect(actual).toEqual(run(record, false, 'skill', 'OnHit', variant, seed))
      expect(actual.inputs).toHaveLength(
        seed === 11 ? 1 : seed === 2 || variant === 'wrong-condition' || variant === 'missing-weight' ? 0 : 1,
      )
    }
  })

for (const record of valueRecords)
  for (const kind of ['skill', 'mark'] as const)
    it.each(valueVariants)(`${record.id} ${kind} reads options at execution: %s`, variant => {
      const actual = run(record, true, kind, 'OnHit', variant)
      expect(actual).toEqual(run(record, false, kind, 'OnHit', variant))
      const gated = [
        'effect_skill_add_mark_fansheguike',
        'effect_skill_add_mark_hanbinghujia_2x_self_max_hp_minus_500',
        'effect_skill_add_mark_kongqihudun_stack_with_kongqichuliang_stack',
        'effect_skill_double_mark_liuxie_stack',
        'effect_skill_add_mark_opponent_zhongdu_duration_2',
      ].includes(record.id)
      if (variant === 'missing-at-collection' && gated) {
        expect(actual.inputs).toEqual([])
        return
      }
      expect(actual.inputs).toHaveLength(1)
      expect(actual.inputs[0].target).toBe(record.recipe.target === 'self' ? 'A/lead' : 'B/lead')
      for (const key of ['stack', 'duration'] as const) {
        if (!record.recipe[`${key}Value`] || record.recipe.parameters) continue
        const late: Record<string, number> = {
          effect_skill_add_mark_fansheguike: 401,
          effect_skill_add_mark_hanbinghujia_2x_self_max_hp_minus_500: 802,
          effect_skill_add_mark_kongqihudun_stack_with_kongqichuliang_stack: 11,
          effect_skill_add_mark_opponent_liuxie_with_zhongzinengliang: 14,
          effect_skill_add_mark_opponent_zhongdu_duration_2: 13,
          effect_skill_add_mark_shanghaizengjia_stack_with_zengzhong_stack_x75: 825,
          effect_skill_double_mark_liuxie_stack: 22,
          effect_skill_add_mark_zhifanghudun_stack_with_weight: 321,
        }
        const empty = record.recipe[`${key}Value`]?.includes('maxHp')
          ? 0
          : baseMarks.get(record.recipe.markId)!.config[key === 'stack' ? 'maxStacks' : 'duration']
        expect(actual.inputs[0][key]).toBe(
          variant === 'late-values' ||
            (variant === 'late-actual-target' &&
              ['effect_skill_double_mark_liuxie_stack', 'effect_skill_add_mark_opponent_zhongdu_duration_2'].includes(
                record.id,
              ))
            ? late[record.id]
            : variant === 'empty-values' || variant === 'missing-at-collection'
              ? empty
              : defaultAmount(record, key),
        )
      }
      for (const parameter of record.recipe.parameters ?? []) {
        expect(actual.inputs[0][parameter.name as 'stack' | 'duration']).toBe(
          variant === 'tag-config'
            ? 13
            : variant === 'config-zero'
              ? 0
              : variant === 'config-custom' || variant === 'late-config'
                ? 11
                : parameter.value,
        )
      }
    })
it('covers dynamic/parameterized options while retaining the handwritten shield override', () => {
  expect(valueRecords).toHaveLength(19)
  expect(records.some(record => record.id === ('effect_skill_add_mark_shuiwenpingzhang' as keyof Candidates))).toBe(
    false,
  )
})

// Exercise both sides within one percentage point of the declared threshold.
function thresholdSeeds(percent: number): number[] {
  const result: (number | undefined)[] = [undefined, undefined]
  for (let seed = 0; seed < 10000 && result.some(value => value === undefined); seed++) {
    const draw = new GameRng(seed).next() * 100
    if (Math.abs(draw - percent) < 1) result[draw < percent ? 0 : 1] ??= seed
  }
  if (result.some(value => value === undefined)) throw new Error(`Cannot bracket probability ${percent}`)
  return result as number[]
}

for (const record of probabilityRecords)
  for (const kind of ['skill', 'mark'] as const)
    it.each(probabilityVariants)(`${record.id} ${kind} preserves probability admission: %s`, variant => {
      const defaultPercent =
        record.recipe.parameters![record.id === branchingProbabilityId && variant !== 'prob-no-support' ? 1 : 0].value
      const seeds =
        variant === 'prob-default' || variant === 'prob-no-support' ? thresholdSeeds(defaultPercent) : [28, 269]
      for (const seed of seeds)
        for (const trigger of record.recipe.triggers) {
          const actual = run(record, true, kind, trigger, variant, seed)
          expect(actual).toEqual(run(record, false, kind, trigger, variant, seed))
          const rng = new GameRng(seed)
          const draw = rng.next()
          const guarded = Boolean(supportMarks[record.id]) && record.id !== branchingProbabilityId
          if (variant === 'prob-no-support' && guarded) {
            expect(actual.inputs).toEqual([])
            expect(actual.nextRandom).toBe(draw)
            continue
          }
          const defaults = record.recipe.parameters!
          const percent =
            variant === 'prob-default' || variant === 'prob-no-support'
              ? defaults[record.id === branchingProbabilityId && variant !== 'prob-no-support' ? 1 : 0].value
              : ['prob-hundred', 'prob-late', 'prob-tag', 'prob-alias'].includes(variant)
                ? 100
                : 0
          expect(actual.inputs).toHaveLength(draw < percent / 100 ? 1 : 0)
          expect(actual.nextRandom).toBe(rng.next())
        }
    })
it('covers probability parameters and both pre-hit definitions', () => {
  expect(probabilityRecords).toHaveLength(33)
  expect(
    probabilityRecords
      .filter(record => record.recipe.triggers.includes('BeforeHit'))
      .map(record => record.id)
      .sort(),
  ).toEqual([
    'effect_skill_add_mark_opponent_shuimian_10_percent',
    'effect_skill_add_mark_opponent_shuimian_40_percent',
  ])
})

for (const kind of ['skill', 'mark'] as const)
  it(`${kind} keeps the two conditional probability parameters independent`, () => {
    const record = probabilityRecords.find(record => record.id === branchingProbabilityId)!
    for (const variant of ['prob-default', 'prob-no-support'] as const)
      for (const overrides of [
        [100, 0],
        [0, 100],
      ])
        for (const trigger of record.recipe.triggers) {
          const actual = run(record, true, kind, trigger, variant, 28, overrides)
          expect(actual).toEqual(run(record, false, kind, trigger, variant, 28, overrides))
          expect(actual.inputs).toHaveLength(overrides[variant === 'prob-no-support' ? 0 : 1] === 100 ? 1 : 0)
          const rng = new GameRng(28)
          rng.next()
          expect(actual.nextRandom).toBe(rng.next())
        }
  })

for (const record of elementRecords)
  for (const kind of ['skill', 'mark'] as const)
    it(`${record.id} ${kind} preserves element exclusion and admission timing`, () => {
      const consecutive = record.id.endsWith('when_reused')
      for (const uses of consecutive ? [0, 1, 2, 3] : [2])
        for (const elementCase of [{ immune: false }, { immune: true }, { immune: false, lateImmune: true }])
          for (const trigger of record.recipe.triggers) {
            const options = { ...elementCase, uses }
            const actual = run(record, true, kind, trigger, 'normal', 28, undefined, options)
            expect(actual).toEqual(run(record, false, kind, trigger, 'normal', 28, undefined, options))
            expect(actual.inputs).toHaveLength(!elementCase.immune && (!consecutive || uses >= 2) ? 1 : 0)
            const rng = new GameRng(28)
            if (record.recipe.parameters?.length) rng.next()
            expect(actual.nextRandom).toBe(rng.next())
          }
    })
it('covers seven element exclusions and seven battle-target applications', () => {
  expect(elementRecords).toHaveLength(7)
  expect(records.filter(record => record.recipe.target === 'battle')).toHaveLength(7)
})

for (const record of records.filter(record => record.recipe.target === 'battle'))
  for (const kind of ['skill', 'mark'] as const)
    it.each(['other-weather', 'cancel-other-weather'] as const)(
      `${record.id} ${kind} preserves weather replacement: %s`,
      variant => {
        for (const trigger of record.recipe.triggers) {
          const actual = run(record, true, kind, trigger, variant)
          expect(actual).toEqual(run(record, false, kind, trigger, variant))
          const cancelled = variant === 'cancel-other-weather'
          expect(actual.fieldMarks).toEqual([
            { id: cancelled ? 'fixture/previous-weather' : record.recipe.markId, active: true },
          ])
          expect(actual.previousWeatherActive).toBe(cancelled)
        }
      },
    )

for (const kind of ['skill', 'mark'] as const)
  it(`${kind} retains tagged consecutive-stack growth and its cap`, () => {
    const record = records.find(record => record.id === consecutiveStackId)!
    for (const uses of [0, 1, 2, 3, 4]) {
      const options = { immune: false, uses }
      const actual = run(record, true, kind, 'OnHit', 'normal', 28, undefined, options)
      expect(actual).toEqual(run(record, false, kind, 'OnHit', 'normal', 28, undefined, options))
      expect(actual.inputs).toEqual(
        uses <= 1
          ? []
          : [
              {
                target: 'A/lead',
                stack: Math.min(uses - 1, 2) * 10,
                duration: baseMarks.get(record.recipe.markId)!.config.duration,
              },
            ],
      )
    }
  })

for (const kind of ['skill', 'mark'] as const)
  it(`${kind} reads the consecutive stack amount after admission`, () => {
    const record = records.find(record => record.id === consecutiveStackId)!
    for (const lateUses of [1, 4]) {
      const options = { immune: false, uses: 2, lateUses }
      const actual = run(record, true, kind, 'OnHit', 'normal', 28, undefined, options)
      expect(actual).toEqual(run(record, false, kind, 'OnHit', 'normal', 28, undefined, options))
      expect(actual.inputs[0].stack).toBe(lateUses === 1 ? 0 : 20)
    }
  })
