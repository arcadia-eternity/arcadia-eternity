import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  AddMarkContext,
  StackContext,
  StackStrategy,
  Category,
  Element,
  AttackTargetOpinion,
  defineNativeEffect,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type MarkInstance,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import {
  createGeneratedCompoundActions,
  generatedCompoundActionDependencies,
} from '@arcadia-eternity/data-pack-base/native'

const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/compound-actions-candidates.json', import.meta.url), 'utf8'),
)
const allMarks = ['mark', 'mark_global', 'mark_ability', 'mark_emblem'].flatMap(n =>
  parse(
    readFileSync(
      new URL(
        `${n.startsWith('effect_') ? './fixtures/effect-regression' : '../../../../packs/base/data'}/${n}.yaml`,
        import.meta.url,
      ),
      'utf8',
    ),
    { merge: true },
  ),
)
function dependencies() {
  return new Map(
    generatedCompoundActionDependencies.map(id => {
      const d = allMarks.find(m => m.id === id)
      expect(d).toBeDefined()
      return [id, MarkParser.parse({ ...d, effect: [] })]
    }),
  )
}
const marks = dependencies(),
  candidates = createGeneratedCompoundActions(marks)
type Id = keyof typeof candidates
const ids = Object.keys(candidates) as Id[]
function normalize(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
        )
      : v
}
const definitions = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    return [id, d]
  }),
)
const oracles = new Map(
  ids.map(id => {
    const d = structuredClone(definitions.get(id)),
      r = ledger.records.find((r: { id: string }) => r.id === id)
    if (r.recipe.pathRepairs?.length) expect(() => EffectParser.parse(definitions.get(id))).toThrow()
    else expect(() => EffectParser.parse(definitions.get(id))).not.toThrow()
    for (const path of r.recipe.repairedPaths) {
      const parts = path.slice(1).split('/')
      let parent = d
      for (const part of parts.slice(0, -1)) parent = parent[part]
      expect(parent[parts.at(-1)!]).toBe('useSkillContext')
      parent[parts.at(-1)!] = 'usingSkillContext'
    }
    if (id === 'effect_mark_shandianluoyin_paralyze') {
      expect(() => EffectParser.parse(d)).toThrow()
      expect(d.condition.conditions[1].target.chain[0].arg).toBe('skillId')
      d.condition.conditions[1].target.chain[0].arg = 'skill'
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
      ])
    } else expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, EffectParser.parse(d)]
  }),
)
const battles: Battle[] = [],
  errors: unknown[][] = []
