import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalActions,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  HealContext,
  RageContext,
  DamagePhase,
  SkillPhase,
  DamageType,
  AttackTargetOpinion,
  executeTurnOperation,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type Id = keyof typeof generatedVitalActions
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/vital-actions-candidates.json', import.meta.url), 'utf8'),
)
interface SourceDefinition {
  id: string
  trigger: string
  condition: { conditions?: { target?: { base: string } }[] }
}
const definitions = new Map<string, SourceDefinition>()
for (const name of ['global', 'ability', 'emblem', 'mark', 'skill'])
  for (const d of parse(
    readFileSync(new URL(`../../../../packs/base/data/effect_${name}.yaml`, import.meta.url), 'utf8'),
    { merge: true },
  ))
    definitions.set(d.id, d)
const oracles = new Map<Id, ReturnType<typeof EffectParser.parse>>(
  ledger.records.map((r: { id: Id }) => {
    const d = structuredClone(definitions.get(r.id)!)
    if (r.id === 'effect_skill_heal_half_damage_dealt_if_3_hits')
      d.condition.conditions![1].target!.base = 'usingSkillContext'
    return [r.id, EffectParser.parse(d)]
  }),
)
const expected: Record<Id, number> = {
  effect_skill_heal_70_double_if_field_yemu: 140,
  effect_ability_add_rage_5_when_first_attack: 5,
  effect_ability_reduce_opponent_rage_5_when_last_attack_opponent_has_kaowen: -5,
  effect_skill_add_rage_15_if_first: 15,
  effect_heal_1_16_max_hp_per_stack_if_has_niliu: 375,
  effect_skill_heal_by_damage_25_zhongzinengliang: 75,
  effect_ability_add_rage_15_if_rage_lt_opponent_at_turn_end: 15,
  effect_ability_heal_1_8_max_hp_when_rage_gt_opponent: 250,
  effect_ability_heal_half_damage_when_rage_lt_opponent: 50,
  effect_ability_add_rage_5_when_attack_opponent_has_tongjiling: 5,
  effect_ability_heal_1_16_when_qingtian: 125,
  effect_ability_huafenmiman_damage_opponent_25_per_turn: 25,
  effect_emblem_add_rage_on_hit_if_has_shunliu: 5,
  effect_mark_damage_with_stack: 3,
  effect_mark_damage_with_stack_mutilipy_10: 30,
  effect_mark_fantan_reflect_damage_1_3: 33,
  effect_mark_posion_damage: 30,
  effect_mark_reflect_physical_damage_30: 30,
  effect_mark_reflect_special_damage_max_with_stack: 101,
  effect_mark_turn_damage: 250,
  effect_skill_add_rage_25_if_opponent_shaoshang: 25,
  effect_skill_add_rage_30_if_guzhanchang: 30,
  effect_skill_add_rage_30_if_hp_below_half: 30,
  effect_skill_add_rage_40_if_feikonglingyu: 35,
  effect_skill_add_rage_opponent_45_if_opponent_has_kaowen: 45,
  effect_skill_add_self_40_rage_if_opponent_mabi: 40,
  effect_skill_heal_125_if_aideminyi: 125,
  effect_skill_heal_25_percent_damage_dealt_if_opponent_jingshencuoluan: 25,
  effect_skill_heal_half_damage_dealt_if_3_hits: 50,
  effect_skill_heal_self_1_16_if_aideminyi: 125,
  effect_skill_heal_self_by_kongqi: 3,
  effect_skill_heal_self_eighth: 250,
  effect_skill_heal_self_quarter_if_opponent_has_kaowen_on_defeat_opponent: 500,
  effect_skill_reduce_opponent_rage_30_if_opponent_has_tongjiling: -20,
  effect_skill_reduce_self_hp_1_6: 333,
  effect_skill_self_damage_25_percent: 25,
}
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
  'missing-support',
  'late-support',
  'late-value',
  'late-owner',
  'late-slot',
  'late-rage',
  'cancel',
  'inactive',
  'wrong-owner',
  'wrong-type',
  'nested',
  'repeat',
  'phase',
] as const
function run(
  id: Id,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | 'turn-first' | 'turn-second' | 'late-night',
  options: {
    damageResult?: number
    multihit?: number
    currentHp?: number
    selfRage?: number
    opponentRage?: number
    maxHp?: number
    supportStacks?: readonly number[]
    order?: 'wrong' | 'empty' | 'non-skill' | 'late'
    night?: boolean
    trackBranchReads?: boolean
    branchParameters?: { yes: number; no: number }
    lateBranchParameters?: { yes: number; no: number }
  } = {},
) {
  const d = definitions.get(id)!,
    { battle, a, b, debuff } = makeScenario(1301)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', options.maxHp ?? 2001)
    p.currentHp = options.currentHp ?? 500
  }
  a.currentRage = options.selfRage ?? 60
  b.currentRage =
    options.opponentRage ?? (id.includes('rage_gt_opponent') ? 40 : id.includes('rage_lt_opponent') ? 80 : 60)
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/vital-action' as baseSkillId,
      Category.Special,
      Element.Normal,
      40,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  skill.setOwner(a.activePet)
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const mark = new BaseMark('fixture/vital-action' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
    maxStacks: 20,
  }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  mark.stack = 3
  a.activePet.marks.push(mark)
  const source = kind === 'mark' ? mark : skill
  source.effects.push(native ? generatedVitalActions[id] : oracles.get(id)!)
  if (native) effectAuthoring.effectParameters(generatedVitalActions[id]).install(battle.configSystem)
  const setBranches = (values: { yes: number; no: number }) => {
    battle.configSystem.set(parameterAddress(id, 'parameters', 'action0_value_true'), values.yes, source)
    battle.configSystem.set(parameterAddress(id, 'parameters', 'action0_value_false'), values.no, source)
  }
  if (options.branchParameters) setBranches(options.branchParameters)
  const branchReads: string[] = []
  if (options.trackBranchReads) {
    const get = battle.configSystem.get.bind(battle.configSystem)
    const keys = ['true', 'false'].map(branch => parameterAddress(id, 'parameters', `action0_value_${branch}`))
    battle.configSystem.get = (key, targetScope) => {
      if (keys.includes(key)) branchReads.push(key)
      return get(key, targetScope)
    }
  }
  const supports: ReturnType<BaseMark['createInstance']>[] = []
  const addSupport = (baseId: string, target: typeof a.activePet | typeof battle, stack = 3) => {
    const m = new BaseMark(baseId as baseMarkId, [], { ...debuff.config, duration: -1, maxStacks: 20 }).createInstance()
    m.setOwner(target, battle.emitter)
    m.stack = stack
    target.marks.push(m)
    supports.push(m)
  }
  for (const name of [
    'mark_aideminyi',
    'mark_shunliu',
    'mark_feikonglingyu',
    'mark_huafenmiman',
    'mark_kongqichuliang',
  ])
    addSupport(name, a.activePet)
  for (const name of ['mark_niliu', 'mark_zhongzinengliang'])
    for (const stack of options.supportStacks ?? [3]) addSupport(name, a.activePet, stack)
  for (const name of ['mark_tongjiling', 'mark_shaoshang', 'mark_kaowen', 'mark_mabi', 'mark_jingshencuoluan'])
    addSupport(name, b.activePet)
  for (const name of ['mark_global_guzhanchang', 'mark_global_qingtian']) addSupport(name, battle)
  if (options.night !== false) addSupport('mark_global_yemu', battle)
  const removeSupports = () => {
    for (const m of supports) {
      const owner = m.owner
      if (owner) owner.marks = owner.marks.filter(x => x !== m)
    }
  }
  if (variant === 'missing-support') removeSupports()
  const defensive = JSON.stringify(d.condition).includes('selfBeDamaged'),
    attacker = defensive ? b : a,
    victim = defensive ? a : b
  const turn = new TurnContext(battle),
    use = new UseSkillContext(
      turn,
      attacker,
      attacker.activePet,
      AttackTargetOpinion.opponent,
      attacker.activePet.skills[0],
    )
  const isOrderEffect = /isFirstSkillUsedThisTurn|isLastSkillUsedThisTurn/.test(JSON.stringify(d.condition))
  const rival = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  if (isOrderEffect) {
    const order = options.order === 'empty' ? [] : options.order === 'wrong' ? [rival, use] : [use, rival]
    turn.appledContexts.push(...order)
    turn.contexts.push(...order)
    if (options.order === 'non-skill') {
      turn.appledContexts.unshift(new EffectContext(turn, EffectTrigger.BeforeEffect, source))
      turn.contexts.unshift(new EffectContext(turn, EffectTrigger.BeforeEffect, source))
    }
  }
  use.updateActualTarget()
  use.multihitResult = options.multihit ?? 3
  let damage = new DamageContext(
    use,
    attacker.activePet,
    victim.activePet,
    101,
    id === 'effect_mark_reflect_physical_damage_30' ? DamageType.Physical : DamageType.Special,
  )
  damage.damageResult = options.damageResult ?? 101
  if (variant === 'wrong-type') {
    damage.damageType = damage.damageType === DamageType.Physical ? DamageType.Special : DamageType.Physical
    use.multihitResult = 2
  }
  if (variant === 'wrong-owner') source.owner = b.activePet
  if (variant === 'inactive') a.activePet = a.team[1]
  let admitted = 0
  const events: { type: string; amount: number; target: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/vital-action-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'late-night') addSupport('mark_global_yemu', battle)
        if (options.lateBranchParameters) setBranches(options.lateBranchParameters)
        if (options.order === 'late') {
          turn.appledContexts.splice(0, turn.appledContexts.length, rival, use)
          turn.contexts.splice(0, turn.contexts.length, rival, use)
        }
        const outer = c.parent as EffectContext<EffectTrigger>
        if (outer.parent instanceof DamageContext) damage = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-support') removeSupports()
        if (variant === 'late-value') {
          mark.stack = 7
          damage.damageResult = 47
          a.team[0].attributeSystem.updateBaseValue('maxHp', 1001)
          for (const m of supports) m.stack = 7
        }
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-slot') b.activePet = b.team[1]
        if (variant === 'late-rage') {
          a.currentRage = 0
          b.currentRage = 0
        }
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/vital-action-events' as effectId,
      triggers: [EffectTrigger.OnDamage, EffectTrigger.OnBeforeHeal, EffectTrigger.OnRageGain],
      when: c => c.parent.parent instanceof EffectContext && c.parent.parent.effect?.id === id,
      apply(c) {
        const e = c.parent
        if (e instanceof DamageContext)
          events.push({ type: 'dealDamage', amount: e.baseDamage, target: [...a.team, ...b.team].indexOf(e.target) })
        if (e instanceof HealContext)
          events.push({ type: 'heal', amount: e.baseHeal, target: [...a.team, ...b.team].indexOf(e.target) })
        if (e instanceof RageContext) events.push({ type: 'addRage', amount: e.value, target: e.target === a ? 0 : 1 })
      },
    }),
  )
  if (variant === 'turn-first' || variant === 'turn-second') {
    const other = new SkillInstance(skill.base)
    other.setOwner(b.activePet)
    b.activePet.skills[0] = other
    battle.skillMap.set(other.id, other)
    a.activePet.attributeSystem.updateBaseValue('spe', variant === 'turn-first' ? 200 : 50)
    b.activePet.attributeSystem.updateBaseValue('spe', 100)
    a.selection = { player: a.id, type: 'use-skill', skill: skill.id, target: skill.target }
    b.selection = { player: b.id, type: 'use-skill', skill: other.id, target: other.target }
    turn.appledContexts.splice(0)
    turn.contexts.splice(0)
    executeTurnOperation(turn, battle)
    const actors = turn.appledContexts.filter((c): c is UseSkillContext => c instanceof UseSkillContext).map(c => c.pet)
    expect(actors).toEqual(variant === 'turn-first' ? [a.activePet, b.activePet] : [b.activePet, a.activePet])
  } else if (variant === 'phase') {
    if (d.trigger === 'TurnEnd') {
      a.selection = { player: a.id, type: 'do-nothing' }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
    } else if (['OnDamage', 'PostDamage'].includes(d.trigger)) {
      const p = new DamagePhase(battle, use, attacker.activePet, victim.activePet, 101, damage.damageType)
      p.initialize()
      p.execute()
    } else {
      if (d.trigger === 'OnDefeat') victim.activePet.currentHp = 1
      const p = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
      p.initialize()
      p.execute()
    }
  } else {
    const parent = d.trigger === 'TurnEnd' ? turn : ['OnHit', 'OnMiss', 'BeforeHit'].includes(d.trigger) ? use : damage
    const event = variant === 'nested' ? new EffectContext(parent, EffectTrigger.BeforeEffect, source) : parent
    battle.applyEffects<EffectTrigger>(event, EffectTrigger[d.trigger as keyof typeof EffectTrigger], source)
    if (variant === 'repeat')
      battle.applyEffects<EffectTrigger>(event, EffectTrigger[d.trigger as keyof typeof EffectTrigger], source)
  }
  return {
    branchReads,
    admitted,
    events,
    hp: [...a.team, ...b.team].map(p => p.currentHp),
    rage: [a.currentRage, b.currentRage],
    stack: mark.stack,
    next: battle.random(),
  }
}
for (const id of Object.keys(expected) as Id[]) {
  it(`${id} source`, () => {
    const r = ledger.records.find((r: { id: string }) => r.id === id),
      d = definitions.get(id)
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
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(['/apply'])
    if (r.recipe.repairedPaths.length) expect(() => EffectParser.parse(d)).toThrow()
  })
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        if (variant === 'normal') {
          expect(actual.admitted).toBe(1)
          const missing =
            kind === 'skill' &&
            [
              'effect_mark_damage_with_stack',
              'effect_mark_damage_with_stack_mutilipy_10',
              'effect_mark_posion_damage',
            ].includes(id)
          expect(actual.events.map(e => e.amount)).toEqual(missing ? [] : [expected[id]])
        }
        if (variant === 'cancel') expect(actual.events).toEqual([])
        if (variant === 'phase') expect(actual.admitted).toBeGreaterThan(0)
      })
}
it('catalog is complete and disjoint from retained candidates', () => {
  expect(Object.keys(expected).sort()).toEqual(Object.keys(generatedVitalActions).sort())
  expect(ledger.retained).toHaveLength(27)
  expect(ledger.records.some((r: { id: string }) => ledger.retained.some((k: { id: string }) => k.id === r.id))).toBe(
    false,
  )
})

