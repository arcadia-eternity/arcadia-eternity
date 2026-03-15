import {
  DEFAULT_TIMER_CONFIG,
  TIMER_CONSTANTS,
  TimerState,
  TimeoutType,
  type Events,
  type PlayerTimerState,
  type TimerConfig,
  type TimerSnapshot,
  type playerId,
} from '@arcadia-eternity/const'
import { generateId, type World } from '@arcadia-eternity/engine'

type DecisionWindowPhase = 'selection' | 'switch' | 'teamSelection'
type PauseReason = 'animation' | 'system'

type TimerTimeoutHandler = (
  playerId: string,
  timeoutType: TimeoutType,
) => Promise<string | undefined> | string | undefined

type ReconnectTimeoutHandler = (playerId: string) => Promise<string | undefined> | string | undefined

interface StartDecisionWindowOptions {
  phase: DecisionWindowPhase
  playerIds: string[]
  turnTimeLimitOverrideSec?: number
  onTimeout?: TimerTimeoutHandler
}

interface TimerPlayerRuntimeState {
  state: TimerState
  remainingTurnTimeSec: number | null
  remainingTotalTimeSec: number | null
  lastUpdateTime: number
  pauseReason?: PauseReason
}

interface PersistedTimerState {
  config: TimerConfig
  players: Record<string, TimerPlayerRuntimeState>
  reconnectWindows: Record<string, PersistedReconnectWindowState>
}

interface DecisionWindowRuntime {
  phase: DecisionWindowPhase
  playerIds: string[]
  turnTimeLimitSec: number | null
  resolvedPlayers: Set<string>
  onTimeout?: TimerTimeoutHandler
  teamSelectionTimeoutEmitted: boolean
}

interface AnimationRuntimeState {
  id: string
  source: string
  ownerId: string
  startTime: number
  expectedDuration: number
  timeout: ReturnType<typeof setTimeout>
}

interface ReconnectWindowRuntime {
  playerId: string
  durationSec: number
  expiresAt: number
}

interface PersistedReconnectWindowState {
  playerId: string
  durationSec: number
  expiresAt: number
}

const TIMER_PERSIST_KEY = '__timer_v2'

export class TimerSystem {
  private world: World
  private config: TimerConfig
  private readonly playerStates = new Map<string, TimerPlayerRuntimeState>()
  private readonly animations = new Map<string, AnimationRuntimeState>()
  private readonly reconnectWindows = new Map<string, ReconnectWindowRuntime>()
  private activeWindow: DecisionWindowRuntime | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private tickInFlight = false
  private reconnectTimeoutHandler?: ReconnectTimeoutHandler
  private readonly handlers = new Map<keyof Events, Set<(data: unknown) => void>>()

  constructor(world: World, config?: Partial<TimerConfig>) {
    this.world = world
    const persisted = this.readPersistedState()
    this.config = {
      ...DEFAULT_TIMER_CONFIG,
      ...(persisted?.config ?? {}),
      ...(config ?? {}),
    }

    if (persisted?.players) {
      for (const [playerId, state] of Object.entries(persisted.players)) {
        this.playerStates.set(playerId, {
          state: state.state,
          remainingTurnTimeSec: state.remainingTurnTimeSec,
          remainingTotalTimeSec: state.remainingTotalTimeSec,
          lastUpdateTime: state.lastUpdateTime,
          pauseReason: state.pauseReason,
        })
      }
    }
    if (persisted?.reconnectWindows) {
      for (const [playerId, reconnect] of Object.entries(persisted.reconnectWindows)) {
        this.reconnectWindows.set(playerId, {
          playerId: reconnect.playerId,
          durationSec: reconnect.durationSec,
          expiresAt: reconnect.expiresAt,
        })
      }
    }

    this.persistState()
    this.refreshTickingState()
  }

