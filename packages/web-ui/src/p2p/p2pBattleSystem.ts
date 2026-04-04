import {
  DEFAULT_TIMER_CONFIG,
  TimerState,
  type BattleMessage,
  type BattleState,
  type Events,
  type PlayerSelection,
  type PlayerTimerState,
  type TimerConfig,
  type TimerSnapshot,
  type playerId,
} from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import { LocalBattleSystemV2, createBattleFromConfig, createRepositoryFromRawData } from '@arcadia-eternity/battle'
import type { TeamConfig, BattleConfig as V2BattleConfig } from '@arcadia-eternity/battle'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { PeerTransport } from '@arcadia-eternity/p2p-transport'
import type { PrivateRoomSignalBridge } from '@/p2p/privateRoomSignalBridge'
import {
  type P2PBattleMessage,
  type P2PTimerSyncPayload,
  isP2PBattleMessage,
} from './battleProtocol'
import { toRaw } from 'vue'

type BattleMessageHandler = (message: BattleMessage) => void
type SnapshotHandler = (snapshot: { battleState: BattleState; availableSelections: PlayerSelection[] }) => void
type TimerEventType = keyof Events

const P2P_TIMER_EVENT_TYPES: TimerEventType[] = [
  'timerStart',
  'timerUpdate',
  'timerPause',
  'timerResume',
  'timerTimeout',
  'teamSelectionTimerStart',
  'teamSelectionTimerStop',
  'teamSelectionTimeout',
  'timerSnapshot',
  'timerStateChange',
  'animationStart',
  'animationEnd',
]
const P2P_TIMER_EVENT_TYPE_SET = new Set<TimerEventType>(P2P_TIMER_EVENT_TYPES)

export interface WebGameDataStoreLike {
  effects: { allIds: string[]; byId: Record<string, unknown> }
  marks: { allIds: string[]; byId: Record<string, unknown> }
  skills: { allIds: string[]; byId: Record<string, unknown> }
  species: { allIds: string[]; byId: Record<string, unknown> }
}

function asRawRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toTeamConfig(playerId: string, name: string, pets: PetSchemaType[]): TeamConfig {
  return {
    id: playerId,
    name,
    team: pets.map(pet => ({
      name: pet.name,
      species: pet.species,
      level: pet.level,
      evs: pet.evs,
      ivs: pet.ivs,
      nature: pet.nature,
      skills: pet.skills,
      ability: pet.ability || undefined,
      emblem: pet.emblem || undefined,
      gender: pet.gender || undefined,
      weight: pet.weight || undefined,
      height: pet.height || undefined,
    })),
  }
}

export function createWebGameRepository(dataStore: WebGameDataStoreLike) {
  const toRawRecords = (ids: string[], byId: Record<string, unknown>): Record<string, unknown>[] =>
    ids.map(id => asRawRecord(toRaw(byId[id])) as Record<string, unknown>)

  return createRepositoryFromRawData({
    effects: toRawRecords(dataStore.effects.allIds, dataStore.effects.byId),
    marks: toRawRecords(dataStore.marks.allIds, dataStore.marks.byId),
    skills: toRawRecords(dataStore.skills.allIds, dataStore.skills.byId),
    species: toRawRecords(dataStore.species.allIds, dataStore.species.byId),
  })
}

export function createP2PHostBattleSystem(options: {
  localPlayerId: playerId
  remotePlayerId: playerId
  localPlayerName: string
  remotePlayerName: string
  localTeam: PetSchemaType[]
  remoteTeam: PetSchemaType[]
  dataStore: WebGameDataStoreLike
  bridge: PrivateRoomSignalBridge
  transport: PeerTransport
  battleConfig?: V2BattleConfig
}): IBattleSystem {
  const repo = createWebGameRepository(options.dataStore)
  const battle = createBattleFromConfig(
    toTeamConfig(options.localPlayerId, options.localPlayerName, options.localTeam),
    toTeamConfig(options.remotePlayerId, options.remotePlayerName, options.remoteTeam),
    repo,
    options.battleConfig,
  )

  return new P2PHostBattleSystem(
    new LocalBattleSystemV2(battle),
    options.localPlayerId,
    options.remotePlayerId,
    options.bridge,
    options.transport,
  )
}

