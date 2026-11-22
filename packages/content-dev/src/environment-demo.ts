import { BattleMessageType, type BattleMessage } from '@arcadia-eternity/const'
import type { prepareContentPack } from './testing.ts'

/** Drive both seats at actual host decisions, including roster selection and forced switches. */
export async function runEnvironmentDemo(prepared: Awaited<ReturnType<typeof prepareContentPack>>, seed: string) {
  const system = await prepared.createBattleSession(seed)
  let outcome: Extract<BattleMessage, { type: BattleMessageType.BattleEnd }>['data'] | undefined
  let failure: string | undefined
  let actions = 0
  const unsubscribe = system.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleEnd) outcome = message.data
    if (message.type === BattleMessageType.Error || String(message.type) === BattleMessageType.EffectApplyFail)
      failure = JSON.stringify(message.data)
  })
  try {
    await system.ready()
    const completion = system.waitForCompletion().then(() => null)
    // Worker failures that occur during submission must also be observed.
    void completion.catch(() => {})
    let status: 'completed' | 'turn-limit' | 'action-limit' = 'completed'
    for (;;) {
      const decision = await Promise.race([system.waitForPendingDecision(), completion])
      if (!decision || outcome) break
      if (decision.turn >= 300 || actions >= 10000) {
        status = decision.turn >= 300 ? 'turn-limit' : 'action-limit'
        break
      }
      for (const choices of decision.selections) {
        if (!choices.length) continue
        const action =
          choices.find(choice => choice.type === 'use-skill') ??
          choices.find(choice => choice.type !== 'surrender') ??
          choices[0]!
        await system.submitAction(action)
        actions++
      }
    }
    if (failure) throw new Error('ENVIRONMENT_DEMO_EFFECT_FAILED: ' + failure)
    const state = await system.getState(undefined, true)
    return {
      status,
      turns: state.currentTurn,
      actions,
      winner: state.players.find(player => player.id === outcome?.winner)?.name ?? null,
    }
  } finally {
    unsubscribe()
    await system.cleanup()
  }
}