for (const kind of ['skill', 'mark'] as const) {
  for (const native of [false, true]) {
    it(`0.33 reflection stays distinct from one third: ${kind}/${native}`, () => {
      expect(
        run('effect_mark_fantan_reflect_damage_1_3', native, kind, 'normal', { damageResult: 300 }).events.map(
          e => e.amount,
        ),
      ).toEqual([99])
    })
    for (const damageResult of [2000, 2001, 2002]) {
      it(`reflection cap ${damageResult}: ${kind}/${native}`, () => {
        expect(
          run('effect_mark_reflect_special_damage_max_with_stack', native, kind, 'normal', { damageResult }).events.map(
            e => e.amount,
          ),
        ).toEqual([Math.min(damageResult, 2001)])
      })
    }
    for (const currentHp of [999, 1000, 1001]) {
      it(`half HP admission ${currentHp}: ${kind}/${native}`, () => {
        const result = run('effect_skill_add_rage_30_if_hp_below_half', native, kind, 'normal', { currentHp })
        expect(result.admitted).toBe(currentHp < 1000 ? 1 : 0)
        expect(result.events.map(e => e.amount)).toEqual(currentHp < 1000 ? [30] : [])
      })
    }
    for (const multihit of [2, 3, 4]) {
      it(`exact three-hit admission ${multihit}: ${kind}/${native}`, () => {
        const result = run('effect_skill_heal_half_damage_dealt_if_3_hits', native, kind, 'normal', { multihit })
        expect(result.admitted).toBe(multihit === 3 ? 1 : 0)
        expect(result.events.map(e => e.amount)).toEqual(multihit === 3 ? [50] : [])
      })
    }
  }
}

