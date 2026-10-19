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
    additionalDecisions?: string[]
    target: 'self' | 'opponent'
    markId: string
    stackValue?: string
    durationValue?: string
    parameters?: { name: string; value: number; configId?: string; tags?: string[] }[]
    stack?: number
    duration?: number
    triggers: ('OnHit' | 'OnMiss')[]
  }
  dependency: { id: string; sourceFile: string; definitionSha256: string; effectIds: string[] }
}
const records: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((record: RecordEntry) => record.status === 'generated-candidate')
const files = new Map<string, { id: string; effect?: string[] }[]>()
for (const record of records)
  for (const path of [record.sourceFile, record.dependency.sourceFile]) {
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
  }
// Explicit dependency test doubles: preserve official normalized config/tags, replace downstream
// mark behavior with an observable creation hook. No downstream effect migration is claimed here.
const baseMarks = new Map<string, BaseMark>()
for (const record of records)
  if (!baseMarks.has(record.recipe.markId)) {
    const definition = files.get(record.dependency.sourceFile)!.find(d => d.id === record.recipe.markId)!
    baseMarks.set(record.recipe.markId, MarkParser.parse({ ...definition, effect: [] }))
  }
// Parse once before battle construction so legacy literal configurations exist in each battle.
const oracles = new Map(
  records.map(record => [record.id, EffectParser.parse(files.get(record.sourceFile)!.find(d => d.id === record.id))]),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

const valueRecords = records.filter(record => record.recipe.stackValue || record.recipe.durationValue)
const conditionalRecords = records.filter(
  record =>
    !valueRecords.includes(record) &&
    record.recipe.when !== 'conditions.selfUsesSkill' &&
    record.recipe.when !== 'conditions.all(conditions.selfUsesSkill)',
)
const probabilityId = 'effect_skill_add_mark_opponent_haipa_10_if_heavier_40'
const supportMarks: Record<string, ['self' | 'opponent', string]> = {
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
  record: RecordEntry,
  battle: Battle,
  use: UseSkillContext,
  valid: boolean,
  missingWeight = false,
) {
  const self = battle.playerA.team[0],
    opponent = battle.playerB.team[0]
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
  record: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  trigger: 'OnHit' | 'OnMiss',
  variant:
    | (typeof variants)[number]
    | 'wrong-condition'
    | 'late-condition'
    | 'missing-weight'
    | (typeof valueVariants)[number],
  seed = record.id === probabilityId ? 1 : 269,
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
    if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
    const configKey = (name: string) => {
      if (native) return parameterAddress(record.id, 'parameters', name)
      const keys = battle.configSystem.getRegisteredKeys().filter(key => key.startsWith(`${record.id}.`))
      if (keys.length !== 1) throw new Error('Expected one anonymous mark option parameter')
      return keys[0]
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
      battle.addMark(new AddMarkContext(setup, record.recipe.target === 'self' ? owner : b.activePet, mark, 1))
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
            if (variant === 'late-values') setValues(11)
            if (variant === 'empty-values') setValues(7, true)
            if (variant === 'multi-values') setValues(7, false, true)
            if (variant === 'late-actual-target') {
              setValues(11, false, false, b.team[1])
              parent.actualTarget = b.team[1]
            }
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
            if (variant === 'cancel-add') context.parent.available = false
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
    admissionState(record, battle, parent, variant !== 'wrong-condition', variant === 'missing-weight')
    const beforeStacks = [...a.team, ...b.team].flatMap(pet =>
      pet.marks.filter(m => m.baseId === mark.id).map(m => m.stack),
    )
    battle.applyEffects(parent, EffectTrigger[trigger], source)
    return {
      marks: [...a.team, ...b.team].map(pet =>
        pet.marks
          .filter(m => m.baseId === mark.id)
          .map(m => ({
            id: m.baseId,
            stack: m.stack,
            duration: m.duration,
            active: m.isActive,
            owner: m.owner instanceof Pet ? m.owner.id : undefined,
          })),
      ),
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
          const target = record.recipe.target === 'self' ? 0 : 2
          expect(actual.inputs).toEqual([
            {
              target: target === 0 ? 'A/lead' : 'B/lead',
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
  expect(Object.keys(candidates).sort()).toEqual(records.map(record => record.id).sort())
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
  for (const record of records) {
    expect(hash(files.get(record.sourceFile)!.find(d => d.id === record.id))).toBe(record.definitionSha256)
    const mark = files.get(record.dependency.sourceFile)!.find(d => d.id === record.dependency.id)!
    expect(hash(mark)).toBe(record.dependency.definitionSha256)
    expect(record.dependency.effectIds).toEqual(mark.effect ?? [])
  }
  expect([...generatedMarkApplicationDependencies].sort()).toEqual(
    [...new Set(records.map(record => record.recipe.markId))].sort(),
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
  expect(conditionalRecords).toHaveLength(17)
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
