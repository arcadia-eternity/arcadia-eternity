import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
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
import { generatedSkillContributions, createGeneratedSkillContributions } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedSkillContributions
const ids = Object.keys(generatedSkillContributions).filter(id => id !== 'effect_mark_amplify_power_20x_stack') as Id[]
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-contributions-candidates.json', import.meta.url), 'utf8'),
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
  const rows: [string, Category, Element, number, string[]][] = [
    ['fixture/light', Category.Physical, Element.Light, 70, ['fasi']],
    ['fixture/electric', Category.Special, Element.Electric, 110, ['other', 'huashen']],
    ['skill_ziwocuimian', Category.Status, Element.Normal, 50, ['huashen']],
    ['fixture/climax', Category.Climax, Element.Light, 90, []],
    ['skill_shahezhili', Category.Physical, Element.Electric, 99, []],
  ]
  const skills = rows.map(([key, category, element, power, tags]) => {
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
        1,
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
  const sourceMark = new BaseMark('fixture/skill-contribution' as baseMarkId, [], {
    ...f.debuff.config,
    duration: -1,
  }).createInstance()
  sourceMark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : skills[0],
    effect = native ? generatedSkillContributions[id] : oracles.get(id)!
  source.effects.push(effect)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, skills[0])
  const event = new AddMarkContext(parent, f.a.activePet, sourceMark.base)
  return { ...f, skills, sourceMark, source, parent, event, effect }
}
function run(id: Id, native: boolean, kind: 'mark' | 'skill', variant: string) {
  const f = fixture(id, native, kind),
    d = definitions.get(id)!
  const skills = [...f.skills, ...f.a.team[1].skills]
  const read = () => skills.map(s => s.attributeSystem.getAttribute$(d.apply.attribute).value)
  const before = read()
  let admitted = 0
  f.b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/skill-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'late-owner') f.source.setOwner(f.a.team[1], f.battle.emitter)
        if (variant === 'late-power') f.skills[0].power = 120
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  if (variant === 'empty') f.a.activePet.skills = []
  const fire = () =>
    f.battle.applyEffects<EffectTrigger>(d.trigger === 'OnBattleStart' ? f.battle : f.event, d.trigger, f.source)
  fire()
  const first = read()
  if (variant === 'repeat') fire()
  const repeated = read()
  const sources = skills.map(
    s =>
      s.attributeSystem
        .getDetailedModifierState()
        .attributes.find(a => a.attributeName === d.apply.attribute)
        ?.modifiers.map(m =>
          m.sourceId === f.sourceMark.id
            ? 'mark'
            : m.sourceId === s.id
              ? 'target-skill'
              : m.sourceId === undefined
                ? 'none'
                : 'other',
        ) ?? [],
  )
  const use = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.skills[0],
  )
  const resolved = [use.power, use.accuracy, use.rage, use.priority]
  f.sourceMark.isSuppressed = true
  const suppressed = read()
  f.sourceMark.isSuppressed = false
  f.battle.removeMark(new RemoveMarkContext(f.parent, f.sourceMark))
  const removed = read()
  return { before, first, repeated, sources, resolved, suppressed, removed, admitted }
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of ['normal', 'repeat', 'late-owner', 'late-power', 'cancel', 'empty'])
      it(`${id}/${kind}/${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    it(`lifetime metadata ${id}/${kind}`, () => {
      const r = run(id, true, kind, 'normal')
      for (const sources of r.sources)
        for (const source of sources) expect(source).toBe(kind === 'mark' ? 'mark' : 'target-skill')
      expect(r.removed).toEqual(kind === 'mark' ? r.before : r.first)
      expect(r.suppressed).toEqual(kind === 'mark' ? r.before : r.first)
    })
it('climax exclusion and all-tag matching are literal source behavior', () => {
  const rage = run('effect_emblem_reduce_light_skill_rage_cost_5', true, 'mark', 'normal')
  expect(rage.first.slice(0, 5)).toEqual([15, 20, 20, 20, 20])
  const tags = run('effect_emblem_huashen_skill_rage_cost_reduce_5', true, 'mark', 'normal')
  expect(tags.first.slice(0, 5)).toEqual([20, 15, 15, 20, 20])
})
it('power threshold selection requeries after prior override', () => {
  const r = run('effect_mark_anyingzhiguang_power_min_100', true, 'mark', 'repeat')
  expect(r.first.slice(0, 5)).toEqual([100, 110, 50, 100, 100])
  expect(r.sources.slice(0, 5).map(x => x.length)).toEqual([1, 0, 0, 1, 1])
})
it('sourceSkill selects the effect source rather than the current skill event', () => {
  const f = fixture('effect_skill_lock_rage_to_10', true, 'skill')
  const { compileEffect, defineEffect, targets } = effectAuthoring
  const event = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.skills[1],
  )
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/source-skill',
      on: 'BeforeUseSkillCheck',
      execute(ctx) {
        expect(ctx.read(targets.sourceSkill.first())).toBe(f.source)
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () =>
    effect.innerApply(new EffectContext(event, EffectTrigger.BeforeUseSkillCheck, f.source, effect)),
  )
})

for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    it(`checkpoint ${id}/${kind}`, async () => {
      const f = fixture(id, true, kind),
        d = definitions.get(id)!
      const read = () => f.skills.map(s => s.attributeSystem.getAttribute$(d.apply.attribute).value)
      const before = read(),
        fire = () =>
          f.battle.applyEffects<EffectTrigger>(d.trigger === 'OnBattleStart' ? f.battle : f.event, d.trigger, f.source)
      // Starting a battle naturally dispatches OnBattleStart once; install manually only for OnMarkCreated.
      if (d.trigger === 'OnMarkCreated') fire()
      const ready = new Promise<void>(resolve =>
        f.battle.registerListener(m => {
          if (m.type === BattleMessageType.TurnAction) resolve()
        }),
      )
      const run = f.battle.startBattle().catch(() => {})
      await ready
      const expected = read()
      const catalog = (effect: typeof f.effect) => {
        const c = new SnapshotCatalog(`skill-contribution/${id}/${kind}`)
        for (const skill of f.battle.skillMap.values())
          for (const e of [...skill.base.effects, ...skill.effects]) if (e.id !== id) c.registerEffect(e.id, e)
        for (const e of f.debuff.effects) c.registerEffect(e.id, e)
        return effectAuthoring.registerEffect(c, effect)
      }
      const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
      await f.battle.cleanup()
      await run
      const restored = restoreBattle(saved, catalog(createGeneratedSkillContributions()[id]))
      battles.push(restored)
      const pet = restored.playerA.activePet,
        mark = pet.marks.find(m => m.baseId === 'fixture/skill-contribution')!
      const readRestored = () => pet.skills.map(s => s.attributeSystem.getAttribute$(d.apply.attribute).value)
      expect(readRestored()).toEqual(expected)
      for (const skill of pet.skills) {
        const contributions =
          skill.attributeSystem.getDetailedModifierState().attributes.find(a => a.attributeName === d.apply.attribute)
            ?.modifiers ?? []
        for (const contribution of contributions)
          expect(contribution.sourceId).toBe(kind === 'mark' ? mark.id : skill.id)
      }
      restored.removeMark(
        new RemoveMarkContext(
          new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0]),
          mark,
        ),
      )
      expect(readRestored()).toEqual(kind === 'mark' ? before : expected)
    })