for (const id of [
  'effect_ability_add_rage_15_if_rage_lt_opponent_at_turn_end',
  'effect_ability_heal_1_8_max_hp_when_rage_gt_opponent',
  'effect_ability_heal_half_damage_when_rage_lt_opponent',
] as const) {
  for (const kind of ['skill', 'mark'] as const) {
    for (const native of [false, true]) {
      for (const opponentRage of [59, 60, 61]) {
        it(`rage comparison boundary ${id}/${kind}/${native}/${opponentRage}`, () => {
          const expectedAdmission = id.includes('rage_gt_opponent') ? opponentRage < 60 : opponentRage > 60
          const result = run(id, native, kind, 'normal', { selfRage: 60, opponentRage })
          expect(result.admitted).toBe(Number(expectedAdmission))
          expect(result.events.map(e => e.amount)).toEqual(expectedAdmission ? [expected[id]] : [])
        })
      }
      it(`admitted rage comparison is not reevaluated ${id}/${kind}/${native}`, () => {
        const result = run(id, native, kind, 'late-rage')
        expect(result.admitted).toBe(1)
        expect(result.events.map(e => e.amount)).toEqual([expected[id]])
      })
    }
  }
}

for (const id of [
  'effect_heal_1_16_max_hp_per_stack_if_has_niliu',
  'effect_skill_heal_by_damage_25_zhongzinengliang',
] as const) {
  for (const kind of ['skill', 'mark'] as const) {
    for (const native of [false, true]) {
      for (const supportStacks of [[], [0], [1], [3], [2, 7], [7, 2]] as const) {
        it(`ordered dynamic factors ${id}/${kind}/${native}/${supportStacks}`, () => {
          const result = run(id, native, kind, 'normal', { supportStacks, maxHp: 2015, damageResult: 103 })
          const expectedAdmission = id.includes('niliu') ? supportStacks.length > 0 : true
          expect(result.admitted).toBe(Number(expectedAdmission))
          const factor = supportStacks[0] ?? 0
          expect(result.events.map(e => e.amount)).toEqual(
            expectedAdmission ? [(id.includes('niliu') ? 125 : 25) * factor] : [],
          )
        })
      }
      it(`admitted source removed before numeric read ${id}/${kind}/${native}`, () => {
        const result = run(id, native, kind, 'late-support')
        expect(result.admitted).toBe(1)
        expect(result.events.map(e => e.amount)).toEqual([0])
      })
      it(`factor and dividend read at execution ${id}/${kind}/${native}`, () => {
        const result = run(id, native, kind, 'late-value')
        expect(result.events.map(e => e.amount)).toEqual([id.includes('niliu') ? 62 * 7 : 11 * 7])
      })
    }
  }
}

