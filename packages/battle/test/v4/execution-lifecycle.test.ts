import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BattleMessageType,
  Effect,
  EffectTrigger,
  UseSkillContext,
  TurnContext,
  executeTurnOperation,
  TransformPhase,
  type Battle,
  type effectId,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
async function selectionStarted(battle: Battle) {
  let resolve!: () => void
  const prompt = new Promise<void>(done => {
    resolve = done
  })
  battle.registerListener(m => {
    if (m.type === BattleMessageType.TurnAction) resolve()
  })
  const run = battle.startBattle()
  await prompt
  await Promise.resolve()
  return { run }
}
it('settles the running Battle when cleanup cancels an input wait', async () => {
  const { battle } = fixture()
  const { run } = await selectionStarted(battle)
  const outcome = run.then(
    () => 'resolved',
    error => (error instanceof Error ? error.message : 'unknown'),
  )
  await battle.cleanup()
  const result = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('stuck'), 100))])
  expect(result).toBe('Battle cancelled')
})
it('finishes a Battle abandoned while waiting for a player action', async () => {
  const { battle, a, b } = fixture()
  const { run } = await selectionStarted(battle)
  const outcome = run.then(
    () => 'finished',
    () => 'failed',
  )
  battle.abandonPlayer(a.id)
  expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('stuck'), 100))])).toBe(
    'finished',
  )
  expect(battle.victor).toBe(b)
})
it('honors BeforeSort context priority in the actual TurnPhase ordering', () => {
  const { a, b, battle } = fixture(),
    order: string[] = []
  a.activePet.skills[0].effects.push(
    new Effect<EffectTrigger>(
      'priority' as effectId,
      [EffectTrigger.BeforeSort],
      ctx => {
        if (ctx.parent instanceof UseSkillContext && ctx.source.owner === ctx.parent.pet) ctx.parent.priority = -10
      },
      0,
    ),
  )
  a.selection = {
    player: a.id,
    type: 'use-skill',
    skill: a.activePet.skills[0].id,
    target: a.activePet.skills[0].target,
  }
  b.selection = {
    player: b.id,
    type: 'use-skill',
    skill: b.activePet.skills[0].id,
    target: b.activePet.skills[0].target,
  }
  battle.registerListener(m => {
    if (m.type === BattleMessageType.SkillUse) order.push(m.data.user)
  })
  executeTurnOperation(new TurnContext(battle), battle)
  expect(order[0]).toBe(b.activePet.id)
})
it('dispatches transformation lifecycle once in order through the public TransformPhase', () => {
  const { a, battle } = fixture(),
    order: EffectTrigger[] = []
  const triggers = [EffectTrigger.BeforeTransform, EffectTrigger.OnTransform, EffectTrigger.AfterTransform]
  for (const trigger of triggers)
    a.activePet.skills[0].effects.push(
      new Effect<EffectTrigger>(
        `form-${trigger}` as effectId,
        [trigger],
        () => {
          order.push(trigger)
        },
        0,
      ),
    )
  const phase = new TransformPhase(
    battle,
    battle,
    a.activePet,
    'pet',
    a.activePet.base,
    { ...a.activePet.base },
    'temporary',
    0,
  )
  battle.phaseManager.registerPhase(phase)
  battle.phaseManager.executePhase(phase.id)
  expect(order).toEqual(triggers)
})