  setWorld(world: World): void {
    this.stopTicking()
    this.clearAnimations()
    this.activeWindow = null
    this.world = world

    this.playerStates.clear()
    this.reconnectWindows.clear()
    const persisted = this.readPersistedState()
    this.config = {
      ...DEFAULT_TIMER_CONFIG,
      ...(persisted?.config ?? {}),
      ...this.config,
    }
    if (persisted?.players) {
      for (const [playerId, state] of Object.entries(persisted.players)) {
        this.playerStates.set(playerId, {
          state: state.state,
          remainingTurnTimeSec: state.remainingTurnTimeSec,
          remainingTotalTimeSec: state.remainingTotalTimeSec,
          lastUpdateTime: state.lastUpdateTime,
          pauseReason: state.pauseReason,
        })
      }
    }
    if (persisted?.reconnectWindows) {
      for (const [playerId, reconnect] of Object.entries(persisted.reconnectWindows)) {
        this.reconnectWindows.set(playerId, {
          playerId: reconnect.playerId,
          durationSec: reconnect.durationSec,
          expiresAt: reconnect.expiresAt,
        })
      }
    }

    this.persistState()
    this.refreshTickingState()
  }

  initializePlayers(playerIds: string[]): void {
    if (!this.config.enabled) {
      return
    }

    const now = Date.now()
    for (const playerId of playerIds) {
      if (this.playerStates.has(playerId)) {
        continue
      }
      this.playerStates.set(playerId, {
        state: TimerState.Stopped,
        remainingTurnTimeSec: this.config.turnTimeLimit ?? null,
        remainingTotalTimeSec: this.config.totalTimeLimit ?? null,
        lastUpdateTime: now,
      })
    }
    this.persistState()
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  getConfig(): TimerConfig {
    return { ...this.config }
  }

  setReconnectTimeoutHandler(handler: ReconnectTimeoutHandler | undefined): void {
    this.reconnectTimeoutHandler = handler
  }

  async startReconnectGraceWindow(playerId: string, durationSec: number): Promise<void> {
    const normalizedDuration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0
    const now = Date.now()
    this.reconnectWindows.set(playerId, {
      playerId,
      durationSec: normalizedDuration,
      expiresAt: now + normalizedDuration * 1000,
    })
    this.persistState()
    this.refreshTickingState()
    await this.checkImmediateReconnectTimeouts()
  }

  cancelReconnectGraceWindow(playerId: string): boolean {
    const existed = this.reconnectWindows.delete(playerId)
    if (!existed) {
      return false
    }
    this.persistState()
    this.refreshTickingState()
    return true
  }

  getPlayerState(playerId: string): PlayerTimerState | null {
    if (!this.config.enabled) {
      return null
    }
    const state = this.playerStates.get(playerId)
    if (!state) {
      return null
    }
    return {
      playerId: playerId as playerId,
      state: state.state,
      remainingTurnTime: this.toPublicTime(state.remainingTurnTimeSec),
      remainingTotalTime: this.toPublicTime(state.remainingTotalTimeSec),
      lastUpdateTime: state.lastUpdateTime,
    }
  }

  getAllPlayerStates(): PlayerTimerState[] {
    if (!this.config.enabled) {
      return []
    }
    return Array.from(this.playerStates.entries()).map(([playerId, state]) => ({
      playerId: playerId as playerId,
      state: state.state,
      remainingTurnTime: this.toPublicTime(state.remainingTurnTimeSec),
      remainingTotalTime: this.toPublicTime(state.remainingTotalTimeSec),
      lastUpdateTime: state.lastUpdateTime,
    }))
  }

  on<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    const existing = this.handlers.get(eventType)
    if (existing) {
      existing.add(handler as (data: unknown) => void)
    } else {
      this.handlers.set(eventType, new Set([(handler as (data: unknown) => void)]))
    }
    return () => this.off(eventType, handler)
  }