class P2PHostBattleSystem implements IBattleSystem {
  private readonly messageUnsubscribe: () => void
  private readonly relayUnsubscribe: () => void
  private readonly timerRelayUnsubscribers: Array<() => void>
  private readonly offStateChange: () => void
  private readonly remoteEventBacklog: BattleMessage[] = []
  private remoteAckSequenceId = -1
  private isReady = false

  constructor(
    private readonly localSystem: LocalBattleSystemV2,
    private readonly localPlayerId: playerId,
    private readonly remotePlayerId: playerId,
    private readonly bridge: PrivateRoomSignalBridge,
    private readonly transport: PeerTransport,
  ) {
    this.messageUnsubscribe = this.transport.onMessage(message => {
      void this.handlePeerMessage(message)
    })

    this.relayUnsubscribe = this.localSystem.BattleEvent(
      message => {
        this.recordRemoteEvent(message)
        void this.bridge.sendMessage('p2p-battle-event', {
          viewerId: this.remotePlayerId,
          message,
        } satisfies P2PBattleMessage['payload'])
        void this.pushRemoteSelections()
      },
      { viewerId: this.remotePlayerId, showHidden: false },
    )
    this.timerRelayUnsubscribers = P2P_TIMER_EVENT_TYPES.map(eventType =>
      this.localSystem.onTimerEvent(eventType, data => {
        void this.bridge.sendMessage('p2p-battle-timer-event', {
          viewerId: this.remotePlayerId,
          eventType,
          data,
        } satisfies P2PBattleMessage['payload'])
      }),
    )

    this.offStateChange = this.transport.onStateChange(state => {
      if (state === 'connected') {
        void this.pushInitialStateIfReady()
      }
    })
  }

  async ready(): Promise<void> {
    if (this.isReady) return
    await this.localSystem.ready()
    this.isReady = true
    await this.pushInitialStateIfReady()
  }

  async getState(viewerId?: playerId, showHidden?: boolean): Promise<BattleState> {
    return this.localSystem.getState(viewerId ?? this.localPlayerId, showHidden)
  }

  async getAvailableSelection(viewerId: playerId): Promise<PlayerSelection[]> {
    return this.localSystem.getAvailableSelection(viewerId)
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    await this.localSystem.submitAction(selection)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    return this.localSystem.BattleEvent(callback, { viewerId: this.localPlayerId, showHidden: false })
  }

  async isTimerEnabled(): Promise<boolean> {
    return this.localSystem.isTimerEnabled()
  }

  async getPlayerTimerState(pid: playerId): Promise<PlayerTimerState | null> {
    return this.localSystem.getPlayerTimerState(pid)
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    return this.localSystem.getAllPlayerTimerStates()
  }

