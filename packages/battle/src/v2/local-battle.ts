// battle/src/v2/local-battle.ts
// LocalBattleSystemV2 — IBattleSystem implementation backed by v2 engine.

import type {
  BattleMessage,
  BattleState,
  PlayerSelection,
  petId,
  PlayerTimerState,
  TimerConfig,
  Events,
  playerId,
} from '@arcadia-eternity/const'
import { BattleMessageType } from '@arcadia-eternity/const'
import { createSnapshot, restoreWorld, GameRng, type RngState, type PhaseExecutionEvent } from '@arcadia-eternity/engine'
import type {
  IBattleSystem,
  BattleRuntimeSnapshot,
  BattlePhaseExecutionEvent,
} from '@arcadia-eternity/interface'
import type { BattleInstance } from './game.js'
import { BattleOrchestrator } from './orchestrator.js'
import { SelectionSystem } from './systems/selection.system.js'
import { MessageBridge } from './systems/message-bridge.js'
import { worldToBattleState } from './systems/state-serializer.js'
import type { MessageViewOptions } from './systems/message-bridge.js'
import { TimerSystem } from './systems/timer.system.js'

type RuntimeSnapshotMeta = {
  strictExtractorTyping: boolean
  rngState: RngState
}

function isRngStateReader(value: unknown): value is { getState: () => RngState } {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { getState?: unknown }).getState === 'function'
}

function isRngState(value: unknown): value is RngState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const seed = candidate.seed
  return (
    (typeof seed === 'string' || typeof seed === 'number') &&
    typeof candidate.a === 'number' &&
    Number.isFinite(candidate.a) &&
    typeof candidate.b === 'number' &&
    Number.isFinite(candidate.b) &&
    typeof candidate.c === 'number' &&
    Number.isFinite(candidate.c) &&
    typeof candidate.d === 'number' &&
    Number.isFinite(candidate.d)
  )
}

function readRuntimeSnapshotMeta(meta: Record<string, unknown>): RuntimeSnapshotMeta {
  const strictExtractorTyping = meta.strictExtractorTyping === true
  const rngState = meta.rngState
  if (!isRngState(rngState)) {
    throw new Error('Runtime snapshot is missing valid rngState')
  }
  return {
    strictExtractorTyping,
    rngState,
  }
}

export class LocalBattleSystemV2 implements IBattleSystem {
  private static readonly RUNTIME_SNAPSHOT_FORMAT = 'arcadia.battle.v2.world'
  private static readonly RUNTIME_SNAPSHOT_VERSION = 2

  private orchestrator: BattleOrchestrator
  private selectionSystem: SelectionSystem
  private messageBridge: MessageBridge
  private timerSystem: TimerSystem
  private battlePromise: Promise<void> | null = null
  private resumeFromSnapshot = false
  private phaseEventSubscribers = new Set<(event: BattlePhaseExecutionEvent) => void | Promise<void>>()
  private removePhaseExecutionObserver: (() => void) | null = null

  constructor(private battle: BattleInstance) {
    this.selectionSystem = new SelectionSystem(
      battle.playerSystem,
      battle.petSystem,
      battle.skillSystem,
    )

    this.timerSystem = new TimerSystem(battle.world, battle.config.timerConfig)
    this.timerSystem.setReconnectTimeoutHandler(async timedOutPlayerId =>
      this.handleReconnectGraceTimeout(timedOutPlayerId),
    )
    this.initializeTimerPlayers()

    this.orchestrator = new BattleOrchestrator(battle, this.selectionSystem, this.timerSystem)

    this.messageBridge = new MessageBridge(
      battle.world,
      battle.eventBus,
      {
        playerSystem: battle.playerSystem,
        petSystem: battle.petSystem,
        markSystem: battle.markSystem,
        skillSystem: battle.skillSystem,
        attrSystem: battle.attrSystem,
      },
      battle.config.showHidden ?? false,
    )

    this.removePhaseExecutionObserver = this.battle.phaseManager.onExecutionEvent(
      async (_world, event: PhaseExecutionEvent) => {
        if (event.transition === 'begin') {
          this.messageBridge.beginPhaseTransaction(event.phase.id)
        } else if (event.transition === 'commit') {
          this.messageBridge.commitPhaseTransaction(event.phase.id)
        } else {
          this.messageBridge.rollbackPhaseTransaction(event.phase.id)
        }

        if (this.phaseEventSubscribers.size === 0) return
        const payload: BattlePhaseExecutionEvent = {
          transition: event.transition,
          phaseId: event.phase.id,
          phaseType: event.phase.type,
          phaseState: event.phase.state,
          stackDepth: event.stackDepth,
          timestamp: Date.now(),
          error: event.error,
        }
        for (const subscriber of this.phaseEventSubscribers) {
          await subscriber(payload)
        }
      },
    )
  }

