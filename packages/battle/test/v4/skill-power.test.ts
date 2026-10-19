import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  SkillInstance,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  parameterAddress,
  BaseSkill,
  SnapshotCatalog,
  effectAuthoring,
  createGeneratedSkillPowerEffects,
  SkillPhase,
  PhaseState,
  generatedSkillPowerEffects,
  AddMarkContext,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Element,
  Category,
  Gender,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { playCandidateGame } from './candidate-game'
type Id = keyof typeof generatedSkillPowerEffects
interface RecordEntry {
  id: Id
  sourceFile: string
  sourcePath: string
  definitionSha256: string
  recipe: {
    trigger: 'BeforeUseSkillCheck' | 'AfterUseSkillCheck' | 'BeforeHit'
    operation: 'addPower' | 'amplifyPower'
    amount?: number
    value?: string
    parameters?: { name: string; value: number; configId?: string; tags?: string[] }[]
    consumesStacks?: number
    repairedPaths: string[]
  }
}
const { records }: { records: RecordEntry[] } = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-power-candidates.json', import.meta.url), 'utf8'),
)
const definitions = new Map(
  records.map(r => [
    r.id,
    parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ],
  ]),
)
// Independent test reference: repair only selector spelling; no coefficients, paths or predicates change.
function corrected(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(corrected)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        ['base', 'target'].includes(k) && x === 'useSkillContext' ? 'usingSkillContext' : corrected(x),
      ]),
    )
  return v
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(corrected(definitions.get(r.id)))]))
function objects(v: unknown): { [key: string]: unknown }[] {
  if (Array.isArray(v)) return v.flatMap(objects)
  if (v && typeof v === 'object') return [v as { [key: string]: unknown }, ...Object.values(v).flatMap(objects)]
  return []
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function supportIds(nodes: { [key: string]: unknown }[]) {
  return [
    ...new Set(
      nodes.flatMap(n =>
        n.type === 'anyOf' && Array.isArray(n.value)
          ? n.value.filter((v): v is string => typeof v === 'string' && /^(mark_|stat_stage_)/.test(v))
          : typeof n.baseId === 'string'
            ? [n.baseId]
            : (n.type === 'same' || n.type === 'anyOf') &&
                typeof n.value === 'string' &&
                /^(mark_|stat_stage_)/.test(n.value)
              ? [n.value]
              : [],
      ),
    ),
  ]
}
const branchVariants = ['lower-branch', 'no-branch', 'late-lower-branch', 'late-no-branch'] as const
function conditionalPower(r: RecordEntry) {
  return definitions.get(r.id).apply.value?.type === 'conditional'
}
const parameterVariants = [
  'default-config',
  'config-zero',
  'config-custom',
  'foreign-config',
  'removed-config',
  'late-config',
  'late-duration',
] as const
const probabilityId = 'effect_skill_power_4x_10_percent'
function parameterKey(r: RecordEntry, battle: Battle, native: boolean, name: string) {
  if (native) return parameterAddress(r.id, 'parameters', name)
  const p = r.recipe.parameters!.find(p => p.name === name)!
  if (p.configId) return `${r.id}.${p.configId}`
  const keys = battle.configSystem.getRegisteredKeys().filter(key => key.startsWith(`${r.id}.`))
  if (keys.length !== 1) throw new Error('Ambiguous anonymous parameter oracle')
  return keys[0]
}
const fieldVariants = ['wrong-fields', 'missing-fields', 'late-fields'] as const
const fieldIds = new Set([
  'effect_ability_damage_amplify_10_percent_weight_100kg',
  'effect_ability_fennu_power_boost_10_percent_when_rage_between_50_and_70',
  'effect_ability_fennu_power_boost_15_percent_when_rage_gt_70',
  'effect_ability_fennu_power_boost_25_percent_when_full_rage',
  'effect_skill_add_power_30_if_female',
  'effect_skill_add_power_30_if_male',
  'effect_skill_power_2x_if_first_round',
  'effect_skill_power_2x_if_height_above_100',
  'effect_skill_power_2x_if_height_gt_opponent',
  'effect_skill_power_2x_if_height_lt_opponent',
  'effect_skill_power2x_if_heavier',
  'effect_skill_power2x_if_higher_level',
  'effect_skill_power2x_if_weight_above_99',
  'effect_skill_power2x_vs_wind_psychic_fighting_trait',
])
function fieldsFor(r: RecordEntry, battle: Battle, valid: boolean, missing = false) {
  const { playerA: a, playerB: b } = battle
  for (const player of [a, b])
    for (const pet of player.team) {
      const self = player === a
      Object.defineProperties(pet, {
        weight: { value: missing ? undefined : self === valid ? 200 : 90, writable: true, configurable: true },
        height: {
          value: missing ? undefined : self === (valid !== r.id.includes('height_lt')) ? 200 : 90,
          writable: true,
          configurable: true,
        },
        level: { value: self === valid ? 60 : 50, writable: true, configurable: true },
      })
      pet.gender = valid === r.id.endsWith('_female') ? Gender.Female : Gender.Male
      if (!self) pet.element = valid ? Element.Wind : Element.Normal
      // Deliberately disagree with raw fields: fallback to stat attributes must be observable.
      pet.attributeSystem.updateBaseValue('weight', self ? 50 : 500)
      pet.attributeSystem.updateBaseValue('height', self === r.id.includes('height_lt') ? 500 : 50)
    }
  if (r.id.includes('fennu')) {
    a.maxRage = r.id.includes('between_50') ? 69 : r.id.includes('gt_70') ? 1000 : 100
    a.currentRage = valid ? (r.id.includes('between_50') ? 60 : r.id.includes('gt_70') ? 80 : a.maxRage) : 0
  }
  if (r.id === 'effect_skill_power_2x_if_first_round') battle.currentTurn = valid ? 1 : 2
}
const orderVariants = ['wrong-order', 'wrong-count', 'late-order'] as const
function hasOrderCondition(r: RecordEntry) {
  return objects(definitions.get(r.id).condition).some(n =>
    ['isFirstSkillUsedThisTurn', 'isLastSkillUsedThisTurn', 'continuousUseSkill'].includes(n.type as string),
  )
}
const dynamicVariants = ['late-target', 'late-stack', 'multi-mark', 'empty-values', 'retarget-self'] as const
const variants = [
  'normal',
  'missing-marks',
  'wrong-role',
  'late-owner',
  'late-values',
  'cancel',
  'other-skill',
  'alternate-element',
  'repeat',
  'phase',
] as const
function run(
  r: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark' | 'global',
  variant:
    | (typeof variants)[number]
    | (typeof dynamicVariants)[number]
    | (typeof orderVariants)[number]
    | (typeof fieldVariants)[number]
    | (typeof branchVariants)[number]
    | (typeof parameterVariants)[number],
) {
  const f = makeScenario(328),
    { battle, a, b } = f
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const pet = a.activePet,
    skill = pet.skills[0]
  const nodes = objects(definitions.get(r.id))
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const add = (owner: typeof pet | Battle, id: string) => {
    const base = new BaseMark(id as baseMarkId, [], { ...f.debuff.config, maxStacks: 5, stackable: true })
    battle.addMark(new AddMarkContext(setup, owner, base, 3))
    const mark = owner.marks.find(m => m.base === base)!
    if (r.id === 'effect_skill_add_power_20_per_pofang_turn') mark.duration = 3
    return mark
  }
  if (variant !== 'missing-marks' && variant !== 'empty-values') {
    for (const id of supportIds(nodes)) {
      add(pet, id)
      add(b.activePet, id)
    }
    for (const node of nodes) {
      if (node.type === 'contain' && typeof node.tag === 'string') {
        add(pet, 'fixture/tag').tags.push(node.tag)
        add(b.activePet, 'fixture/tag').tags.push(node.tag)
      }
    }
  }
  const selectBranch = (lower: boolean) => {
    const keep = lower ? supportIds(nodes)[0] : undefined
    for (const mark of [...pet.marks])
      if (supportIds(nodes).includes(mark.baseId) && mark.baseId !== keep) pet.marks.splice(pet.marks.indexOf(mark), 1)
  }
  if (variant === 'lower-branch' || variant === 'no-branch') selectBranch(variant === 'lower-branch')
  pet.lastSkill = skill
  const periodic = nodes.some(n => n.type === 'continuousUseSkill')
  pet.lastSkillUsedTimes = periodic ? (variant === 'phase' ? 1 : variant === 'wrong-count' ? 3 : 2) : 3
  for (const owner of [pet, b.activePet]) {
    owner.attributeSystem.updateBaseValue('maxHp', 801)
    owner.currentHp = nodes.some(n => n.operator === '==') ? 801 : nodes.some(n => n.operator === '>') ? 700 : 10
  }
  if (fieldIds.has(r.id)) fieldsFor(r, battle, variant !== 'wrong-fields', variant === 'missing-fields')
  const source = kind === 'skill' ? skill : add(kind === 'global' ? battle : pet, 'fixture/power')
  const effect = native ? generatedSkillPowerEffects[r.id] : oracles.get(r.id)!
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  for (const p of r.recipe.parameters ?? [])
    if (r.id === probabilityId && variant !== 'default-config')
      battle.configSystem.set(parameterKey(r, battle, native, p.name), 100)
  source.effects.push(effect)
  const changeConfig = (amount: number, foreign = false, remove = false) => {
    for (const p of r.recipe.parameters ?? []) {
      const cleanup = battle.configSystem.addScopedConfigModifier(
        parameterKey(r, battle, native, p.name),
        new ConfigModifier(ConfigDurationType.binding, 'fixture/power-config', amount, ConfigModifierType.override, 0),
        foreign ? a.team[1].skills[0] : source,
      )
      if (remove) cleanup()
    }
  }
  if (variant === 'config-zero') changeConfig(0)
  if (variant === 'config-custom') changeConfig(r.id === probabilityId ? 100 : 7.5)
  if (variant === 'foreign-config' || variant === 'removed-config')
    changeConfig(0, variant === 'foreign-config', variant === 'removed-config')
  const otherSkill = new SkillInstance(skill.base)
  otherSkill.setOwner(pet)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    pet,
    AttackTargetOpinion.opponent,
    variant === 'other-skill' ? otherSkill : skill,
  )
  const rival = new UseSkillContext(use.parent, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  use.parent.appledContexts.push(...(variant === 'wrong-order' ? [rival, use] : [use, rival]))
  use.parent.contexts.push(...(variant === 'wrong-order' ? [rival, use] : [use, rival]))
  use.actualTarget = variant === 'retarget-self' ? pet : b.activePet
  if (variant === 'retarget-self') for (const mark of pet.marks) mark.stack = 2
  if (variant === 'multi-mark')
    for (const owner of [pet, b.activePet]) {
      for (const mark of [...owner.marks]) {
        if (!supportIds(nodes).includes(mark.baseId)) continue
        const duplicate = mark.base.createInstance({ stack: 2 })
        if (r.id === 'effect_skill_add_power_20_per_pofang_turn') duplicate.duration = 2
        duplicate.owner = owner
        owner.marks.push(duplicate)
      }
    }
  use.power = 83
  const strings = nodes.flatMap(n => (typeof n.value === 'string' ? [n.value] : Array.isArray(n.value) ? n.value : []))
  use.element = (strings.find(s => Object.values(Element).includes(s)) ?? Element.Normal) as Element
  use.category = (strings.find(s => Object.values(Category).includes(s) && s !== 'Status') ??
    Category.Physical) as Category
  if (variant === 'alternate-element') {
    use.element = Element.Trait
    use.category = Category.Status
  }
  const trace: unknown[] = []
  battle.registerListener(message => trace.push(message.type))
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/power-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id,
      apply: ctx => {
        if (!(ctx.parent instanceof EffectContext)) return
        if (ctx.trigger === EffectTrigger.AfterEffect) {
          trace.push({ success: ctx.parent.success })
          return
        }
        trace.push('admitted')
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-values') {
          pet.currentHp = 801
          use.power = 101
          use.element = Element.Trait
        }
        if (variant === 'late-lower-branch' || variant === 'late-no-branch')
          selectBranch(variant === 'late-lower-branch')
        if (variant === 'late-config') changeConfig(r.id === probabilityId ? 0 : 7.5)
        if (variant === 'late-duration') for (const mark of b.activePet.marks) mark.duration = 1
        if (variant === 'late-fields') fieldsFor(r, battle, false)
        if (variant === 'late-order') {
          use.parent.appledContexts.reverse()
          use.parent.contexts.reverse()
          pet.lastSkillUsedTimes = 3
        }
        if (variant === 'late-target') use.actualTarget = b.team[1]
        if (variant === 'late-stack') {
          for (const mark of [...pet.marks, ...b.activePet.marks]) mark.stack = 1
          pet.lastSkillUsedTimes = 6
          pet.attributeSystem.updateBaseValue('maxHp', 903)
        }
        if (variant === 'cancel') ctx.parent.available = false
      },
    }),
  )
  if (variant === 'wrong-role') source.owner = a.team[1]
  if (variant === 'phase') {
    use.rage = 0
    if (!r.id.includes('fennu')) a.currentRage = 100
    const phase = new SkillPhase(battle, a, pet, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  } else battle.applyEffects(use, EffectTrigger[r.recipe.trigger], source)
  if (variant === 'repeat') battle.applyEffects(use, EffectTrigger[r.recipe.trigger], source)
  return {
    power: use.power,
    trace,
    stack: source instanceof SkillInstance ? null : source.stack,
    hp: [pet.currentHp, b.activePet.currentHp],
    rage: [a.currentRage, b.currentRage],
    nextRandom: battle.random(),
  }
}
// Explicit expected contributions, independent of the emitted expression and legacy interpreter.
function expectedDynamic(id: Id, kind: 'skill' | 'mark' | 'global', phase: boolean): number {
  if (id === 'effect_skill_add_power_20_per_pofang_turn') return 60
  if (id.startsWith('effect_skill_power_100_if_')) return 150
  if (id === 'effect_skill_consume_xinzhiyinji_power_2x') return 83
  if (id === 'effect_skill_add_power_10_per_opponent_manxingduyao') return 30
  if (id === 'effect_mark_add_power_stack') return kind === 'skill' ? 0 : 3
  if (id === 'effect_skill_add_power_30_per_usetime') return phase ? 90 : 60
  if (id === 'effect_skill_reduce_power_on_consecutive_hits_10_max_20') return -20
  if (id === 'effect_skill_add_power_by_self_max_hp_minus_500') return 301
  const contributions: Record<string, number> = {
    effect_skill_add_power_15_each_huohuanzhixin: 45,
    effect_skill_add_power_15_per_spd_level: 45,
    effect_skill_add_power_25_zhongzinengliang: 75,
    effect_skill_add_power_30_per_shunliu: 90,
    effect_skill_add_power_30_per_stack_if_has_shunliu: 90,
    effect_skill_add_power_40_opponent_per_atk_level: 120,
    effect_skill_add_power_40_opponent_per_def_level: 120,
    effect_skill_add_power_40_opponent_per_spa_level: 120,
    effect_skill_add_power_40_opponent_per_spd_level: 120,
    effect_skill_add_power_40_opponent_per_spe_level: 120,
    effect_skill_add_power_50_ruodian: 150,
  }
  if (!(id in contributions)) throw new Error(`Missing positive expectation: ${id}`)
  return contributions[id]
}
for (const r of records) {
  it(`${r.id} records the original parser failure and pins its source`, () => {
    expect(() => EffectParser.parse(definitions.get(r.id))).toThrow()
    expect(r.recipe.repairedPaths).toContain(
      typeof definitions.get(r.id).apply.target === 'string' ? '/apply/target' : '/apply/target/base',
    )
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([k, x]) => [k, normalize(x)]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  for (const kind of (r.id.startsWith('effect_global_') ? ['skill', 'mark', 'global'] : ['skill', 'mark']) as (
    | 'skill'
    | 'mark'
    | 'global'
  )[])
    it.each([
      ...variants,
      ...(r.recipe.value ? dynamicVariants : []),
      ...(hasOrderCondition(r) ? orderVariants : []),
      ...(fieldIds.has(r.id) ? fieldVariants : []),
      ...(conditionalPower(r) ? branchVariants : []),
      ...(r.recipe.parameters ? parameterVariants : []),
    ])(`${r.id} ${kind}: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      expect(actual.trace).not.toContainEqual({ success: false })
      if (variant === 'wrong-fields' || (variant === 'missing-fields' && /weight|height|heavier/.test(r.id))) {
        expect(actual.trace).not.toContain('admitted')
        expect(actual.power).toBe(83)
      }
      if (conditionalPower(r) && (branchVariants as readonly string[]).includes(variant)) {
        expect(actual.trace).toContain('admitted')
        expect(actual.power).toBe(variant.includes('lower') ? 133 : 83)
      }
      if (
        r.recipe.parameters &&
        variant !== 'default-config' &&
        (parameterVariants as readonly string[]).includes(variant)
      ) {
        const contribution =
          r.id === probabilityId
            ? variant === 'config-zero'
              ? 0
              : 249
            : variant === 'config-zero'
              ? 0
              : variant === 'config-custom' || variant === 'late-config'
                ? 22
                : variant === 'late-duration'
                  ? 20
                  : 60
        expect(actual.power).toBe(83 + contribution)
      }
      if (variant === 'normal' || variant === 'phase' || variant === 'late-fields') {
        expect(actual.trace).toContain('admitted')
        expect(actual.power).toBeCloseTo(
          r.recipe.operation === 'addPower'
            ? 83 + (r.recipe.amount ?? expectedDynamic(r.id, kind, variant === 'phase'))
            : 83 * r.recipe.amount!,
        )
      }
    })
}
it('exports exactly the recorded candidate IDs', () =>
  expect(Object.keys(generatedSkillPowerEffects).sort()).toEqual(records.map(r => r.id).sort()))

async function game(r: RecordEntry, native: boolean, checkpoint: boolean) {
  const f = makeScenario(329),
    { battle, a, b } = f
  const pets = [...a.team, ...b.team]
  const originals = pets.flatMap(p => p.baseSkills.flatMap(s => s.effects))
  const nodes = objects(definitions.get(r.id))
  const strings = nodes.flatMap(n => (typeof n.value === 'string' ? [n.value] : Array.isArray(n.value) ? n.value : []))
  const element = (strings.find(s => Object.values(Element).includes(s)) ?? Element.Normal) as Element
  const category = (strings.find(s => Object.values(Category).includes(s) && s !== 'Status') ??
    Category.Physical) as Category
  const candidate = () => (native ? createGeneratedSkillPowerEffects()[r.id] : oracles.get(r.id)!)
  const effect = candidate()
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  for (const p of r.recipe.parameters ?? [])
    battle.configSystem.set(parameterKey(r, battle, native, p.name), r.id === probabilityId ? 100 : 7.5)
  for (const pet of pets) {
    if (nodes.some(n => n.type === 'isFirstSkillUsedThisTurn'))
      pet.attributeSystem.updateBaseValue('spe', pet.owner === a ? 200 : 100)
    if (nodes.some(n => n.type === 'isLastSkillUsedThisTurn'))
      pet.attributeSystem.updateBaseValue('spe', pet.owner === a ? 10 : 100)
    pet.attributeSystem.updateBaseValue('maxHp', 801)
    pet.currentHp = nodes.some(n => n.operator === '==') ? 801 : nodes.some(n => n.operator === '>') ? 700 : 10
    const base = new BaseSkill(
      `fixture/power-${pet.id}` as BaseSkill['id'],
      pet.owner === a ? category : Category.Status,
      element,
      pet === a.team[1] ? 1000 : 10,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    )
    const skill = new SkillInstance(base)
    skill.setOwner(pet)
    for (const old of pet.skills) battle.skillMap.delete(old.id)
    pet.skills.splice(0, pet.skills.length, skill)
    battle.skillMap.set(skill.id, skill)
    if (nodes.some(n => n.type === 'continuousUseSkill')) {
      pet.lastSkill = skill
      pet.lastSkillUsedTimes = 1
    }
  }
  if (fieldIds.has(r.id)) {
    fieldsFor(r, battle, true)
    // Selection starts at turn zero; the executor increments to the first round.
    if (r.id === 'effect_skill_power_2x_if_first_round') battle.currentTurn = 0
  }
  return playCandidateGame({
    battle,
    checkpointTurn: r.id === 'effect_skill_power_2x_if_first_round' ? 0 : 1,
    effectId: r.id,
    checkpoint,
    catalog: fresh => {
      const c = new SnapshotCatalog(`skill-power/${r.id}`)
      for (const e of [...originals, ...f.debuff.effects]) c.registerEffect(e.id, e)
      const registered = fresh ? candidate() : effect
      if (native) effectAuthoring.registerEffect(c, registered)
      else c.registerEffect(registered.id, registered)
      return c
    },
    setup: () => {
      const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
      const add = (
        owner: typeof a.activePet | Battle,
        id: string,
        effects: (typeof effect)[] = [],
        tags: string[] = [],
      ) =>
        battle.addMark(
          new AddMarkContext(
            setup,
            owner,
            new BaseMark(
              id as baseMarkId,
              effects,
              { ...f.debuff.config, maxStacks: 20, persistent: true, keepOnSwitchOut: true },
              tags,
            ),
            3,
          ),
        )
      for (const pet of pets) {
        for (const id of supportIds(nodes)) add(pet, id)
        for (const node of nodes) {
          if (node.type === 'contain' && typeof node.tag === 'string') add(pet, 'fixture/power-tag', [], [node.tag])
        }
      }
      if (r.id.startsWith('effect_global_')) add(battle, 'fixture/power-source', [effect])
      else for (const pet of a.team) add(pet, 'fixture/power-source', [effect])
    },
  })
}
for (const r of records)
  it(`${r.id}: complete game and fresh-catalog checkpoint continuation`, async () => {
    const expected = await game(r, false, false)
    expect(await game(r, true, false)).toEqual(expected)
    expect(await game(r, true, true)).toEqual(expected)
  })
