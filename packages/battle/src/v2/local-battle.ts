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
import { createSnapshot, restoreWorld } from '@arcadia-eternity/engine'
import type { IBattleSystem, BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import type { BattleInstance } from './game.js'
import { BattleOrchestrator } from './orchestrator.js'
import { SelectionSystem } from './systems/selection.system.js'
import { MessageBridge } from './systems/message-bridge.js'
import { worldToBattleState } from './systems/state-serializer.js'
import type { MessageViewOptions } from './systems/message-bridge.js'
import { TimerSystem } from './systems/timer.system.js'

export class LocalBattleSystemV2 implements IBattleSystem {
  private static readonly RUNTIME_SNAPSHOT_FORMAT = 'arcadia.battle.v2.world'
  private static readonly RUNTIME_SNAPSHOT_VERSION = 1

  private orchestrator: BattleOrchestrator
  private selectionSystem: SelectionSystem
  private messageBridge: MessageBridge
  private timerSystem: TimerSystem
  private battlePromise: Promise<void> | null = null
  private resumeFromSnapshot = false

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
    const serializableWorld = {
      ...world,
      systems: {},
      meta: {
        strictExtractorTyping: world.meta.strictExtractorTyping,
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
    restoredWorld.systems = currentWorld.systems
    restoredWorld.meta = {
      ...restoredWorld.meta,
      strictExtractorTyping: currentWorld.meta.strictExtractorTyping,
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
