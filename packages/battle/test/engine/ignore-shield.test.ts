import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  EffectTrigger,
  SnapshotCatalog,
  TurnContext,
  UseSkillContext,
  effectAuthoring,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'
import { createGeneratedIgnoreShield } from '@arcadia-eternity/data-pack-base/effects'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'

const id = 'effect_skill_ignore_opponent_shield_if_has_shunliu'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
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
