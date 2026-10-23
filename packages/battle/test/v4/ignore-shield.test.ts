import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  SkillInstance,
  defineNativeEffect,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  effectAuthoring,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedIgnoreShield, createGeneratedIgnoreShield } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_ignore_opponent_shield_if_has_shunliu'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = ['absent', 'present', 'late-remove', 'cancel', 'second-use'] as const
function run(native: boolean, variant: (typeof variants)[number]) {
  const f = makeScenario(241)
  battles.push(f.battle)
  const { battle, a, b } = f
  for (const p of [...a.team, ...b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  const skill = new SkillInstance(b.activePet.skills[0].base, { power: 5 })
  skill.setOwner(a.activePet)
  a.activePet.skills.splice(0, a.activePet.skills.length, skill)
  skill.effects.push(native ? generatedIgnoreShield[id] : EffectParser.parse(original))
  const support = new BaseMark('mark_shunliu' as baseMarkId, [], f.debuff.config).createInstance()
  support.setOwner(a.activePet, battle.emitter)
  if (variant !== 'absent') a.activePet.marks.push(support)
  const shield = new BaseMark('fixture/shield' as baseMarkId, [], {
    ...f.debuff.config,
    isShield: true,
    maxStacks: 100000,
    persistent: true,
  }).createInstance({ stack: 100000 })
  shield.setOwner(b.activePet, battle.emitter)
  b.activePet.marks.push(shield)
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/bypass-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        if (variant === 'late-remove') a.activePet.marks.splice(a.activePet.marks.indexOf(support), 1)
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  const uses = []
  for (let i = 0; i < (variant === 'second-use' ? 2 : 1); i++) {
    if (i) a.activePet.marks.splice(a.activePet.marks.indexOf(support), 1)
    const turn = new TurnContext(battle)
    const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
    use.rage = 0
    use.hitOverrides.push({ willHit: true, priority: 1000 })
    const hp = b.activePet.currentHp
    const stack = shield.stack
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
    phase.initialize()
    phase.execute()
    uses.push({ bypass: use.ignoreShield, hpLost: hp - b.activePet.currentHp, shieldLost: stack - shield.stack })
  }
  return { uses, defaultBypass: skill.ignoreShield }
}
for (const variant of variants)
  it(`historical shield bypass matches native through SkillPhase: ${variant}`, () => {
    const actual = run(true, variant)
    expect(actual).toEqual(run(false, variant))
    expect(actual.defaultBypass).toBe(false)
    const first = actual.uses[0]
    // BeforeEffect runs after the effect condition; removal does not retroactively cancel admission.
    if (['present', 'late-remove', 'second-use'].includes(variant)) {
      expect(first.bypass).toBe(true)
      expect(first.hpLost).toBeGreaterThan(0)
      expect(first.shieldLost).toBe(0)
    } else {
      expect(first.bypass).toBe(false)
      expect(first.hpLost).toBe(0)
      expect(first.shieldLost).toBeGreaterThan(0)
    }
    if (variant === 'second-use') {
      expect(actual.uses[1].bypass).toBe(false)
      expect(actual.uses[1].hpLost).toBe(0)
      expect(actual.uses[1].shieldLost).toBeGreaterThan(0)
    }
  })
it('validates the whole selected context collection before writing any flag', () => {
  const f = makeScenario(),
    other = makeScenario()
  battles.push(f.battle, other.battle)
  const use = (s: typeof f) =>
    new UseSkillContext(
      new TurnContext(s.battle),
      s.a,
      s.a.activePet,
      AttackTargetOpinion.opponent,
      s.a.activePet.skills[0],
    )
  const local = use(f),
    foreign = use(other)
  const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/cross-battle-bypass',
      on: 'BeforeHit',
      execute: selectFrom([local, foreign]).apply(ops.setIgnoreShield()),
    }),
  )
  const ctx = new EffectContext(local, EffectTrigger.BeforeHit, f.a.activePet.skills[0])
  expect(() => f.battle.executionBudget.run(0, () => effect.innerApply(ctx))).toThrow('Cross-battle skill context')
  expect(local.ignoreShield).toBe(false)
  expect(foreign.ignoreShield).toBe(false)
})

it('restores the native effect from a fresh catalog and re-queries restored support marks', async () => {
  const f = makeScenario(241)
  battles.push(f.battle)
  const effect = createGeneratedIgnoreShield()[id]
  for (const p of [...f.a.team, ...f.b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  f.a.activePet.skills[0].effects.push(effect)
  const mark = new BaseMark('mark_shunliu' as baseMarkId, [], f.debuff.config).createInstance()
  mark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(mark)
  const catalog = (entry: typeof effect) => {
    const c = new SnapshotCatalog('ignore-shield-checkpoint')
    for (const skill of f.battle.skillMap.values())
      for (const e of [...skill.base.effects, ...skill.effects]) if (e.id !== id) c.registerEffect(e.id, e)
    for (const e of f.debuff.effects) c.registerEffect(e.id, e)
    return effectAuthoring.registerEffect(c, entry)
  }
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = f.battle.startBattle().catch(() => {})
  await ready
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(effect))))
  await f.battle.cleanup()
  await running
  const restored = restoreBattle(saved, catalog(createGeneratedIgnoreShield()[id]))
  battles.push(restored)
  const a = restored.playerA
  const skill = a.activePet.skills[0]
  const fire = () => {
    const use = new UseSkillContext(new TurnContext(restored), a, a.activePet, AttackTargetOpinion.opponent, skill)
    restored.applyEffects(use, EffectTrigger.AfterUseSkillCheck, skill)
    return use.ignoreShield
  }
  expect(fire()).toBe(true)
  a.activePet.marks.splice(
    a.activePet.marks.findIndex(m => m.baseId === 'mark_shunliu'),
    1,
  )
  expect(fire()).toBe(false)
  expect(skill.ignoreShield).toBe(false)
})
