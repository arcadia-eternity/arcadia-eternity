import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  AttackTargetOpinion,
  AddMarkContext,
  RemoveMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  setGlobalLogger,
  defineValue,
  values,
  installValueModifier,
  type Battle,
  type baseMarkId,
  type baseSkillId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createGeneratedSkillContributions } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_amplify_power_20x_stack'
const original = parse(readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'), {
  merge: true,
}).find((d: { id: string }) => d.id === id)
const legacy = EffectParser.parse(original)
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
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(errors.splice(0)).toEqual([])
})
function setup(native: boolean) {
  const f = makeScenario(2901)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const effect = native ? createGeneratedSkillContributions()[id] : legacy
  const pet = f.a.activePet
  function addSkill(category: Category, suffix: string) {
    const skill = new SkillInstance(
      new BaseSkill(
        `fixture/${suffix}` as baseSkillId,
        category,
        Element.Normal,
        70,
        100,
        0,
        0,
        AttackTargetOpinion.opponent,
      ),
    )
    skill.setOwner(pet)
    pet.skills.push(skill)
    f.battle.skillMap.set(skill.id, skill)
    return skill
  }
  pet.skills.splice(0)
  const skills = [Category.Physical, Category.Special, Category.Status, Category.Climax].map((category, i) =>
    addSkill(category, String(i)),
  )
  const base = new BaseMark('fixture/live-skill' as baseMarkId, [effect], {
    ...f.debuff.config,
    maxStacks: 20,
    stackable: true,
    duration: -1,
    persistent: true,
    keepOnSwitchOut: true,
  })
  const mark = base.createInstance()
  mark.setOwner(pet, f.battle.emitter)
  pet.marks.push(mark)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, skills[0])
  const event = new AddMarkContext(parent, pet, base)
  const fire = () => f.battle.applyEffects(event, EffectTrigger.OnMarkCreated, mark)
  return { ...f, pet, skills, addSkill, mark, parent, fire, effect }
}
it('matches legacy live stack changes, repeated applications, suppression and removal', () => {
  const run = (native: boolean) => {
    const f = setup(native),
      trace: number[][] = []
    const read = () => trace.push(f.skills.map(s => s.power))
    f.mark.stack = 2
    f.fire()
    read()
    f.mark.stack = 3
    read()
    f.fire()
    read()
    f.mark.stack = 4
    read()
    f.mark.isSuppressed = true
    read()
    f.mark.isSuppressed = false
    read()
    f.battle.removeMark(new RemoveMarkContext(f.parent, f.mark))
    read()
    return trace
  }
  const actual = run(true)
  expect(actual).toEqual(run(false))
  expect(actual).toEqual([
    [110, 110, 70, 110],
    [130, 130, 70, 130],
    [190, 190, 70, 190],
    [230, 230, 70, 230],
    [70, 70, 70, 70],
    [230, 230, 70, 230],
    [70, 70, 70, 70],
  ])
})
it('requeries skill membership on application while existing contributions keep their targets', () => {
  const run = (native: boolean) => {
    const f = setup(native)
    f.mark.stack = 2
    f.fire()
    const late = f.addSkill(Category.Physical, 'late')
    f.mark.stack = 3
    const before = [f.skills[0].power, late.power]
    f.fire()
    f.mark.stack = 4
    return [before, [f.skills[0].power, late.power]]
  }
  expect(run(true)).toEqual(run(false))
  expect(run(true)).toEqual([
    [130, 70],
    [230, 150],
  ])
})
it('restores skill-bound contributions with a fresh factory and cleans every target on source removal', async () => {
  const f = setup(true)
  f.mark.stack = 2
  f.fire()
  f.fire()
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(() => {})
  await ready
  function catalog(effect: typeof f.effect) {
    const result = new SnapshotCatalog('live-skill-contribution/v1')
    for (const skill of f.battle.skillMap.values())
      for (const e of [...skill.base.effects, ...skill.effects]) result.registerEffect(e.id, e)
    for (const e of f.debuff.effects) result.registerEffect(e.id, e)
    effectAuthoring.registerEffect(result, effect)
    return result
  }
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(saved, catalog(createGeneratedSkillContributions()[id]))
  battles.push(restored)
  const pet = restored.playerA.activePet,
    mark = pet.marks.find(m => m.baseId === 'fixture/live-skill')!
  expect(pet.skills.map(s => s.power)).toEqual([150, 150, 70, 150])
  mark.stack = 3
  expect(pet.skills.map(s => s.power)).toEqual([190, 190, 70, 190])
  const ctx = new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0])
  restored.removeMark(new RemoveMarkContext(ctx, mark))
  expect(pet.skills.map(s => s.power)).toEqual([70, 70, 70, 70])
})

it('rejects circular skill dependencies and cross-battle targets or reads', () => {
  const f = setup(true),
    other = setup(true)
  const install = (read: SkillInstance, target = f.skills[0]) =>
    installValueModifier({
      definition: defineValue('fixture/skill-read', (skill: SkillInstance) =>
        values.reactive(skill.attributeSystem.getAttribute$('power')).map(Number),
      ),
      args: read,
      source: f.mark,
      effectId: 'fixture/skill-read',
      bindingKey: 'power',
      target,
      attribute: 'power',
      operation: 'delta',
    })
  expect(() => install(f.skills[0])).toThrow('Circular value binding')
  expect(() => install(other.skills[0])).toThrow('Cross-battle attribute read')
  expect(() => install(f.skills[1], other.skills[0])).toThrow('Cross-battle value binding')
  expect(f.skills[0].power).toBe(70)
  expect(other.skills[0].power).toBe(70)
})
it('records the exact legacy source without repairs', () => {
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
  const ledger = JSON.parse(
    readFileSync(
      new URL('../../../../docs/v4/validation/skill-contributions-candidates.json', import.meta.url),
      'utf8',
    ),
  )
  const record = ledger.records.find((r: { id: string }) => r.id === id)
  expect(record.definitionSha256).toBe(
    createHash('sha256')
      .update(JSON.stringify(normalize(original)))
      .digest('hex'),
  )
  expect(record.recipe.repairedPaths).toEqual([])
})
