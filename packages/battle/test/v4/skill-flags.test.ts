import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedSkillFlags,
  createGeneratedSkillFlags,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  AddMarkContext,
  RemoveMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  Category,
  Element,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type Id = keyof typeof generatedSkillFlags
const ids = Object.keys(generatedSkillFlags) as Id[]
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-flags-candidates.json', import.meta.url), 'utf8'),
)
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
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, d]
  }),
)
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.get(id))]))
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
function fixture(id: Id, native: boolean, kind: 'mark' | 'skill') {
  const f = makeScenario(2801)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const matchedId =
    definitions
      .get(id)!
      .apply.target.chain.find(
        (x: { type: string; extractor?: { arg: string } }) => x.type === 'whereAttr' && x.extractor?.arg === 'baseId',
      )?.evaluator.value ?? 'fixture/match'
  const rows: [string, Category, Element, number, string[]][] = Array.from({ length: 6 }, (_, i) => [
    i % 2 === 0 ? matchedId : `fixture/${i}`,
    Category.Physical,
    [0, 2, 5].includes(i) ? Element.Fire : Element.Normal,
    70,
    [],
  ])
  const skills = rows.map(([key, category, element, power, tags], i) => {
    const s = new SkillInstance(
      new BaseSkill(
        key as baseSkillId,
        category,
        element,
        power,
        80,
        20,
        0,
        AttackTargetOpinion.opponent,
        ([1, 2, [1, 2], [1, 1], [2, 3], 2] as (number | [number, number])[])[i],
        false,
        false,
        false,
        undefined,
        tags,
      ),
    )
    s.setOwner(f.a.activePet)
    f.battle.skillMap.set(s.id, s)
    return s
  })
  f.a.activePet.skills = skills
  const sourceMark = new BaseMark('fixture/skill-flag' as baseMarkId, [], {
    ...f.debuff.config,
    duration: -1,
  }).createInstance()
  sourceMark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : skills[0],
    effect = native ? generatedSkillFlags[id] : oracles.get(id)!
  source.effects.push(effect)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, skills[0])
  const event = new AddMarkContext(parent, f.a.activePet, sourceMark.base)
  return { ...f, skills, sourceMark, source, parent, event, effect }
}
function run(id: Id, native: boolean, kind: 'mark' | 'skill', variant: string) {
  const f = fixture(id, native, kind)
  const all = [...f.skills, ...f.a.team[1].skills]
  const read = () => all.map(s => s.sureHit)
  let admitted = 0
  f.b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/observe' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'late-owner') f.source.setOwner(f.a.team[1], f.battle.emitter)
        if (variant === 'late-membership') f.a.activePet.skills = f.skills.slice(1)
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  if (variant === 'empty') f.a.activePet.skills = []
  const use = () =>
    new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, f.skills[0])
  const hit = (c: UseSkillContext) => {
    c.accuracy = -1
    c.updateHitResult()
    return c.hitResult
  }
  const beforeUse = use()
  const fire = () => f.battle.applyEffects(f.battle, EffectTrigger.OnBattleStart, f.source)
  fire()
  const first = read()
  if (variant === 'repeat') fire()
  const repeated = read()
  f.sourceMark.isSuppressed = true
  const suppressed = read()
  f.sourceMark.isSuppressed = false
  f.battle.removeMark(new RemoveMarkContext(f.parent, f.sourceMark))
  return {
    first,
    repeated,
    suppressed,
    removed: read(),
    admitted,
    base: f.skills.map(s => s.base.sureHit),
    useBefore: hit(beforeUse),
    useAfter: hit(use()),
  }
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of ['normal', 'repeat', 'late-owner', 'late-membership', 'cancel', 'empty'])
      it(`${id}/${kind}/${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
for (const id of ids)
  it(`persistent instance state ${id}`, () => {
    const r = run(id, true, 'mark', 'normal')
    const expected = id.includes('multi_hit')
      ? [false, true, false, false, true, true]
      : id.includes('jihuo')
        ? [true, false, true, false, false, true]
        : [true, false, true, false, true, false]
    expect(r.first.slice(0, 6)).toEqual(expected)
    expect(r.removed).toEqual(r.first)
    expect(r.suppressed).toEqual(r.first)
    expect(r.base).toEqual(Array(6).fill(false))
    expect(r.useBefore).toBe(false)
    expect(r.useAfter).toBe(expected[0])
  })
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    it(`checkpoint ${id}/${kind}`, async () => {
      const f = fixture(id, true, kind)
      const read = () => f.skills.map(s => s.sureHit)
      const ready = new Promise<void>(resolve =>
        f.battle.registerListener(m => {
          if (m.type === BattleMessageType.TurnAction) resolve()
        }),
      )
      const run = f.battle.startBattle().catch(() => {})
      await ready
      const expected = read()
      const catalog = (effect: typeof f.effect) => {
        const c = new SnapshotCatalog(`skill-flag/${id}/${kind}`)
        for (const skill of f.battle.skillMap.values())
          for (const e of [...skill.base.effects, ...skill.effects]) if (e.id !== id) c.registerEffect(e.id, e)
        for (const e of f.debuff.effects) c.registerEffect(e.id, e)
        return effectAuthoring.registerEffect(c, effect)
      }
      const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
      await f.battle.cleanup()
      await run
      const restored = restoreBattle(saved, catalog(createGeneratedSkillFlags()[id]))
      battles.push(restored)
      const pet = restored.playerA.activePet,
        mark = pet.marks.find(m => m.baseId === 'fixture/skill-flag')!
      const readRestored = () => pet.skills.map(s => s.sureHit)
      expect(readRestored()).toEqual(expected)
      restored.removeMark(
        new RemoveMarkContext(
          new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0]),
          mark,
        ),
      )
      expect(readRestored()).toEqual(expected)
    })
it('skills added later remain unchanged until the next selector execution', () => {
  const f = fixture('effect_emblem_jihuo_fire_skill_sure_hit', true, 'mark')
  const fire = () => f.battle.applyEffects(f.battle, EffectTrigger.OnBattleStart, f.source)
  fire()
  const added = new SkillInstance(f.skills[0].base)
  added.setOwner(f.a.activePet)
  f.battle.skillMap.set(added.id, added)
  f.a.activePet.skills.push(added)
  expect(added.sureHit).toBe(false)
  fire()
  expect(added.sureHit).toBe(true)
})