  async getTimerConfig(): Promise<TimerConfig> {
    return this.localSystem.getTimerConfig()
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    return this.localSystem.startAnimation(source, expectedDuration, ownerId)
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    return this.localSystem.endAnimation(animationId, actualDuration)
  }

  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    return this.localSystem.onTimerEvent(eventType, handler)
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    this.localSystem.offTimerEvent(eventType, handler)
  }

  async cleanup(): Promise<void> {
    this.messageUnsubscribe()
    this.relayUnsubscribe()
    this.timerRelayUnsubscribers.forEach(unsubscribe => unsubscribe())
    this.offStateChange()
    await this.localSystem.cleanup()
  }

  private async handlePeerMessage(message: { type: string; payload: unknown }): Promise<void> {
    if (!isP2PBattleMessage(message)) return

    if (message.type === 'p2p-battle-sync-request') {
      await this.ready()
      await this.sendInitSnapshot()
      await this.replayRemoteEventsSince(message.payload.lastSeenSequenceId ?? -1)
      await this.pushRemoteSelections()
      queueMicrotask(() => {
        void this.pushRemoteSelections()
      })
      return
    }

    if (message.type === 'p2p-battle-ack') {
      this.remoteAckSequenceId = Math.max(this.remoteAckSequenceId, message.payload.sequenceId)
      return
    }

    if (message.type === 'p2p-battle-submit-action') {
      await this.localSystem.submitAction(message.payload.selection)
      return
    }

    if (message.type === 'p2p-battle-start-animation') {
      const animationId = await this.localSystem.startAnimation(
        message.payload.source,
        message.payload.expectedDuration,
        message.payload.ownerId,
      )
      await this.bridge.sendMessage('p2p-battle-start-animation-result', {
        viewerId: this.remotePlayerId,
        requestId: message.payload.requestId,
        animationId,
      } satisfies P2PBattleMessage['payload'])
      return
    }

    if (message.type === 'p2p-battle-end-animation') {
      await this.localSystem.endAnimation(message.payload.animationId, message.payload.actualDuration)
    }
  }

  private async sendInitSnapshot(): Promise<void> {
    const [battleState, availableSelections, timer] = await Promise.all([
      this.localSystem.getState(this.remotePlayerId, false),
      this.localSystem.getAvailableSelection(this.remotePlayerId),
      this.getRemoteTimerSync(),
    ])
    await this.bridge.sendMessage('p2p-battle-init', {
      viewerId: this.remotePlayerId,
      battleState,
      availableSelections,
      timer,
    } satisfies P2PBattleMessage['payload'])
  }

  private async pushRemoteSelections(): Promise<void> {
    const availableSelections = await this.localSystem.getAvailableSelection(this.remotePlayerId)
    await this.bridge.sendMessage('p2p-battle-selection-update', {
      viewerId: this.remotePlayerId,
      availableSelections,
    } satisfies P2PBattleMessage['payload'])
  }

  private recordRemoteEvent(message: BattleMessage): void {
    this.remoteEventBacklog.push(message)
    if (this.remoteEventBacklog.length > 128) {
      this.remoteEventBacklog.shift()
    }
  }

  private async replayRemoteEventsSince(lastSeenSequenceId: number): Promise<void> {
    const missingEvents = this.remoteEventBacklog.filter(message => (message.sequenceId ?? -1) > lastSeenSequenceId)
    for (const message of missingEvents) {
      await this.bridge.sendMessage('p2p-battle-event', {
        viewerId: this.remotePlayerId,
        message,
      } satisfies P2PBattleMessage['payload'])
    }
  }

  private async pushInitialStateIfReady(): Promise<void> {
    if (!this.isReady || this.transport.getState() !== 'connected') {
      return
    }
    await this.sendInitSnapshot()
    await this.pushRemoteSelections()
  }

  private async getRemoteTimerSync(): Promise<P2PTimerSyncPayload> {
    const [config, states] = await Promise.all([
      this.localSystem.getTimerConfig(),
      this.localSystem.getAllPlayerTimerStates(),
    ])
    return { config, states }
  }
}