const previous = new Map<string, BaseMark | undefined>()
beforeAll(() => {
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  })
  const repo = DataRepository.getInstance()
  for (const [id, mark] of marks) {
    previous.set(id, repo.marks.get(id))
    repo.marks.set(id, mark)
  }
})
afterAll(() => {
  const repo = DataRepository.getInstance()
  for (const [id, mark] of previous) {
    if (mark) repo.marks.set(id, mark)
    else repo.marks.delete(id)
  }
})
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = ['match', 'missing', 'wrong-owner', 'boundary', 'repeat', 'ice', 'duplicate', 'roll-fail'] as const
type Variant = (typeof variants)[number]
function dispatch(
  id: Id,
  battle: Battle,
  source: MarkInstance | SkillInstance,
  sourceMark: MarkInstance,
  variant: Variant,
  stacksBefore = variant === 'boundary' ? 3 : 0,
) {
  const a = battle.playerA,
    b = battle.playerB
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    a.activePet,
    AttackTargetOpinion.opponent,
    a.activePet.skills[0],
  )
  use.updateActualTarget()
  use.category = Category.Physical
  use.multihitResult = variant === 'boundary' ? 1 : 2
  const damage = new DamageContext(use, a.activePet, b.activePet, 100)
  damage.damageResult = variant === 'boundary' ? 800 : 901
  const parent = new EffectContext(use, EffectTrigger.OnHit, a.activePet.skills[0])
  const add = new AddMarkContext(parent, sourceMark.owner!, sourceMark.base)
  const stack = new StackContext(
    add,
    sourceMark,
    sourceMark.base.createInstance(),
    stacksBefore,
    -1,
    sourceMark.stack,
    -1,
    StackStrategy.stack,
  )
  let draws = 0
  battle.random = () => {
    draws++
    return variant === 'roll-fail' ? 0.99 : 0.01
  }
  switch (definitions.get(id).trigger) {
    case 'OnHit':
      battle.applyEffects(use, EffectTrigger.OnHit, source)
      break
    case 'OnMiss':
      battle.applyEffects(use, EffectTrigger.OnMiss, source)
      break
    case 'OnDamage':
      battle.applyEffects(damage, EffectTrigger.OnDamage, source)
      break
    case 'PostDamage':
      battle.applyEffects(damage, EffectTrigger.PostDamage, source)
      break
    case 'TurnEnd':
      battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
      break
    case 'OnMarkCreated':
      battle.applyEffects(add, EffectTrigger.OnMarkCreated, source)
      break
    case 'OnStack':
      battle.applyEffects(stack, EffectTrigger.OnStack, source)
      break
    case 'BeforeMultiHit':
      battle.applyEffects(use, EffectTrigger.BeforeMultiHit, source)
      break
    case 'AfterUseSkillCheck':
      battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck, source)
      break
    case 'BeforeSort':
      battle.applyEffects(use, EffectTrigger.BeforeSort, source)
      break
    default:
      throw new Error('Unsupported fixture trigger')
  }
  return { draws, priority: use.priority, multihit: use.multihit, multihitResult: use.multihitResult }
}
function setup(id: Id, native: boolean, kind: 'mark' | 'skill', variant: Variant) {
  const f = makeScenario(3301)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const actorSkill = new SkillInstance(
    new BaseSkill(
      'skill_shandianluoyin' as baseSkillId,
      Category.Physical,
      Element.Normal,
      40,
      100,
      5,
      0,
      AttackTargetOpinion.opponent,
    ),
  )
  actorSkill.setOwner(f.a.activePet)
  f.a.activePet.skills[0] = actorSkill
  f.battle.skillMap.set(actorSkill.id, actorSkill)
  for (const category of [Category.Special, Category.Status, Category.Climax]) {
    const s = new SkillInstance(
      new BaseSkill(
        `fixture/${category}` as baseSkillId,
        category,
        Element.Normal,
        60,
        100,
        10,
        0,
        AttackTargetOpinion.opponent,
      ),
    )
    s.setOwner(f.a.activePet)
    f.a.activePet.skills.push(s)
    f.battle.skillMap.set(s.id, s)
  }
  const defensive = [
    'effect_mark_xukongtizhi_consume_on_evasion',
    'effect_mark_shandianluoyin_paralyze',
    'effect_mark_add_crit_on_damage',
  ].includes(id)
  const owner = defensive ? f.b.activePet : f.a.activePet
  const support = (name: string, target: Pet, stack = 1) => {
    const m = new BaseMark(name as baseMarkId, [], {
      ...f.debuff.config,
      duration: -1,
      maxStacks: 1000,
      stackable: true,
      persistent: true,
    }).createInstance()
    m.setOwner(target, f.battle.emitter)
    m.stack = stack
    target.marks.push(m)
    return m
  }
  const sourceMark = support('fixture/compound-source', owner, variant === 'boundary' ? 1 : 6)
  const source = kind === 'mark' ? sourceMark : owner.skills[0]
  const effect = native ? candidates[id] : oracles.get(id)!
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  if (variant !== 'missing') {
    for (const name of ['mark_xukongtizhi', 'mark_yitelingyu', 'mark_huanxiang', 'mark_shazhidanke', 'mark_dongqifuti'])
      support(name, owner, 1)
    for (const name of ['mark_maimaijinzhen', 'mark_maidijinzhen', 'mark_yinbo', 'mark_dongqifuti'])
      support(name, f.b.activePet, 7)
  }
  if (variant === 'duplicate') support('mark_yinbo', f.b.activePet, 9)
  if (variant === 'ice') f.b.activePet.element = Element.Ice
  if (variant === 'wrong-owner')
    source.setOwner(owner === f.a.activePet ? f.b.activePet : f.a.activePet, f.battle.emitter)
  const fire = () => dispatch(id, f.battle, source, sourceMark, variant)
  return { ...f, owner, sourceMark, source, support, effect, fire }
}
function state(battle: Battle) {
  return [...battle.playerA.team, ...battle.playerB.team].map(p => ({
    marks: p.marks.map(m => [m.baseId, m.stack, m.duration]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    skills: p.skills.map(s => [s.category, s.power, s.rage]),
  }))
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const run = (native: boolean) => {
          const f = setup(id, native, kind, variant)
          const trace = [{ event: f.fire(), state: state(f.battle) }]
          if (variant === 'repeat') trace.push({ event: f.fire(), state: state(f.battle) })
          return trace
        }
        expect(run(true)).toEqual(run(false))
      })