for (const id of [
  'effect_ability_add_rage_5_when_first_attack',
  'effect_ability_reduce_opponent_rage_5_when_last_attack_opponent_has_kaowen',
  'effect_skill_add_rage_15_if_first',
] as const) {
  it(`C08 exact source record ${id}`, () => {
    const record = ledger.records.find((r: { id: string }) => r.id === id)
    expect(record.additionalDecisions).toEqual(['C08'])
    expect(record.recipe.orderConditions).toEqual([
      {
        path: '/condition/conditions/1',
        condition: id.includes('last_attack') ? 'isLastSkillUsedThisTurn' : 'isFirstSkillUsedThisTurn',
      },
    ])
  })
  for (const kind of ['skill', 'mark'] as const) {
    for (const order of ['wrong', 'empty', 'non-skill', 'late'] as const) {
      it(`order boundary ${id}/${kind}/${order}`, () => {
        const actual = run(id, true, kind, 'normal', { order })
        expect(actual).toEqual(run(id, false, kind, 'normal', { order }))
        const admitted = order === 'non-skill' || order === 'late'
        expect(actual.admitted).toBe(Number(admitted))
        expect(actual.events.map(e => e.amount)).toEqual(admitted ? [expected[id]] : [])
      })
    }
    for (const variant of ['turn-first', 'turn-second'] as const) {
      it(`real executor order ${id}/${kind}/${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const admitted = id.includes('last_attack') ? variant === 'turn-second' : variant === 'turn-first'
        expect(actual.admitted).toBe(Number(admitted))
        expect(actual.events.map(e => e.amount)).toEqual(admitted ? [expected[id]] : [])
      })
    }
  }
}

for (const kind of ['skill', 'mark'] as const) {
  for (const native of [false, true]) {
    for (const [variant, night, amount] of [
      ['normal', true, 140],
      ['normal', false, 70],
      ['late-support', true, 70],
      ['late-night', false, 140],
    ] as const) {
      it(`branch reads current night field ${kind}/${native}/${variant}/${night}`, () => {
        const result = run('effect_skill_heal_70_double_if_field_yemu', native, kind, variant, { night })
        expect(result.admitted).toBe(1)
        expect(result.events.map(e => e.amount)).toEqual([amount])
      })
    }
  }
  for (const night of [false, true]) {
    it(`conditional branch parameters remain editable ${kind}/${night}`, () => {
      const result = run('effect_skill_heal_70_double_if_field_yemu', true, kind, 'normal', {
        night,
        branchParameters: { yes: 180, no: 90 },
        lateBranchParameters: { yes: 0, no: 37 },
      })
      expect(result.events.map(e => e.amount)).toEqual([night ? 0 : 37])
    })
  }
}

for (const night of [false, true]) {
  it(`reads only the selected configured branch ${night}`, () => {
    const id = 'effect_skill_heal_70_double_if_field_yemu'
    const result = run(id, true, 'mark', 'normal', { night, trackBranchReads: true })
    expect(result.branchReads.length).toBeGreaterThan(0)
    expect([...new Set(result.branchReads)]).toEqual([
      parameterAddress(id, 'parameters', `action0_value_${night ? 'true' : 'false'}`),
    ])
  })
}