  get world() { return this.battle.world }

  async ready(): Promise<void> {
    const resume = this.resumeFromSnapshot
    this.resumeFromSnapshot = false
    this.initializeTimerPlayers()
    // Start the battle loop in the background
    this.battlePromise = this.orchestrator.startBattle({ resumeFromSnapshot: resume })
  }

  async getState(playerId?: playerId, showHidden?: boolean): Promise<BattleState> {
    const effectiveShowHidden = showHidden ?? (playerId ? false : (this.battle.config.showHidden ?? false))
    return worldToBattleState(
      this.world,
      {
        playerSystem: this.battle.playerSystem,
        petSystem: this.battle.petSystem,
        markSystem: this.battle.markSystem,
        skillSystem: this.battle.skillSystem,
        attrSystem: this.battle.attrSystem,
      },
      playerId,
      effectiveShowHidden,
    )
  }

  async getAvailableSelection(playerId: playerId): Promise<PlayerSelection[]> {
    return this.selectionSystem.getAvailableSelections(this.world, playerId)
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    this.selectionSystem.setSelection(this.world, selection.player, selection)
  }

  BattleEvent(callback: (message: BattleMessage) => void, options?: MessageViewOptions): () => void {
    return this.messageBridge.subscribe(callback, options)
  }

  async isTimerEnabled(): Promise<boolean> { return this.timerSystem.isEnabled() }
  async getPlayerTimerState(playerId: playerId): Promise<PlayerTimerState | null> {
    return this.timerSystem.getPlayerState(playerId)
  }
  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    return this.timerSystem.getAllPlayerStates()
  }
  async getTimerConfig(): Promise<TimerConfig> {
    return this.timerSystem.getConfig()
  }
  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    return this.timerSystem.startAnimation(source, expectedDuration, ownerId)
  }
  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    this.timerSystem.endAnimation(animationId, actualDuration)
  }

  async startReconnectGraceTimer(playerId: playerId, durationSec: number): Promise<void> {
    await this.timerSystem.startReconnectGraceWindow(playerId, durationSec)
  }

  async cancelReconnectGraceTimer(playerId: playerId): Promise<void> {
    this.timerSystem.cancelReconnectGraceWindow(playerId)
  }

  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    return this.timerSystem.on(eventType, handler)
  }
  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    this.timerSystem.off(eventType, handler)
  }

  onPhaseExecutionEvent(
    handler: (event: BattlePhaseExecutionEvent) => void | Promise<void>,
  ): () => void {
    this.phaseEventSubscribers.add(handler)
    return () => {
      this.phaseEventSubscribers.delete(handler)
    }
  }

  // Developer methods
  setDevPetHp(petId: string, hp: number): void {
    const pet = this.battle.petSystem.get(this.world, petId)
    if (!pet) return

    const before = this.battle.petSystem.getCurrentHp(this.world, petId)
    const maxHp = this.battle.petSystem.getStatValue(this.world, petId, 'maxHp')
    const after = Math.max(0, Math.min(hp, maxHp))

    this.battle.petSystem.setCurrentHp(this.world, petId, after)
    this.battle.eventBus.emit(this.world, 'hpChange', {
      pet: petId as petId,
      before,
      after,
      maxHp,
      reason: 'effect',
    })
  }

  setDevPlayerRage(playerId: string, rage: number): void {
    const player = this.battle.playerSystem.get(this.world, playerId)
    if (!player) return

    const before = this.battle.playerSystem.getRage(this.world, playerId)
    this.battle.playerSystem.setRage(this.world, playerId, rage)
    const after = this.battle.playerSystem.getRage(this.world, playerId)

    this.battle.eventBus.emit(this.world, 'rageChange', {
      playerId,
      before,
      newRage: after,
      reason: 'effect',
    })
  }

  forceAISelection(selection: PlayerSelection): void {
    this.selectionSystem.setSelection(this.world, selection.player, selection)
    this.battle.eventBus.emit(this.world, 'info', {
      messageType: BattleMessageType.Info,
      message: 'forceAISelection',
      playerId: selection.player,
    })
  }

  getAvailableActionsForPlayer(playerId: string): PlayerSelection[] {
    return this.selectionSystem.getAvailableSelections(this.world, playerId)
  }

  async createRuntimeSnapshot(): Promise<BattleRuntimeSnapshot> {
    const world = this.battle.world
    const runtimeRng = world.systems.rng
    if (!isRngStateReader(runtimeRng)) {
      throw new Error('Runtime snapshot requires RNG state reader at world.systems.rng')
    }
    const rngState = runtimeRng.getState()
    if (!isRngState(rngState)) {
      throw new Error('Runtime snapshot RNG state is invalid')
    }
    const serializableWorld = {
      ...world,
      systems: {},
      meta: {
        strictExtractorTyping: world.meta.strictExtractorTyping === true,
        rngState,
      },
    }
    return {
      format: LocalBattleSystemV2.RUNTIME_SNAPSHOT_FORMAT,
      version: LocalBattleSystemV2.RUNTIME_SNAPSHOT_VERSION,
      payload: createSnapshot(serializableWorld),
    }
  }

  async restoreRuntimeSnapshot(snapshot: BattleRuntimeSnapshot): Promise<void> {
    if (snapshot.format !== LocalBattleSystemV2.RUNTIME_SNAPSHOT_FORMAT) {
      throw new Error(`Unsupported runtime snapshot format: ${snapshot.format}`)
    }
    if (snapshot.version !== LocalBattleSystemV2.RUNTIME_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported runtime snapshot version: ${snapshot.version}`)
    }

    const currentWorld = this.battle.world
    const restoredWorld = restoreWorld(snapshot.payload)
    const runtimeMeta = readRuntimeSnapshotMeta(restoredWorld.meta)
    restoredWorld.systems = currentWorld.systems
    restoredWorld.systems.rng = GameRng.fromState(runtimeMeta.rngState)
    restoredWorld.meta = {
      ...restoredWorld.meta,
      strictExtractorTyping: runtimeMeta.strictExtractorTyping,
      dataRepository: currentWorld.meta.dataRepository,
    }
    this.battle.world = restoredWorld
    this.timerSystem.setWorld(restoredWorld)
    this.timerSystem.setReconnectTimeoutHandler(async timedOutPlayerId =>
      this.handleReconnectGraceTimeout(timedOutPlayerId),
    )
    this.initializeTimerPlayers()
    this.messageBridge.setWorld(restoredWorld)
    this.resumeFromSnapshot = restoredWorld.state.status === 'active'
  }

  async cleanup(): Promise<void> {
    this.orchestrator.stop()
    this.timerSystem.cleanup()
    this.messageBridge.cleanup()
    this.phaseEventSubscribers.clear()
    if (this.removePhaseExecutionObserver) {
      this.removePhaseExecutionObserver()
      this.removePhaseExecutionObserver = null
    }
    this.battle.eventBus.clear()
    if (this.battlePromise) {
      await this.battlePromise.catch(() => {})
    }
  }

  private initializeTimerPlayers(): void {
    const playerIds: string[] = []
    const state = this.battle.world.state as Record<string, unknown>
    const playerAId = state.playerAId
    const playerBId = state.playerBId
    if (typeof playerAId === 'string') playerIds.push(playerAId)
    if (typeof playerBId === 'string') playerIds.push(playerBId)
    if (playerIds.length > 0) {
      this.timerSystem.initializePlayers(playerIds)
    }
  }

  private async handleReconnectGraceTimeout(timedOutPlayerId: string): Promise<string | undefined> {
    const availableSelections = this.selectionSystem.getAvailableSelections(this.world, timedOutPlayerId)
    const surrenderSelection = availableSelections.find(selection => selection.type === 'surrender')
    if (surrenderSelection) {
      this.selectionSystem.setSelection(this.world, timedOutPlayerId, surrenderSelection)
      return '断线超时自动投降'
    }

    const state = this.world.state as Record<string, unknown>
    const playerAId = state.playerAId
    const playerBId = state.playerBId
    if (
      state.status !== 'ended' &&
      typeof playerAId === 'string' &&
      typeof playerBId === 'string' &&
      (timedOutPlayerId === playerAId || timedOutPlayerId === playerBId)
    ) {
      state.victor = timedOutPlayerId === playerAId ? playerBId : playerAId
      state.endReason = 'surrender'
      state.status = 'ended'
      return '断线超时强制结束战斗'
    }
    return undefined
  }
}