it('reads yinbo stack before destroying every selected source', () => {
  const f = setup('effect_skill_consume_opponent_yinbo_add_zaoyin', true, 'skill', 'duplicate')
  f.fire()
  expect(f.b.activePet.marks.some(m => m.baseId === 'mark_yinbo')).toBe(false)
  expect(f.b.activePet.marks.find(m => m.baseId === 'mark_zaoyin')?.stack).toBe(7)
})
it('uses the first list value for multihit and consumes after assignment', () => {
  const f = setup('effect_skill_consume_huanxiang_multihit_4_to_5', true, 'skill', 'match')
  expect(f.fire().multihit).toBe(4)
  expect(f.a.activePet.marks.some(m => m.baseId === 'mark_huanxiang')).toBe(false)
})
it('requeries the opponent after the consumption callback changes its position', () => {
  const run = (native: boolean) => {
    const f = setup('effect_skill_consume_maimaijinzhen_add_liuxie_50', native, 'skill', 'match'),
      old = f.b.activePet,
      next = f.b.team[1]
    const support = old.marks.find(m => m.baseId === 'mark_maimaijinzhen')!
    support.stack = 1
    support.effects.push(
      defineNativeEffect({
        id: 'fixture/switch-after-consume' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          f.b.activePet = next
        },
      }),
    )
    f.fire()
    expect(old.marks.some(m => m.baseId === 'mark_liuxie')).toBe(false)
    expect(next.marks.find(m => m.baseId === 'mark_liuxie')?.stack).toBe(50)
    return state(f.battle)
  }
  expect(run(true)).toEqual(run(false))
})
for (const id of ids)
  it(`checkpoints ${id} before execution with a fresh factory`, async () => {
    const f = setup(id, true, 'mark', 'match')
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(m => {
        if (m.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const run = f.battle.startBattle().catch(() => {})
    await ready
    function catalog(effect: typeof f.effect) {
      const c = new SnapshotCatalog('compound-actions/v1')
      for (const s of f.battle.skillMap.values())
        for (const e of [...s.base.effects, ...s.effects]) c.registerEffect(e.id, e)
      for (const e of f.debuff.effects) c.registerEffect(e.id, e)
      effectAuthoring.registerEffect(c, effect)
      return c
    }
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
    const event = f.fire(),
      expected = state(f.battle)
    await f.battle.cleanup()
    await run
    const restored = restoreBattle(saved, catalog(createGeneratedCompoundActions(dependencies())[id]))
    battles.push(restored)
    const source = [...restored.playerA.team, ...restored.playerB.team]
      .flatMap(p => p.marks)
      .find(m => m.id === f.sourceMark.id)!
    expect(dispatch(id, restored, source, source, 'match')).toEqual(event)
    expect(state(restored)).toEqual(expected)
  })

for (const [id, threshold, created] of [
  ['effect_mark_fear_consume_stacks_at_3', 3, 'mark_kongju'],
  ['effect_mark_hunluan_consume_stacks_at_2', 2, 'mark_hunluan'],
] as const)
  it(`checks the exact stack crossing for ${id}`, () => {
    for (const before of [0, threshold - 1, threshold, threshold + 1])
      for (const after of [threshold - 1, threshold, threshold + 1]) {
        const run = (native: boolean) => {
          const f = setup(id, native, 'mark', 'match')
          f.sourceMark.stack = after
          dispatch(id, f.battle, f.source, f.sourceMark, 'match', before)
          const applied = f.owner.marks.some(m => m.baseId === created)
          expect(applied).toBe(before < threshold && after >= threshold)
          expect(f.sourceMark.isActive).toBe(!applied)
          return state(f.battle)
        }
        expect(run(true)).toEqual(run(false))
      }
  })
it('caps Baiya/Heiya at 800 using the damage value before mark creation', () => {
  for (const [id, mark] of [
    ['effect_skill_add_mark_opponent_baiya_equal_damage_max_800', 'mark_baiya'],
    ['effect_skill_add_mark_opponent_heiya_equal_damage_max_800', 'mark_heiya'],
  ] as const) {
    const f = setup(id, true, 'skill', 'match')
    f.fire()
    expect(f.b.activePet.marks.find(m => m.baseId === mark)?.stack).toBe(800)
  }
})
it('doubles rage and power only for Physical/Special skills and follows source suppression', () => {
  const f = setup('effect_mark_double_rage_cost_double_damage_non_climax', true, 'mark', 'match')
  const before = f.a.activePet.skills.map(s => [s.power, s.rage])
  f.fire()
  f.a.activePet.skills.forEach((s, i) =>
    expect([s.power, s.rage]).toEqual(
      before[i].map(n => ([Category.Status, Category.Climax].includes(s.category) ? n : n * 2)),
    ),
  )
  f.sourceMark.isSuppressed = true
  expect(f.a.activePet.skills.map(s => [s.power, s.rage])).toEqual(before)
})
