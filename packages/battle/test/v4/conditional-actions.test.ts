import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedConditionalActions,
  generatedConditionalActionDependencies,
  effectAuthoring,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  Element,
  AttackTargetOpinion,
  StatTypeWithoutHp,
  setGlobalLogger,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/conditional-actions-candidates.json', import.meta.url), 'utf8'),
)
const markDefinitions = parse(readFileSync(new URL('../../../../packs/base/data/mark.yaml', import.meta.url), 'utf8'), {
  merge: true,
})
function dependencies() {
  return new Map(
    generatedConditionalActionDependencies.map(id => {
      const d = markDefinitions.find((m: { id: string }) => m.id === id)
      expect(d).toBeDefined()
      return [id, MarkParser.parse({ ...d, effect: [] })]
    }),
  )
}
const marks = dependencies(),
  candidates = createGeneratedConditionalActions(marks)
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
    for (const path of r.recipe.repairedPaths) {
      const parts = path.slice(1).split('/')
      let parent = d
      for (const part of parts.slice(0, -1)) parent = parent[part]
      expect(parent[parts.at(-1)!]).toBe('useSkillContext')
      parent[parts.at(-1)!] = 'usingSkillContext'
    }
    if (r.recipe.repairedPaths.length) expect(() => EffectParser.parse(definitions.get(id))).not.toThrow()
    expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, EffectParser.parse(d)]
  }),
)
const battles: Battle[] = [],
  errors: unknown[][] = []
let log: ReturnType<typeof vi.spyOn>
const previous = new Map<string, BaseMark | undefined>()
beforeAll(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
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
  log.mockRestore()
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
const variants = ['high', 'low', 'neither', 'fire', 'wrong-owner', 'repeat', 'last-stack', 'boundary'] as const
function setup(id: Id, native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number]) {
  const f = makeScenario(3201)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const owner = id.startsWith('effect_increase') ? f.b.activePet : f.a.activePet
  const support = (name: string, target: Pet | Battle, stack = 1, tags: string[] = []) => {
    const mark = new BaseMark(
      name as baseMarkId,
      [],
      { ...f.debuff.config, duration: -1, maxStacks: 50, stackable: true, persistent: true },
      tags,
    ).createInstance()
    mark.setOwner(target, f.battle.emitter)
    mark.stack = stack
    target.marks.push(mark)
    return mark
  }
  const sourceMark = support('fixture/conditional', owner, variant === 'last-stack' ? 1 : 3)
  const source = kind === 'mark' ? sourceMark : owner.skills[0]
  const effect = native ? candidates[id] : oracles.get(id)!
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const rich = variant !== 'low' && variant !== 'neither'
  support('mark_kongqichuliang', owner, rich ? 30 : 1)
  if (rich) {
    support('mark_bingdong', owner)
    support('mark_shijianfaze', owner)
    support('fixture/tagged', f.b.activePet, 1, ['other', 'xinzhiyinji_tag'])
    support('mark_global_yemu', f.battle)
  }
  Object.defineProperty(f.a.activePet, 'height', { value: variant === 'boundary' ? 100 : rich ? 200 : 50 })
  Object.defineProperty(f.b.activePet, 'height', { value: 100 })
  f.a.activePet.currentHp = rich ? f.a.activePet.stat.maxHp : Math.floor(f.a.activePet.stat.maxHp * 0.75)
  f.b.activePet.addStatStage(parent, StatTypeWithoutHp.spe, 2)
  if (variant === 'fire') f.b.activePet.element = Element.Fire
  const use = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.a.activePet.skills[0],
  )
  use.updateActualTarget()
  const damage = new DamageContext(use, f.a.activePet, f.b.activePet, 100)
  if (variant === 'wrong-owner')
    source.setOwner(owner === f.a.activePet ? f.b.activePet : f.a.activePet, f.battle.emitter)
  let draws = 0
  const rolls =
    variant === 'low'
      ? [0.9, 0.01]
      : variant === 'neither'
        ? [0.9, 0.9]
        : variant === 'boundary'
          ? [0.15, 0.5]
          : [0.01, 0.9]
  f.battle.random = () => {
    const value = rolls[draws % rolls.length]
    draws++
    return value
  }
  const fire = () => {
    const trigger = definitions.get(id).trigger as EffectTrigger
    if (trigger === EffectTrigger.OnBeforeCalculateDamage) f.battle.applyEffects(damage, trigger, source)
    else if (trigger === EffectTrigger.AfterUseSkillCheck) f.battle.applyEffects(use, trigger, source)
    else if (trigger === EffectTrigger.BeforeHit) f.battle.applyEffects(use, trigger, source)
    else f.battle.applyEffects(use, EffectTrigger.OnHit, source)
  }
  const read = () => ({
    draws,
    multihit: use.multihit,
    modified: damage.modified,
    marks: [f.a.activePet, f.b.activePet].map(p =>
      p.marks.map(m => [m.baseId, m.stack, m.duration]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
    source: [sourceMark.stack, sourceMark.isActive],
  })
  return { ...f, source, sourceMark, use, damage, fire, read, effect }
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const run = (native: boolean) => {
          const f = setup(id, native, kind, variant)
          f.fire()
          const trace = [structuredClone(f.read())]
          if (variant === 'repeat') {
            f.fire()
            trace.push(structuredClone(f.read()))
          }
          return trace
        }
        expect(run(true)).toEqual(run(false))
      })