export class P2PPeerBattleSystem implements IBattleSystem {
  readonly battleRuntimeType = 'p2p-peer'
  private battleState: BattleState | null = null
  private availableSelections: PlayerSelection[] = []
  private readonly callbacks = new Set<BattleMessageHandler>()
  private readonly snapshotCallbacks = new Set<SnapshotHandler>()
  private readonly timerCallbacks = new Map<TimerEventType, Set<(data: Events[TimerEventType]) => void>>()
  private readonly timerStates = new Map<playerId, PlayerTimerState>()
  private timerConfig: TimerConfig = { ...DEFAULT_TIMER_CONFIG, enabled: false }
  private readonly offMessage: () => void
  private readonly offStateChange: () => void
  private initWaiters: Array<(state: BattleState) => void> = []
  private syncInflight: Promise<void> | null = null
  private lastSeenSequenceId = -1
  private hasReceivedInitialSnapshot = false
  private selectionRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  private selectionRecoveryAttempts = 0
  private actionRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  private actionRecoveryAttempts = 0
  private animationRequestSeq = 0
  private readonly pendingAnimationStarts = new Map<
    string,
    {
      resolve: (animationId: string) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

  constructor(
    private readonly localPlayerId: playerId,
    private readonly bridge: PrivateRoomSignalBridge,
    private readonly transport: PeerTransport,
  ) {
    this.offMessage = this.transport.onMessage(message => {
      void this.handleMessage(message)
    })
    this.offStateChange = this.transport.onStateChange(state => {
      if (state === 'connected' && this.hasReceivedInitialSnapshot) {
        void this.requestResync()
      }
    })
  }

  async ready(): Promise<void> {
    await this.ensureInitialized()
  }

  async getState(): Promise<BattleState> {
    await this.ensureInitialized()
    if (!this.battleState) {
      throw new Error('P2P peer battle state is not initialized')
    }
    return this.battleState
  }

  async getAvailableSelection(): Promise<PlayerSelection[]> {
    await this.ensureInitialized()
    return this.availableSelections
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    await this.waitForTransportConnected()
    const previousSequenceId = this.lastSeenSequenceId
    await this.bridge.sendMessage('p2p-battle-submit-action', { selection })
    this.scheduleActionRecovery(previousSequenceId)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotCallbacks.add(handler)
    return () => this.snapshotCallbacks.delete(handler)
  }

  async isTimerEnabled(): Promise<boolean> {
    await this.ensureInitialized()
    return this.timerConfig.enabled
  }

  async getPlayerTimerState(pid: playerId): Promise<PlayerTimerState | null> {
    await this.ensureInitialized()
    const state = this.timerStates.get(pid)
    if (!state) {
      return null
    }
    return { ...state }
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    await this.ensureInitialized()
    return Array.from(this.timerStates.values()).map(state => ({ ...state }))
  }

  async getTimerConfig(): Promise<TimerConfig> {
    await this.ensureInitialized()
    return { ...this.timerConfig }
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    await this.waitForTransportConnected()

    const requestId = `${this.localPlayerId}:${Date.now()}:${this.animationRequestSeq++}`
    const result = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAnimationStarts.delete(requestId)
        reject(new Error('Timed out waiting for remote animation start response'))
      }, 3000)
      this.pendingAnimationStarts.set(requestId, { resolve, reject, timeout })
    })

    await this.bridge.sendMessage('p2p-battle-start-animation', {
      requestId,
      source,
      expectedDuration,
      ownerId,
    } satisfies P2PBattleMessage['payload'])

    return result
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    if (!animationId) {
      return
    }
    await this.waitForTransportConnected()
    await this.bridge.sendMessage('p2p-battle-end-animation', {
      animationId,
      actualDuration,
    } satisfies P2PBattleMessage['payload'])
  }

  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    const normalizedEventType = eventType as TimerEventType
    let handlers = this.timerCallbacks.get(normalizedEventType)
    if (!handlers) {
      handlers = new Set<(data: Events[TimerEventType]) => void>()
      this.timerCallbacks.set(normalizedEventType, handlers)
    }
    handlers.add(handler as (data: Events[TimerEventType]) => void)
    return () => {
      this.offTimerEvent(eventType, handler)
    }
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    const normalizedEventType = eventType as TimerEventType
    const handlers = this.timerCallbacks.get(normalizedEventType)
    if (!handlers) {
      return
    }
    handlers.delete(handler as (data: Events[TimerEventType]) => void)
    if (handlers.size === 0) {
      this.timerCallbacks.delete(normalizedEventType)
    }
  }

  async cleanup(): Promise<void> {
    this.clearSelectionRecovery()
    this.clearActionRecovery()
    for (const pending of this.pendingAnimationStarts.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('P2P peer battle system cleaned up'))
    }
    this.pendingAnimationStarts.clear()
    this.timerCallbacks.clear()
    this.timerStates.clear()
    this.offMessage()
    this.offStateChange()
  }

  private async ensureInitialized(): Promise<void> {
    if (this.battleState) return
    if (this.syncInflight) {
      await this.syncInflight
      return
    }

    this.syncInflight = (async () => {
      await this.waitForTransportConnected()
      const initPromise = new Promise<BattleState>(resolve => {
        this.initWaiters.push(resolve)
      })
      const syncDeadline = Date.now() + 10_000
      while (!this.battleState && Date.now() < syncDeadline) {
        await this.bridge.sendMessage('p2p-battle-sync-request', {
          requesterId: this.localPlayerId,
          lastSeenSequenceId: this.lastSeenSequenceId >= 0 ? this.lastSeenSequenceId : undefined,
        })
        await Promise.race([
          initPromise,
          new Promise(resolve => setTimeout(resolve, 500)),
        ])
      }
      if (!this.battleState) {
        throw new Error('Timed out waiting for P2P battle init snapshot')
      }
      if (this.battleState) {
        for (const resolve of this.initWaiters.splice(0)) {
          resolve(this.battleState)
        }
      }
      await initPromise
    })()

    try {
      await this.syncInflight
    } finally {
      this.syncInflight = null
    }
  }

  private async requestResync(): Promise<void> {
    if (this.syncInflight) return
    await this.bridge.sendMessage('p2p-battle-sync-request', {
      requesterId: this.localPlayerId,
      lastSeenSequenceId: this.lastSeenSequenceId >= 0 ? this.lastSeenSequenceId : undefined,
    })
  }

  private async waitForTransportConnected(timeoutMs = 20_000): Promise<void> {
    if (this.transport.getState() === 'connected') return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        off()
        reject(new Error(`Timed out waiting for P2P transport connection after ${timeoutMs}ms`))
      }, timeoutMs)

      const off = this.transport.onStateChange(state => {
        if (settled) return
        if (state === 'connected') {
          settled = true
          clearTimeout(timeout)
          off()
          resolve()
        } else if (state === 'failed' || state === 'closed') {
          settled = true
          clearTimeout(timeout)
          off()
          reject(new Error(`P2P transport became ${state} before battle sync`))
        }
      })
    })
  }

  private async handleMessage(message: { type: string; payload: unknown }): Promise<void> {
    if (!isP2PBattleMessage(message)) return

    if ('viewerId' in message.payload && message.payload.viewerId !== this.localPlayerId) {
      return
    }

    if (message.type === 'p2p-battle-init') {
      this.clearActionRecovery()
      this.battleState = message.payload.battleState
      this.availableSelections = message.payload.availableSelections
      this.applyTimerSync(message.payload.timer)
      this.lastSeenSequenceId = Math.max(this.lastSeenSequenceId, message.payload.battleState.sequenceId ?? -1)
      this.hasReceivedInitialSnapshot = true
      this.handleSelectionRecovery()
      this.snapshotCallbacks.forEach(callback =>
        callback({
          battleState: this.battleState as BattleState,
          availableSelections: this.availableSelections,
        }),
      )
      for (const resolve of this.initWaiters.splice(0)) {
        resolve(this.battleState)
      }
      return
    }

    if (message.type === 'p2p-battle-selection-update') {
      this.availableSelections = message.payload.availableSelections
      this.handleSelectionRecovery()
      if (this.availableSelections.length > 0) {
        this.clearActionRecovery()
      }
      if (this.battleState) {
        this.snapshotCallbacks.forEach(callback =>
          callback({
            battleState: this.battleState as BattleState,
            availableSelections: this.availableSelections,
          }),
        )
      }
      return
    }

    if (message.type === 'p2p-battle-start-animation-result') {
      const pending = this.pendingAnimationStarts.get(message.payload.requestId)
      if (!pending) {
        return
      }
      this.pendingAnimationStarts.delete(message.payload.requestId)
      clearTimeout(pending.timeout)
      pending.resolve(message.payload.animationId)
      return
    }

    if (message.type === 'p2p-battle-timer-event') {
      const { eventType, data } = message.payload
      if (!P2P_TIMER_EVENT_TYPE_SET.has(eventType)) {
        return
      }
      this.applyTimerEvent(eventType, data)
      this.emitTimerEvent(eventType, data)
      return
    }

    if (message.type === 'p2p-battle-event') {
      this.clearActionRecovery()
      if (message.payload.message.sequenceId !== undefined) {
        this.lastSeenSequenceId = Math.max(this.lastSeenSequenceId, message.payload.message.sequenceId)
        await this.bridge.sendMessage('p2p-battle-ack', {
          viewerId: this.localPlayerId,
          sequenceId: this.lastSeenSequenceId,
        } satisfies P2PBattleMessage['payload'])
      }
      this.callbacks.forEach(callback => callback(message.payload.message))
    }
  }

  private applyTimerSync(sync: P2PTimerSyncPayload): void {
    this.timerConfig = { ...sync.config }
    this.timerStates.clear()
    for (const state of sync.states) {
      this.timerStates.set(state.playerId, { ...state })
    }

    const snapshots = this.createSnapshotsFromStates(sync.states, sync.config)
    if (snapshots.length > 0) {
      this.emitTimerEvent('timerSnapshot', { snapshots })
    }
  }

  private createSnapshotsFromStates(states: PlayerTimerState[], config: TimerConfig): TimerSnapshot[] {
    const now = Date.now()
    return states.map(state => ({
      timestamp: now,
      playerId: state.playerId,
      state: state.state,
      remainingTurnTime: state.remainingTurnTime,
      remainingTotalTime: state.remainingTotalTime,
      config: { ...config },
      hasActiveAnimations: false,
      pauseReason: state.state === TimerState.Paused ? 'system' : undefined,
    }))
  }

  private applyTimerEvent(eventType: TimerEventType, data: Events[TimerEventType]): void {
    switch (eventType) {
      case 'timerSnapshot': {
        const payload = data as Events['timerSnapshot']
        this.applyTimerSnapshots(payload.snapshots)
        return
      }
      case 'timerUpdate': {
        const payload = data as Events['timerUpdate']
        const state = this.ensureTimerState(payload.player)
        state.remainingTurnTime = payload.remainingTurnTime
        state.remainingTotalTime = payload.remainingTotalTime
        state.lastUpdateTime = Date.now()
        return
      }
      case 'timerStateChange': {
        const payload = data as Events['timerStateChange']
        const state = this.ensureTimerState(payload.playerId)
        state.state = payload.newState as TimerState
        state.lastUpdateTime = payload.timestamp
        return
      }
      case 'timerStart': {
        const payload = data as Events['timerStart']
        const now = Date.now()
        for (const pid of payload.player) {
          const state = this.ensureTimerState(pid)
          state.state = TimerState.Running
          state.remainingTurnTime =
            payload.turnTimeLimit === null ? Number.MAX_SAFE_INTEGER : payload.turnTimeLimit
          const totalTime = payload.remainingTotalTime[pid]
          if (typeof totalTime === 'number') {
            state.remainingTotalTime = totalTime
          }
          state.lastUpdateTime = now
        }
        return
      }
      case 'timerPause': {
        const payload = data as Events['timerPause']
        const now = Date.now()
        for (const pid of payload.player) {
          const state = this.ensureTimerState(pid)
          state.state = TimerState.Paused
          state.lastUpdateTime = now
        }
        return
      }
      case 'timerResume': {
        const payload = data as Events['timerResume']
        const now = Date.now()
        for (const pid of payload.player) {
          const state = this.ensureTimerState(pid)
          state.state = TimerState.Running
          state.lastUpdateTime = now
        }
        return
      }
      case 'timerTimeout': {
        const payload = data as Events['timerTimeout']
        const state = this.ensureTimerState(payload.player)
        state.state = TimerState.Timeout
        if (payload.type === 'turn') {
          state.remainingTurnTime = 0
        } else {
          state.remainingTotalTime = 0
        }
        state.lastUpdateTime = Date.now()
        return
      }
      default:
        return
    }
  }

  private applyTimerSnapshots(snapshots: TimerSnapshot[]): void {
    if (snapshots.length === 0) {
      return
    }
    const firstSnapshot = snapshots[0]
    if (!firstSnapshot) {
      return
    }
    const localSnapshot = snapshots.find(snapshot => snapshot.playerId === this.localPlayerId)
    const configSource = localSnapshot ?? firstSnapshot
    this.timerConfig = { ...configSource.config }

    for (const snapshot of snapshots) {
      this.timerStates.set(snapshot.playerId, {
        playerId: snapshot.playerId,
        state: snapshot.state,
        remainingTurnTime: snapshot.remainingTurnTime,
        remainingTotalTime: snapshot.remainingTotalTime,
        lastUpdateTime: snapshot.timestamp,
      })
    }
  }

  private ensureTimerState(pid: playerId): PlayerTimerState {
    const existing = this.timerStates.get(pid)
    if (existing) {
      return existing
    }
    const next: PlayerTimerState = {
      playerId: pid,
      state: TimerState.Stopped,
      remainingTurnTime: this.timerConfig.turnTimeLimit ?? Number.MAX_SAFE_INTEGER,
      remainingTotalTime: this.timerConfig.totalTimeLimit ?? Number.MAX_SAFE_INTEGER,
      lastUpdateTime: Date.now(),
    }
    this.timerStates.set(pid, next)
    return next
  }

  private emitTimerEvent<K extends TimerEventType>(eventType: K, data: Events[K]): void {
    const handlers = this.timerCallbacks.get(eventType)
    if (!handlers || handlers.size === 0) {
      return
    }
    for (const handler of handlers) {
      handler(data as Events[TimerEventType])
    }
  }

  private handleSelectionRecovery(): void {
    if (this.availableSelections.length > 0) {
      this.clearSelectionRecovery()
      return
    }

    if (!this.battleState || this.battleState.status !== 'On') {
      this.clearSelectionRecovery()
      return
    }

    if (this.selectionRecoveryAttempts >= 10 || this.selectionRecoveryTimer) {
      return
    }

    this.selectionRecoveryAttempts += 1
    this.selectionRecoveryTimer = setTimeout(() => {
      this.selectionRecoveryTimer = null
      void this.requestResync()
    }, 1000)
  }

  private clearSelectionRecovery(): void {
    this.selectionRecoveryAttempts = 0
    if (this.selectionRecoveryTimer) {
      clearTimeout(this.selectionRecoveryTimer)
      this.selectionRecoveryTimer = null
    }
  }

  private scheduleActionRecovery(previousSequenceId: number): void {
    this.clearActionRecovery()
    if (!this.battleState || this.battleState.status !== 'On') {
      return
    }

    const attemptRecovery = () => {
      if (!this.battleState || this.battleState.status !== 'On') {
        this.clearActionRecovery()
        return
      }

      if (this.lastSeenSequenceId > previousSequenceId) {
        this.clearActionRecovery()
        return
      }

      if (this.actionRecoveryAttempts >= 3) {
        this.clearActionRecovery()
        return
      }

      this.actionRecoveryAttempts += 1
      this.actionRecoveryTimer = setTimeout(() => {
        this.actionRecoveryTimer = null
        void this.requestResync()
        attemptRecovery()
      }, 1500)
    }

    attemptRecovery()
  }

  private clearActionRecovery(): void {
    this.actionRecoveryAttempts = 0
    if (this.actionRecoveryTimer) {
      clearTimeout(this.actionRecoveryTimer)
      this.actionRecoveryTimer = null
    }
  }
}