  off<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    const existing = this.handlers.get(eventType)
    if (!existing) return
    existing.delete(handler as (data: unknown) => void)
    if (existing.size === 0) {
      this.handlers.delete(eventType)
    }
  }

  async startDecisionWindow(options: StartDecisionWindowOptions): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    this.stopDecisionWindow()
    this.initializePlayers(options.playerIds)

    const now = Date.now()
    const turnLimit = options.turnTimeLimitOverrideSec ?? this.config.turnTimeLimit ?? null
    this.activeWindow = {
      phase: options.phase,
      playerIds: [...options.playerIds],
      turnTimeLimitSec: turnLimit,
      resolvedPlayers: new Set<string>(),
      onTimeout: options.onTimeout,
      teamSelectionTimeoutEmitted: false,
    }

    const stateChanges: Array<{ playerId: string; oldState: TimerState; newState: TimerState }> = []
    const remainingTotalTime: Record<string, number> = {}

    for (const playerId of options.playerIds) {
      const state = this.ensurePlayerState(playerId)
      const oldState = state.state
      state.remainingTurnTimeSec = turnLimit
      state.pauseReason = undefined
      state.lastUpdateTime = now
      state.state = TimerState.Running
      if (oldState !== state.state) {
        stateChanges.push({ playerId, oldState, newState: state.state })
      }
      remainingTotalTime[playerId] = this.toPublicTime(state.remainingTotalTimeSec)
    }

    for (const change of stateChanges) {
      this.emit('timerStateChange', {
        playerId: change.playerId as playerId,
        oldState: change.oldState,
        newState: change.newState,
        timestamp: now,
      })
    }

    this.emit('timerStart', {
      player: options.playerIds as playerId[],
      turnTimeLimit: turnLimit,
      remainingTotalTime,
    })

    if (options.phase === 'teamSelection' && turnLimit !== null) {
      this.emit('teamSelectionTimerStart', {
        timeLimit: turnLimit,
        timestamp: now,
      })
    }

    this.emitSnapshots(options.playerIds)
    this.persistState()
    this.refreshTickingState()

    await this.checkImmediateTimeouts()
  }

  markPlayerResolved(playerId: string): void {
    if (!this.config.enabled || !this.activeWindow) {
      return
    }
    if (!this.activeWindow.playerIds.includes(playerId)) {
      return
    }
    this.activeWindow.resolvedPlayers.add(playerId)
    this.applySystemPauseFromResolution()
  }

  stopDecisionWindow(): void {
    if (!this.config.enabled || !this.activeWindow) {
      return
    }

    const window = this.activeWindow
    this.activeWindow = null
    const now = Date.now()
    const changedPlayers: string[] = []

    for (const playerId of window.playerIds) {
      const state = this.playerStates.get(playerId)
      if (!state) continue
      const oldState = state.state
      if (!this.isTotalTimeout(state)) {
        state.state = TimerState.Stopped
        state.pauseReason = undefined
      }
      state.lastUpdateTime = now
      if (oldState !== state.state) {
        this.emit('timerStateChange', {
          playerId: playerId as playerId,
          oldState,
          newState: state.state,
          timestamp: now,
        })
        changedPlayers.push(playerId)
      }
    }

    if (window.phase === 'teamSelection') {
      this.emit('teamSelectionTimerStop', {
        timestamp: now,
      })
    }

    this.refreshTickingState()
    this.emitSnapshots(changedPlayers.length > 0 ? changedPlayers : window.playerIds)
    this.persistState()
  }

  startAnimation(source: string, expectedDuration: number, ownerId: string): string {
    if (!this.config.enabled) {
      return 'disabled'
    }

    const duration = Math.min(expectedDuration, this.config.maxAnimationDuration)
    const animationId = generateId('animation')
    const hadActiveAnimations = this.hasActiveAnimations()
    const timeout = setTimeout(() => {
      this.forceEndAnimation(animationId)
    }, duration + 1000)

    this.animations.set(animationId, {
      id: animationId,
      source,
      ownerId,
      startTime: Date.now(),
      expectedDuration: duration,
      timeout,
    })

    this.emit('animationStart', {
      animationId,
      duration,
      source: source as Events['animationStart']['source'],
    })

    if (!hadActiveAnimations && this.config.animationPauseEnabled && this.activeWindow) {
      this.emit('timerPause', {
        player: this.activeWindow.playerIds as playerId[],
        reason: 'animation',
      })
    }

    this.emitSnapshots(this.activeWindow?.playerIds)
    this.persistState()
    return animationId
  }

  endAnimation(animationId: string, actualDuration?: number): void {
    if (!this.config.enabled || animationId === 'disabled') {
      return
    }
    const animation = this.animations.get(animationId)
    if (!animation) {
      return
    }

    const hadActiveAnimations = this.hasActiveAnimations()
    this.clearAnimation(animationId)
    const remainingActiveAnimations = this.hasActiveAnimations()

    this.emit('animationEnd', {
      animationId,
      actualDuration: actualDuration ?? Math.max(0, Date.now() - animation.startTime),
    })

    if (
      hadActiveAnimations &&
      !remainingActiveAnimations &&
      this.config.animationPauseEnabled &&
      this.activeWindow
    ) {
      this.emit('timerResume', {
        player: this.activeWindow.playerIds as playerId[],
      })
    }

    this.emitSnapshots(this.activeWindow?.playerIds)
    this.persistState()
  }

  cleanup(): void {
    this.stopDecisionWindow()
    this.stopTicking()
    this.clearAnimations()
    this.reconnectWindows.clear()
    this.reconnectTimeoutHandler = undefined
    this.handlers.clear()
    this.persistState()
  }

  private startTicking(): void {
    if (this.tickTimer || !this.hasPendingTickWork()) {
      return
    }
    this.tickTimer = setInterval(() => {
      if (this.tickInFlight) return
      this.tickInFlight = true
      this.handleTick().finally(() => {
        this.tickInFlight = false
      })
    }, TIMER_CONSTANTS.UPDATE_INTERVAL)
  }

  private stopTicking(): void {
    if (!this.tickTimer) return
    clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  private refreshTickingState(): void {
    if (this.hasPendingTickWork()) {
      this.startTicking()
      return
    }
    this.stopTicking()
  }

  private hasPendingTickWork(): boolean {
    if (this.activeWindow !== null) {
      return true
    }
    return this.reconnectWindows.size > 0
  }

  private async handleTick(): Promise<void> {
    const now = Date.now()
    if (this.activeWindow && this.config.enabled) {
      await this.handleDecisionWindowTick(now)
    }
    await this.handleReconnectTick(now)
    this.persistState()
    this.refreshTickingState()
  }

  private async handleDecisionWindowTick(now: number): Promise<void> {
    if (!this.activeWindow || !this.config.enabled) {
      return
    }

    const shouldPauseByAnimation = this.config.animationPauseEnabled && this.hasActiveAnimations()
    const pendingTimeouts: Array<{ playerId: string; type: TimeoutType }> = []

    for (const playerId of this.activeWindow.playerIds) {
      const state = this.playerStates.get(playerId)
      if (!state || state.state !== TimerState.Running) {
        continue
      }

      const elapsedSec = Math.max(0, (now - state.lastUpdateTime) / 1000)
      state.lastUpdateTime = now

      if (!shouldPauseByAnimation) {
        if (state.remainingTurnTimeSec !== null) {
          state.remainingTurnTimeSec = Math.max(0, state.remainingTurnTimeSec - elapsedSec)
        }
        if (state.remainingTotalTimeSec !== null) {
          state.remainingTotalTimeSec = Math.max(0, state.remainingTotalTimeSec - elapsedSec)
        }
      }

      this.emit('timerUpdate', {
        player: playerId as playerId,
        remainingTurnTime: this.toPublicTime(state.remainingTurnTimeSec),
        remainingTotalTime: this.toPublicTime(state.remainingTotalTimeSec),
      })

      if (this.isTotalTimeout(state)) {
        pendingTimeouts.push({ playerId, type: TimeoutType.Total })
      } else if (this.isTurnTimeout(state)) {
        pendingTimeouts.push({ playerId, type: TimeoutType.Turn })
      }
    }

    if (pendingTimeouts.length > 0) {
      await this.processTimeouts(pendingTimeouts)
    }
  }

  private async checkImmediateTimeouts(): Promise<void> {
    if (!this.activeWindow) return
    const timeouts: Array<{ playerId: string; type: TimeoutType }> = []
    for (const playerId of this.activeWindow.playerIds) {
      const state = this.playerStates.get(playerId)
      if (!state) continue
      if (this.isTotalTimeout(state)) {
        timeouts.push({ playerId, type: TimeoutType.Total })
      } else if (this.isTurnTimeout(state)) {
        timeouts.push({ playerId, type: TimeoutType.Turn })
      }
    }
    if (timeouts.length > 0) {
      await this.processTimeouts(timeouts)
      this.persistState()
    }
  }

  private async checkImmediateReconnectTimeouts(): Promise<void> {
    const now = Date.now()
    const timedOutPlayers: string[] = []
    for (const [playerId, window] of this.reconnectWindows.entries()) {
      if (window.expiresAt <= now) {
        timedOutPlayers.push(playerId)
      }
    }
    if (timedOutPlayers.length > 0) {
      await this.processReconnectTimeouts(timedOutPlayers)
      this.persistState()
      this.refreshTickingState()
    }
  }

  private async handleReconnectTick(now: number): Promise<void> {
    if (this.reconnectWindows.size === 0) {
      return
    }
    const timedOutPlayers: string[] = []
    for (const [playerId, window] of this.reconnectWindows.entries()) {
      if (window.expiresAt <= now) {
        timedOutPlayers.push(playerId)
      }
    }
    if (timedOutPlayers.length > 0) {
      await this.processReconnectTimeouts(timedOutPlayers)
    }
  }

  private async processReconnectTimeouts(playerIds: string[]): Promise<void> {
    for (const playerId of playerIds) {
      const existing = this.reconnectWindows.get(playerId)
      if (!existing) {
        continue
      }
      this.reconnectWindows.delete(playerId)
      if (this.reconnectTimeoutHandler) {
        await this.reconnectTimeoutHandler(playerId)
      }
    }
  }

  private async processTimeouts(timeouts: Array<{ playerId: string; type: TimeoutType }>): Promise<void> {
    if (!this.activeWindow) {
      return
    }

    const changedPlayers: string[] = []

    for (const { playerId, type } of timeouts) {
      const state = this.playerStates.get(playerId)
      if (!state || state.state !== TimerState.Running) {
        continue
      }

      const oldState = state.state
      state.state = TimerState.Timeout
      state.pauseReason = undefined
      changedPlayers.push(playerId)

      this.emit('timerStateChange', {
        playerId: playerId as playerId,
        oldState,
        newState: TimerState.Timeout,
        timestamp: Date.now(),
      })

      let autoAction: string | undefined
      if (this.activeWindow.onTimeout) {
        autoAction = await this.activeWindow.onTimeout(playerId, type)
      }

      if (
        this.activeWindow &&
        this.activeWindow.phase === 'teamSelection' &&
        type === TimeoutType.Turn &&
        !this.activeWindow.teamSelectionTimeoutEmitted
      ) {
        this.activeWindow.teamSelectionTimeoutEmitted = true
        this.emit('teamSelectionTimeout', {
          timestamp: Date.now(),
        })
      }

      this.emit('timerTimeout', {
        player: playerId as playerId,
        type,
        autoAction,
      })
    }

    if (changedPlayers.length > 0) {
      this.emitSnapshots(changedPlayers)
    }
  }

  private applySystemPauseFromResolution(): void {
    if (!this.activeWindow) {
      return
    }

    const now = Date.now()
    const pausedPlayers: string[] = []
    const resumedPlayers: string[] = []
    const changedPlayers: string[] = []

    for (const playerId of this.activeWindow.playerIds) {
      const state = this.playerStates.get(playerId)
      if (!state) continue

      if (state.state === TimerState.Timeout) continue

      const shouldPause = this.activeWindow.resolvedPlayers.has(playerId)
      if (shouldPause && state.state === TimerState.Running) {
        const oldState = state.state
        state.state = TimerState.Paused
        state.pauseReason = 'system'
        state.lastUpdateTime = now
        pausedPlayers.push(playerId)
        changedPlayers.push(playerId)
        this.emit('timerStateChange', {
          playerId: playerId as playerId,
          oldState,
          newState: state.state,
          timestamp: now,
        })
      } else if (!shouldPause && state.state === TimerState.Paused && state.pauseReason === 'system') {
        const oldState = state.state
        state.state = TimerState.Running
        state.pauseReason = undefined
        state.lastUpdateTime = now
        resumedPlayers.push(playerId)
        changedPlayers.push(playerId)
        this.emit('timerStateChange', {
          playerId: playerId as playerId,
          oldState,
          newState: state.state,
          timestamp: now,
        })
      }
    }

    if (pausedPlayers.length > 0) {
      this.emit('timerPause', {
        player: pausedPlayers as playerId[],
        reason: 'system',
      })
    }

    if (resumedPlayers.length > 0) {
      this.emit('timerResume', {
        player: resumedPlayers as playerId[],
      })
    }

    if (changedPlayers.length > 0) {
      this.emitSnapshots(changedPlayers)
      this.persistState()
    }
  }

  private ensurePlayerState(playerId: string): TimerPlayerRuntimeState {
    const existing = this.playerStates.get(playerId)
    if (existing) {
      return existing
    }
    const created: TimerPlayerRuntimeState = {
      state: TimerState.Stopped,
      remainingTurnTimeSec: this.config.turnTimeLimit ?? null,
      remainingTotalTimeSec: this.config.totalTimeLimit ?? null,
      lastUpdateTime: Date.now(),
    }
    this.playerStates.set(playerId, created)
    return created
  }

  private clearAnimation(animationId: string): void {
    const animation = this.animations.get(animationId)
    if (!animation) return
    clearTimeout(animation.timeout)
    this.animations.delete(animationId)
  }

  private forceEndAnimation(animationId: string): void {
    const animation = this.animations.get(animationId)
    if (!animation) return
    this.endAnimation(animationId, Math.max(0, Date.now() - animation.startTime))
  }

  private clearAnimations(): void {
    for (const animation of this.animations.values()) {
      clearTimeout(animation.timeout)
    }
    this.animations.clear()
  }

  private hasActiveAnimations(): boolean {
    return this.animations.size > 0
  }

  private isTurnTimeout(state: TimerPlayerRuntimeState): boolean {
    return state.remainingTurnTimeSec !== null && state.remainingTurnTimeSec <= 0
  }

  private isTotalTimeout(state: TimerPlayerRuntimeState): boolean {
    return state.remainingTotalTimeSec !== null && state.remainingTotalTimeSec <= 0
  }

  private emitSnapshots(playerIds?: string[]): void {
    if (!this.config.enabled) {
      return
    }
    const ids = playerIds ?? Array.from(this.playerStates.keys())
    const snapshots: TimerSnapshot[] = ids
      .map(playerId => this.createPlayerSnapshot(playerId))
      .filter((snapshot): snapshot is TimerSnapshot => snapshot !== null)
    if (snapshots.length === 0) {
      return
    }
    this.emit('timerSnapshot', { snapshots })
  }

  private createPlayerSnapshot(playerId: string): TimerSnapshot | null {
    const state = this.playerStates.get(playerId)
    if (!state) {
      return null
    }
    const effectiveTurnLimit = this.getEffectiveTurnTimeLimit(playerId)
    const snapshotConfig: TimerConfig = {
      ...this.config,
      turnTimeLimit: effectiveTurnLimit ?? undefined,
    }

    return {
      timestamp: Date.now(),
      playerId: playerId as playerId,
      state: state.state,
      remainingTurnTime: this.toPublicTime(state.remainingTurnTimeSec),
      remainingTotalTime: this.toPublicTime(state.remainingTotalTimeSec),
      config: snapshotConfig,
      hasActiveAnimations: this.hasActiveAnimations(),
      pauseReason: state.pauseReason,
    }
  }

  private getEffectiveTurnTimeLimit(playerId: string): number | null {
    if (this.activeWindow && this.activeWindow.playerIds.includes(playerId)) {
      return this.activeWindow.turnTimeLimitSec
    }
    return this.config.turnTimeLimit ?? null
  }

  private toPublicTime(value: number | null): number {
    if (value === null) return Number.MAX_SAFE_INTEGER
    return Math.max(0, value)
  }

  private emit<K extends keyof Events>(eventType: K, data: Events[K]): void {
    const handlers = this.handlers.get(eventType)
    if (!handlers || handlers.size === 0) {
      return
    }
    for (const handler of handlers) {
      handler(data as unknown)
    }
  }

  private persistState(): void {
    const players: Record<string, TimerPlayerRuntimeState> = {}
    for (const [playerId, state] of this.playerStates.entries()) {
      players[playerId] = {
        state: state.state,
        remainingTurnTimeSec: state.remainingTurnTimeSec,
        remainingTotalTimeSec: state.remainingTotalTimeSec,
        lastUpdateTime: state.lastUpdateTime,
        pauseReason: state.pauseReason,
      }
    }
    const reconnectWindows: Record<string, PersistedReconnectWindowState> = {}
    for (const [playerId, window] of this.reconnectWindows.entries()) {
      reconnectWindows[playerId] = {
        playerId: window.playerId,
        durationSec: window.durationSec,
        expiresAt: window.expiresAt,
      }
    }
    const persisted: PersistedTimerState = {
      config: { ...this.config },
      players,
      reconnectWindows,
    }
    const worldState = this.world.state as Record<string, unknown>
    worldState[TIMER_PERSIST_KEY] = persisted as unknown
  }

  private readPersistedState(): PersistedTimerState | null {
    const worldState = this.world.state as Record<string, unknown>
    const raw = worldState[TIMER_PERSIST_KEY]
    if (!raw || typeof raw !== 'object') {
      return null
    }
    return raw as PersistedTimerState
  }
}
