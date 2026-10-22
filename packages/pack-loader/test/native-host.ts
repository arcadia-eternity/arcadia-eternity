import {
  BattleMessageType,
  AIPlayer,
  BattleStatus,
  PhaseState,
  setGlobalLogger,
  type EnvironmentBuildIdentity,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { NativePackLoader } from '../src/native-loader'

type Plan = { type: string; skill?: string; pet?: string }
type RuntimeSnapshot = Awaited<ReturnType<LocalBattleSystemV4['createRuntimeSnapshot']>>
export async function verifyNativePackHost(
  packRef: string,
  build: EnvironmentBuildIdentity,
  input: { teams: readonly unknown[]; actions: { A: readonly Plan[]; B: readonly Plan[] } },
  options: { timed?: boolean } = {},
) {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const loader = new NativePackLoader(build)
  const initial = await loader.load(packRef, { source: 'http', enforceLockfile: true })
  async function verifyAI() {
    const teams = structuredClone(input.teams) as { id: string; team: { skills: string[]; maxHp: number }[] }[]
    teams.forEach((team, index) => {
      team.id = String(index).repeat(21)
      for (const pet of team.team) {
        pet.skills = ['skill_paida']
        pet.maxHp = 10_000
      }
    })
    let content = initial.content
    const [a, b] = content.parsePlayers(teams, { aiPlayerIds: [teams[1].id] }),
      config = {
        rngSeed: 201,
        timerConfig: { enabled: options.timed ?? false, turnTimeLimit: 30, totalTimeLimit: 1500 },
      }
    let battle = content.createBattle(a, b, config)
    const authority = () => ({
      snapshot: (current: Battle) => content.snapshot(current),
      restore: (data: unknown) => (battle = content.restore(data)),
    })
    let system = new LocalBattleSystemV4(battle, authority())
    const choose = async () =>
      (await system.getAvailableSelection(battle.playerA.id)).find(action => action.type === 'use-skill')!
    try {
      await system.ready()
      if (!(battle.playerB instanceof AIPlayer) || battle.getActionLog().length !== 1)
        throw new Error('Native content did not create and record the built-in AI')
      if (options.timed && (await system.getPlayerTimerState(battle.playerB.id))?.state !== 'paused')
        throw new Error('Native AI did not pause its decision clock')
      await system.submitAction(await choose())
      await battle.waitForInputReady()
      const saved = await system.createRuntimeSnapshot(),
        before = JSON.stringify(await system.getState(undefined, true)),
        action = await choose()
      await system.submitAction(action)
      await battle.waitForInputReady()
      const expected = JSON.stringify(await system.getState(undefined, true)),
        expectedLog = JSON.stringify(battle.getActionLog())
      if (battle.currentTurn !== 2 || battle.getActionLog().length !== 5)
        throw new Error('Native AI did not complete two turns')
      await system.cleanup()
      content = (await loader.load(packRef, { source: 'http', expectedRevision: initial.revision })).content
      const players = content.parsePlayers(teams)
      battle = content.createBattle(players[0], players[1], config)
      system = new LocalBattleSystemV4(battle, authority())
      await system.restoreRuntimeSnapshot(saved)
      await system.ready()
      if (!(battle.playerB instanceof AIPlayer) || JSON.stringify(await system.getState(undefined, true)) !== before)
        throw new Error('Native AI changed its pending choice during restore')
      await system.submitAction(action)
      await battle.waitForInputReady()
      if (
        JSON.stringify(await system.getState(undefined, true)) !== expected ||
        JSON.stringify(battle.getActionLog()) !== expectedLog
      )
        throw new Error('Native AI continuation differs from uninterrupted play')
    } finally {
      await system.cleanup()
    }
  }
  async function play(checkpoint: boolean, restoreInitial = false) {
    let content = initial.content
    const [a, b] = input.teams.map(team => content.parsePlayer(team))
    const timerConfig = { enabled: options.timed ?? false, turnTimeLimit: 30, totalTimeLimit: 1500 }
    let battle = content.createBattle(a, b, { rngSeed: 201, timerConfig, showHidden: true })
    const authority = () => ({
      snapshot: (current: Battle) => content.snapshot(current),
      restore: (data: unknown) => {
        battle = content.restore(data)
        return battle
      },
    })
    let system = new LocalBattleSystemV4(battle, authority())
    const replace = async (saved: RuntimeSnapshot) => {
      await system.cleanup()
      const fresh = await loader.load(packRef, {
        source: 'http',
        enforceLockfile: true,
        expectedRevision: initial.revision,
      })
      content = fresh.content
      const players = input.teams.map(team => content.parsePlayer(team))
      battle = content.createBattle(players[0], players[1], { timerConfig })
      system = new LocalBattleSystemV4(battle, authority())
      await system.restoreRuntimeSnapshot(saved)
    }
    let savedAnimation: string | undefined
    const indexes = [0, 0],
      trace: unknown[] = [],
      errors: string[] = []
    let reached!: () => void
    const boundary = new Promise<void>(resolve => {
      reached = resolve
    })
    const submit = async (side: number) => {
      const player = [battle.playerA, battle.playerB][side]
      const plan = input.actions[side === 0 ? 'A' : 'B'][indexes[side]++]
      if (!plan) throw new Error('Native host action script exhausted')
      const selection = (await system.getAvailableSelection(player.id)).find(selection => {
        if (selection.type !== plan.type) return false
        if (selection.type === 'use-skill') return battle.getSkillByID(selection.skill).baseId === plan.skill
        if (selection.type === 'switch-pet') return battle.getPetByID(selection.pet).name === plan.pet
        return true
      })
      if (!selection) throw new Error(`Native host action rejected: ${JSON.stringify(plan)}`)
      await system.submitAction(selection)
    }
    const observe = (pause: boolean) =>
      system.BattleEvent(message => {
        const current = battle
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
        void (async () => {
          if (pause && options.timed && message.type === BattleMessageType.TurnEnd && current.currentTurn === 2)
            savedAnimation = await system.startAnimation('fixture/checkpoint-animation', 2000, current.playerA.id)
          if (message.type === BattleMessageType.TurnAction) {
            if (pause && current.currentTurn === 2) {
              await system.startReconnectGraceTimer(current.playerA.id, 60)
              reached()
              return
            }
            await submit(0)
            await submit(1)
          }
          if (message.type === BattleMessageType.ForcedSwitch)
            for (const id of message.data.player)
              await submit([current.playerA, current.playerB].findIndex(player => player.id === id))
          if (message.type === BattleMessageType.FaintSwitch)
            await submit([current.playerA, current.playerB].findIndex(player => player.id === message.data.player))
        })().catch(error => {
          errors.push(error instanceof Error ? error.message : 'Unknown native host error')
          void system.cleanup()
        })
      })
    if (restoreInitial) {
      const skillIds = [...battle.petMap.values()].flatMap(pet => pet.skills.map(skill => skill.id))
      await replace(JSON.parse(JSON.stringify(await system.createRuntimeSnapshot())))
      if (
        JSON.stringify([...battle.petMap.values()].flatMap(pet => pet.skills.map(skill => skill.id))) !==
        JSON.stringify(skillIds)
      )
        throw new Error('Native host changed skill identities during initial restore')
    }
    observe(checkpoint)
    await system.ready()
    let running = system.waitForCompletion()
    try {
      if (checkpoint) {
        await Promise.race([
          boundary,
          running.then(() => {
            throw new Error('Native host ended before checkpoint')
          }),
        ])
        if (options.timed && battle.timerManager.exportRuntimeState().pendingTurnReset?.length !== 2)
          throw new Error('Native host did not reach its deferred timer reset checkpoint')
        const saved = JSON.parse(JSON.stringify(await system.createRuntimeSnapshot()))
        await replace(saved)
        await running
        observe(false)
        const restoredSnapshot = await system.createRuntimeSnapshot()
        if (
          JSON.stringify(JSON.parse(restoredSnapshot.payload).reconnect) !==
          JSON.stringify(JSON.parse(saved.payload).reconnect)
        )
          throw new Error('Native host changed the saved reconnect deadline')
        const completedAnimations: string[] = []
        const offAnimation = system.onTimerEvent('animationEnd', event => completedAnimations.push(event.animationId))
        await system.ready()
        running = system.waitForCompletion()
        await system.cancelReconnectGraceTimer(battle.playerA.id)
        if (savedAnimation) {
          await system.endAnimation(savedAnimation, 2000)
          if (completedAnimations.length !== 1 || completedAnimations[0] !== savedAnimation)
            throw new Error('Native host did not complete the restored animation exactly once')
          if ((await system.getAllPlayerTimerStates()).some(timer => timer.state !== 'running'))
            throw new Error('Native host did not finish its restored deferred timer reset')
        }
        offAnimation()
        await submit(0)
        await submit(1)
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
      await system.cleanup()
      await running
    }
  }
  const baseline = await play(false),
    restored = await play(true),
    bootstrapped = await play(false, true)
  if (
    JSON.stringify(baseline) !== JSON.stringify(restored) ||
    JSON.stringify(baseline) !== JSON.stringify(bootstrapped)
  )
    throw new Error('Native host JSON continuation differs')
  await verifyAI()
  return {
    revision: initial.revision,
    effects: initial.content.effects.length,
    marks: initial.content.marks.length,
    skills: initial.content.skills.length,
    species: initial.content.species.length,
    turns: 7,
    winner: 'A',
    freshDirectoryRestore: true,
    battleSystemInterface: true,
    enabledTimers: options.timed ?? false,
    activeAnimationRestore: options.timed ?? false,
    reconnectRestore: true,
    initialSnapshotRestore: true,
    aiRestore: true,
    trace: baseline,
  }
}
