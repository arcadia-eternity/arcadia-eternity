import {
  BattleMessageType,
  BattleStatus,
  PhaseState,
  setGlobalLogger,
  type EnvironmentBuildIdentity,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { NativePackLoader } from '../src/native-loader'

type Plan = { type: string; skill?: string; pet?: string }
export async function verifyNativePackHost(
  packRef: string,
  build: EnvironmentBuildIdentity,
  input: { teams: readonly unknown[]; actions: { A: readonly Plan[]; B: readonly Plan[] } },
) {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const loader = new NativePackLoader(build)
  const initial = await loader.load(packRef, { source: 'http', enforceLockfile: true })
  async function play(checkpoint: boolean) {
    let content = initial.content
    const [a, b] = input.teams.map(team => content.parsePlayer(team))
    let battle = content.createBattle(a, b, { rngSeed: 201, timerConfig: { enabled: false }, showHidden: true })
    const indexes = [0, 0],
      trace: unknown[] = [],
      errors: string[] = []
    let reached!: () => void
    const boundary = new Promise<void>(resolve => {
      reached = resolve
    })
    const submit = (side: number) => {
      const player = [battle.playerA, battle.playerB][side]
      const plan = input.actions[side === 0 ? 'A' : 'B'][indexes[side]++]
      if (!plan) throw new Error('Native host action script exhausted')
      const selection = battle.getAvailableSelection(player.id).find(selection => {
        if (selection.type !== plan.type) return false
        if (selection.type === 'use-skill') return battle.getSkillByID(selection.skill).baseId === plan.skill
        if (selection.type === 'switch-pet') return battle.getPetByID(selection.pet).name === plan.pet
        return true
      })
      if (!selection || !battle.setSelection(selection))
        throw new Error(`Native host action rejected: ${JSON.stringify(plan)}`)
    }
    const observe = (current: Battle, pause: boolean) =>
      current.registerListener(message => {
        trace.push(message.type)
        if (message.type === BattleMessageType.TurnEnd)
          trace.push({
            turn: current.currentTurn,
            hp: [...current.playerA.team, ...current.playerB.team].map(pet => pet.currentHp),
            rage: [current.playerA.currentRage, current.playerB.currentRage],
          })
        if (
          ([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(message.type)
        )
          errors.push(message.type)
        try {
          if (message.type === BattleMessageType.TurnAction) {
            if (pause && current.currentTurn === 2) {
              reached()
              return
            }
            submit(0)
            submit(1)
          }
          if (message.type === BattleMessageType.ForcedSwitch)
            for (const id of message.data.player)
              submit([current.playerA, current.playerB].findIndex(player => player.id === id))
          if (message.type === BattleMessageType.FaintSwitch)
            submit([current.playerA, current.playerB].findIndex(player => player.id === message.data.player))
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'Unknown native host error')
          void current.cleanup()
        }
      })
    const cancelled = (error: Error) => {
      if (error.message !== 'Battle cancelled') throw error
    }
    observe(battle, checkpoint)
    let running = battle.startBattle().catch(cancelled)
    try {
      if (checkpoint) {
        await Promise.race([
          boundary,
          running.then(() => {
            throw new Error('Native host ended before checkpoint')
          }),
        ])
        const saved = JSON.parse(JSON.stringify(content.snapshot(battle)))
        await battle.cleanup()
        await running
        const fresh = await loader.load(packRef, {
          source: 'http',
          enforceLockfile: true,
          expectedRevision: initial.revision,
        })
        content = fresh.content
        battle = content.restore(saved)
        observe(battle, false)
        running = battle.resumeBattle().catch(cancelled)
        submit(0)
        submit(1)
      }
      await running
      if (errors.length || battle.phaseManager.getPhasesByState(PhaseState.Failed).length)
        throw new Error(`Native host execution failed: ${errors.join(', ')}`)
      if (
        battle.status !== BattleStatus.Ended ||
        battle.currentTurn !== 7 ||
        battle.victor?.name !== 'A' ||
        indexes.some(index => index !== 8)
      )
        throw new Error('Native host game did not complete as expected')
      return trace
    } finally {
      await battle.cleanup()
      await running
    }
  }
  const baseline = await play(false),
    restored = await play(true)
  if (JSON.stringify(baseline) !== JSON.stringify(restored)) throw new Error('Native host JSON continuation differs')
  return {
    revision: initial.revision,
    effects: initial.content.effects.length,
    marks: initial.content.marks.length,
    skills: initial.content.skills.length,
    species: initial.content.species.length,
    turns: 7,
    winner: 'A',
    freshDirectoryRestore: true,
    trace: baseline,
  }
}