it('keeps [5,8] as a first-item multihit assignment without drawing a range', () => {
  const f = setup('effect_skill_consume_xinzhiyinji_multihit', true, 'skill', 'high')
  f.fire()
  expect(f.use.multihit).toBe(5)
  expect(f.read().draws).toBe(0)
})
it('draws only the reached nested probability and changes the correct stat', () => {
  const id = 'effect_skill_add_mark_opponent_shuimian_15_percent_or_raise_spe_1_stage_50_percent'
  const yes = setup(id, true, 'skill', 'high')
  yes.fire()
  expect(yes.read().draws).toBe(1)
  expect(yes.b.activePet.marks.some(m => m.baseId === 'mark_shuimian')).toBe(true)
  const no = setup(id, true, 'skill', 'low'),
    before = [no.a.activePet.stat.spe, no.a.activePet.stat.spd]
  no.fire()
  expect(no.read().draws).toBe(2)
  expect(no.a.activePet.stat.spe).toBeGreaterThan(before[0])
  expect(no.a.activePet.stat.spd).toBe(before[1])
})
it('validates mark dependencies at construction and retains the resolved objects', () => {
  expect(() => createGeneratedConditionalActions(new Map())).toThrow('Missing or mismatched')
  const invalid = dependencies()
  invalid.set(generatedConditionalActionDependencies[0], new BaseMark('wrong' as baseMarkId, []))
  expect(() => createGeneratedConditionalActions(invalid)).toThrow('Missing or mismatched')
  const input = dependencies(),
    burn = input.get('mark_shaoshang')!
  const compiled = createGeneratedConditionalActions(input)
  input.clear()
  const f = setup('effect_skill_add_mark_opponent_shaoshang', true, 'skill', 'high')
  f.source.effects.splice(0, 1, compiled.effect_skill_add_mark_opponent_shaoshang)
  f.fire()
  expect(f.b.activePet.marks.find(m => m.baseId === 'mark_shaoshang')?.base).toBe(burn)
})

it('registers bindings from both lazy arms and switches the chosen arm at execution', () => {
  const f = setup('effect_skill_multihit_if_height_above_100', true, 'mark', 'high')
  const { compileEffect, defineEffect, actions, targets, ops } = effectAuthoring
  const stack = targets.sourceMark
    .first()
    .capture({ key: 'source', scope: 'binding' })
    .attribute('stack')
    .follow({ key: 'stack' })
  let left = true,
    calls = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/branch-bindings',
      on: 'OnHit',
      execute: actions.choose(
        () => {
          calls++
          return left
        },
        targets.ownerPet.apply(
          ops.bindAttribute({
            key: 'left',
            attribute: 'atk',
            operation: 'delta',
            value: stack,
            lifetime: 'sourceMark',
            missing: 'detach',
          }),
        ),
        targets.ownerPet.apply(
          ops.bindAttribute({
            key: 'right',
            attribute: 'def',
            operation: 'delta',
            value: stack,
            lifetime: 'sourceMark',
            missing: 'detach',
          }),
        ),
      ),
    }),
  )
  const pet = f.a.activePet,
    before = [pet.stat.atk, pet.stat.def]
  const fire = () =>
    f.battle.executionBudget.run(0, () => effect.innerApply(new EffectContext(f.use, EffectTrigger.OnHit, f.source)))
  fire()
  expect([pet.stat.atk, pet.stat.def]).toEqual([before[0] + 3, before[1]])
  left = false
  fire()
  f.sourceMark.stack = 4
  expect(calls).toBe(2)
  expect([pet.stat.atk, pet.stat.def]).toEqual([before[0] + 4, before[1] + 4])
})
for (const id of ids)
  it(`restores ${id} with fresh mark dependencies and a fresh effect factory`, async () => {
    const f = setup(id, true, 'mark', 'high')
    f.fire()
    // Remove the trace-only RNG override before serializing the engine's own RNG state.
    Reflect.deleteProperty(f.battle, 'random')
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(m => {
        if (m.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const run = f.battle.startBattle().catch(() => {})
    await ready
    function catalog(effect: typeof f.effect) {
      const c = new SnapshotCatalog('conditional-actions/v1')
      for (const skill of f.battle.skillMap.values())
        for (const e of [...skill.base.effects, ...skill.effects]) c.registerEffect(e.id, e)
      for (const e of f.debuff.effects) c.registerEffect(e.id, e)
      effectAuthoring.registerEffect(c, effect)
      return c
    }
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
    function resume(battle: Battle) {
      const a = battle.playerA,
        b = battle.playerB
      const source = [...a.team, ...b.team].flatMap(p => p.marks).find(m => m.id === f.sourceMark.id)!
      expect(source).toBeDefined()
      let draws = 0
      battle.random = () => {
        draws++
        return 0.01
      }
      const use = new UseSkillContext(
        new TurnContext(battle),
        a,
        a.activePet,
        AttackTargetOpinion.opponent,
        a.activePet.skills[0],
      )
      use.updateActualTarget()
      const damage = new DamageContext(use, a.activePet, b.activePet, 100)
      const trigger = definitions.get(id).trigger as EffectTrigger
      if (trigger === EffectTrigger.OnBeforeCalculateDamage) battle.applyEffects(damage, trigger, source)
      else if (trigger === EffectTrigger.AfterUseSkillCheck) battle.applyEffects(use, trigger, source)
      else if (trigger === EffectTrigger.BeforeHit) battle.applyEffects(use, trigger, source)
      else battle.applyEffects(use, EffectTrigger.OnHit, source)
      return {
        draws,
        multihit: use.multihit,
        modified: damage.modified,
        marks: [a.activePet, b.activePet].map(p =>
          p.marks.map(m => [m.baseId, m.stack, m.duration]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ),
      }
    }
    const expected = resume(f.battle)
    await f.battle.cleanup()
    await run
    const restored = restoreBattle(saved, catalog(createGeneratedConditionalActions(dependencies())[id]))
    battles.push(restored)
    expect(resume(restored)).toEqual(expected)
  })
