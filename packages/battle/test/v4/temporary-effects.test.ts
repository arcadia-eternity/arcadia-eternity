import {
  BaseMark,
  BattleMessageType,
  Effect,
  EffectContext,
  EffectTrigger,
  SnapshotCatalog,
  TurnContext,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})

function fixture() {
  const f = makeScenario(241)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const mark = new BaseMark('fixture/temporary-mark' as baseMarkId, [], f.debuff.config).createInstance()
  mark.owner = f.a.activePet
  f.a.activePet.marks.push(mark)
  const global = new BaseMark('fixture/temporary-global' as baseMarkId, [], f.debuff.config).createInstance()
  global.owner = f.battle
  f.battle.marks.push(global)
  const targets = [f.a.activePet.skills[0], mark, global]
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, targets[0])
  const calls: string[] = []
  const effect = new Effect<EffectTrigger>(
    'fixture/temporary' as effectId,
    [EffectTrigger.TurnEnd],
    ctx => calls.push(ctx.source.id),
    0,
  )
  return { ...f, targets, ctx, effect, calls }
}

it('clearing one phase preserves permanent effects and other phase additions', () => {
  const f = fixture(),
    target = f.targets[0]
  target.effects.push(f.effect)
  target.addTemporaryEffect(f.effect, 'one')
  target.addTemporaryEffect(f.effect, 'two')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(3)
  target.clearTemporaryEffects('one')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(2)
  target.clearTemporaryEffects('two')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([f.effect])
})
it('rejects active phase lifetimes at checkpoints and round trips after cleanup', async () => {
  const f = fixture()
  let ready!: () => void
  const prompt = new Promise<void>(resolve => {
    ready = resolve
  })
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction) ready()
  })
  const run = f.battle.startBattle().catch(() => {})
  await prompt
  const catalog = new SnapshotCatalog('temporary/1')
  catalog.registerEffect(f.effect.id, f.effect)
  const baseEffects = [...f.a.team, ...f.b.team].flatMap(p => p.skills.flatMap(s => s.base.effects))
  for (const effect of baseEffects) catalog.registerEffect(effect.id, effect)
  for (const target of f.targets) target.addTemporaryEffect(f.effect, 'active-phase')
  expect(() => snapshotBattle(f.battle, catalog)).toThrow('active temporary effects')
  f.battle.cleanupPhaseEffects('active-phase')
  const data = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const fresh = new SnapshotCatalog('temporary/1')
  for (const effect of baseEffects) fresh.registerEffect(effect.id, effect)
  for (const node of data.nodes) if (node.fields) delete node.fields.temporaryEffects
  const restored = restoreBattle(data, fresh)
  battles.push(restored)
  const targets = [restored.playerA.activePet.skills[0], restored.playerA.activePet.marks[0], restored.marks[0]]
  for (const target of targets) expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
})
