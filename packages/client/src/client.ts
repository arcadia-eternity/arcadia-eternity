import {
  type BattleState,
  BattleStatus,
  BattleMessageType,
  type playerId,
  type PlayerTimerState,
  type TimerConfig,
  type TimerSnapshot,
  TimerState,
  type Events,
} from '@arcadia-eternity/const'
import {
  type ClientToServerEvents,
  type PrivateRoomPeerSignalEvent,
  type PrivateRoomPeerSignalPayload,
  type ServerToClientEvents,
  type SuccessResponse,
  type ErrorResponse,
  type PrivateRoomBattleStartInfo,
} from '@arcadia-eternity/protocol'
import { type PlayerSchemaType, type PlayerSelectionSchemaType, type PetSchemaType } from '@arcadia-eternity/schema'
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import { nanoid } from 'nanoid'

// 私人房间相关类型定义
export type PrivateRoomConfig = {
  ruleSetId?: string
  isPrivate?: boolean
  password?: string
}

export type CreatePrivateRoomData = {
  config: PrivateRoomConfig
}

export type JoinPrivateRoomData = {
  roomCode: string
  password?: string
}

export type JoinSpectatorData = {
  roomCode: string
}

export type SendPrivateRoomPeerSignalData = {
  targetPlayerId: string
  targetSessionId?: string
  signal: PrivateRoomPeerSignalPayload
}

type BattleClientOptions = {
  serverUrl: string
  autoReconnect?: boolean
  reconnectAttempts?: number
  actionTimeout?: number
  sessionId?: string // 预设的 sessionId
  auth?: {
    getToken?: () => string | null
    getPlayerId?: () => string
    refreshAuth?: () => Promise<void>
  }
}

type ClientState = {
  status: 'disconnected' | 'connecting' | 'connected'
  matchmaking: 'idle' | 'searching' | 'matched'
  battle: 'idle' | 'active' | 'ended'
  roomId?: string
  opponent?: { id: string; name: string }
}

export class BattleClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>
  private eventHandlers = new Map<string, Set<(...args: any[]) => void>>()
  private timerEventHandlers = new Map<string, Set<(data: any) => void>>()
  private state: ClientState = {
    status: 'disconnected',
    matchmaking: 'idle',
    battle: 'idle',
  }
  private options: Required<Omit<BattleClientOptions, 'auth'>> & { auth?: BattleClientOptions['auth'] }

  // 专门的状态变化监听器
  private stateChangeListeners = new Set<(state: ClientState) => void>()

  // 新架构：Timer快照本地缓存
  private timerSnapshots = new Map<playerId, TimerSnapshot>()
  private lastSnapshotUpdate: number = 0
  private lastBattleEndEventAt: number = 0

  // 多实例支持：会话管理
  private sessionId: string

  constructor(options: BattleClientOptions) {
    this.options = {
      autoReconnect: true,
      reconnectAttempts: 5,
      actionTimeout: 30000,
      ...options,
    } as Required<BattleClientOptions>

    // 使用预设的 sessionId 或创建新的
    this.sessionId = options.sessionId || this.getOrCreateSessionId()

    // 在构造函数中就创建socket
    this.socket = this.createSocket()
    this.setupEventListeners()
  }

  private createSocket() {
    const socketConfig: Partial<ManagerOptions> = {
      autoConnect: false,
      reconnection: this.options.autoReconnect,
      reconnectionAttempts: this.options.reconnectAttempts,
      reconnectionDelay: 1000,
    }

    // 初始化时设置认证信息
    this.updateSocketAuth(socketConfig)

    return io(this.options.serverUrl, socketConfig)
  }

  private getOrCreateSessionId(): string {
    try {
      // 首先尝试从 sessionStorage 获取（标签页级别）
      let sessionId = sessionStorage.getItem('battle-session-id')

      if (!sessionId) {
        // 直接用 nanoid 生成全局唯一ID
        sessionId = nanoid()
        sessionStorage.setItem('battle-session-id', sessionId)
      }

      return sessionId
    } catch {
      // 如果 sessionStorage 不可用，直接生成
      return nanoid()
    }
  }

  private updateSocketAuth(config?: any) {
    if (this.options.auth) {
      try {
        const playerId = this.options.auth.getPlayerId?.()
        const token = this.options.auth.getToken?.()

        if (playerId) {
          const query: any = {
            playerId,
            sessionId: this.sessionId,
          }

          if (config) {
            config.query = query
          } else {
            // 更新现有socket的query参数
            this.socket.io.opts.query = query
          }
        }

        if (token) {
          if (config) {
            config.auth = { token }
          } else {
            // 更新现有socket的auth
            this.socket.auth = { token }
          }
        }
      } catch (error) {
        console.warn('Failed to set auth info:', error)
      }
    }
  }

  // 公开的状态获取方法
  get currentState() {
    return { ...this.state }
  }

  // 获取实例信息
  get instanceInfo() {
    return {
      sessionId: this.sessionId,
    }
  }

  // 公开的状态重置方法
  resetState() {
    this.updateState({
      matchmaking: 'idle',
      battle: 'idle',
      roomId: undefined,
      opponent: undefined,
    })
    this.lastBattleEndEventAt = 0

    // 清理Timer快照缓存
    this.clearTimerSnapshots()
  }

  async connect(): Promise<void> {
    return this.connectWithRetry()
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    const maxRetries = 2 // 最多重试2次

    try {
      await this.attemptConnection()
    } catch (error) {
      // 检查是否是认证错误且还有重试次数
      if (this.isAuthError(error) && retryCount < maxRetries) {
        // 尝试重新获取token
        if (this.options.auth?.refreshAuth) {
          try {
            await this.options.auth.refreshAuth()
            return this.connectWithRetry(retryCount + 1)
          } catch (refreshError) {
            console.error('Token刷新失败:', refreshError)
          }
        }
      }

      // 连接失败，确保状态重置为disconnected
      this.updateState({ status: 'disconnected' })
      throw error
    }
  }

  private attemptConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) return resolve()

      // 更新认证信息
      this.updateSocketAuth()

      const connectTimeout = setTimeout(() => {
        this.updateState({ status: 'disconnected' })
        reject(new Error('Connection timeout'))
      }, this.options.actionTimeout)

      this.socket.once('connect', () => {
        clearTimeout(connectTimeout)
        this.updateState({ status: 'connected' })
        // 连接成功后立即获取服务器状态
        this.socket.emit('getServerState', response => {
          if (response.status === 'SUCCESS') {
            this.eventHandlers.get('updateState')?.forEach(handler => handler(response.data))
          }
        })
        resolve()
      })

      this.socket.once('connect_error', error => {
        clearTimeout(connectTimeout)
        this.updateState({ status: 'disconnected' })
        reject(error)
      })

      this.updateState({ status: 'connecting' })
      this.socket.connect()
    })
  }

  private isAuthError(error: any): boolean {
    const errorMessage = error?.message || error?.toString() || ''
    return (
      errorMessage.includes('INVALID_TOKEN') ||
      errorMessage.includes('TOKEN_REQUIRED_FOR_REGISTERED_USER') ||
      errorMessage.includes('AUTHENTICATION_ERROR')
    )
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
    }
    this.updateState({
      status: 'disconnected',
      matchmaking: 'idle',
      battle: 'idle',
    })

    // 清理事件处理器和缓存
    this.clearEventHandlers()
    this.clearTimerSnapshots()
  }

  async joinMatchmaking(
    data: PlayerSchemaType | { playerSchema: PlayerSchemaType; ruleSetId?: string },
  ): Promise<void> {
    this.verifyConnection()

    // 处理不同的输入格式
    let playerData: PlayerSchemaType
    let ruleSetId: string

    if ('playerSchema' in data) {
      // 新格式：包含规则集信息
      playerData = data.playerSchema
      ruleSetId = data.ruleSetId || 'standard'
    } else {
      // 旧格式：直接是 PlayerSchemaType
      playerData = data
      ruleSetId = 'standard'
    }

    this.updateState({ matchmaking: 'searching' })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('⏰ Matchmaking timeout after', this.options.actionTimeout, 'ms')
        reject(new Error('Matchmaking timeout'))
      }, this.options.actionTimeout)

      this.socket.emit(
        'joinMatchmaking',
        {
          playerSchema: playerData,
          ruleSetId,
        },
        response => {
          clearTimeout(timeout)
          this.handleMatchmakingResponse(response, resolve, reject)
        },
      )
    })
  }

  async cancelMatchmaking(): Promise<void> {
    if (this.state.matchmaking !== 'searching') {
      throw new Error('当前没有在匹配队列中')
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('取消匹配超时'))
      }, this.options.actionTimeout)

      this.socket.emit('cancelMatchmaking', response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          this.updateState({
            matchmaking: 'idle',
            roomId: undefined,
            opponent: undefined,
          })
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async sendplayerSelection(selection: PlayerSelectionSchemaType): Promise<void> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Action timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('submitPlayerSelection', selection, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          const error = this.parseError(response)
          reject(error)
        }
      })
    })
  }

  async getBattleState(): Promise<BattleState> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('getState', response => {
        if (response.status === 'SUCCESS') {
          // 添加类型断言和空值检查
          if (!response.data) {
            reject(new Error('Invalid battle state response'))
            return
          }
          const state = response.data as BattleState
          if (state.status === BattleStatus.Ended) {
            this.markBattleEnded('state-ended')
          }
          resolve(state)
        } else {
          const error = this.parseError(response)
          reject(error)
        }
      })
    })
  }

  async getAvailableSelection(): Promise<PlayerSelectionSchemaType[]> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('getAvailableSelection', response => {
        if (response.status === 'SUCCESS') {
          // 添加类型断言和空值检查
          const data = response.data as PlayerSelectionSchemaType[] | undefined
          resolve(data || [])
        } else {
          const error = this.parseError(response)
          reject(error)
        }
      })
    })
  }

  async ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ready timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('ready', response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  // 计时器相关方法
  async isTimerEnabled(): Promise<boolean> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('isTimerEnabled', response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async getPlayerTimerState(playerId: playerId): Promise<PlayerTimerState | null> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('getPlayerTimerState', { playerId }, response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('getAllPlayerTimerStates', response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async getTimerConfig(): Promise<TimerConfig> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('getTimerConfig', response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async refreshTimerSnapshotsFromServer(): Promise<void> {
    this.verifyBattleActive()

    const [timerStates, timerConfig] = await Promise.all([this.getAllPlayerTimerStates(), this.getTimerConfig()])
    const now = Date.now()
    const snapshots: TimerSnapshot[] = timerStates.map(timerState => ({
      timestamp: now,
      playerId: timerState.playerId,
      state: timerState.state,
      remainingTurnTime: timerState.remainingTurnTime,
      remainingTotalTime: timerState.remainingTotalTime,
      config: timerConfig,
      hasActiveAnimations: false,
      pauseReason: timerState.state === TimerState.Paused ? 'system' : undefined,
    }))

    this.updateTimerSnapshots(snapshots)

    const snapshotHandlers = this.timerEventHandlers.get('timerSnapshot')
    if (snapshotHandlers) {
      const payload = { snapshots }
      snapshotHandlers.forEach(handler => handler(payload))
    }
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    this.verifyBattleActive()

    return new Promise((resolve, reject) => {
      this.socket.emit('startAnimation', { source, expectedDuration, ownerId }, response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    this.verifyBattleActive()

    return new Promise(resolve => {
      this.socket.emit('endAnimation', { animationId, actualDuration })
      resolve()
    })
  }

  // 私人房间相关方法
  async createPrivateRoom(data: CreatePrivateRoomData): Promise<string> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Create room timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('createPrivateRoom', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve(response.data.roomCode)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async joinPrivateRoom(data: JoinPrivateRoomData): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join room timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('joinPrivateRoom', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async joinPrivateRoomAsSpectator(data: JoinSpectatorData): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join as spectator timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('joinPrivateRoomAsSpectator', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          // Update battle state to active for spectators
          this.updateState({
            battle: 'active',
            roomId: data.roomCode,
          })
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async leavePrivateRoom(): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Leave room timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('leavePrivateRoom', response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async togglePrivateRoomReady(team?: PetSchemaType[]): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Toggle ready timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('togglePrivateRoomReady', { team }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async startPrivateRoomBattle(hostTeam: PetSchemaType[]): Promise<PrivateRoomBattleStartInfo> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Start battle timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('startPrivateRoomBattle', { hostTeam }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async sendPrivateRoomPeerSignal(data: SendPrivateRoomPeerSignalData): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Send private room peer signal timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('sendPrivateRoomPeerSignal', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async getPrivateRoomInfo(roomCode: string): Promise<any> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Get room info timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('getPrivateRoomInfo', { roomCode }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async getCurrentPrivateRoom(): Promise<any> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Get current room timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('getCurrentPrivateRoom', response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async updatePrivateRoomRuleSet(data: { ruleSetId: string }): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Update rule set timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('updatePrivateRoomRuleSet', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async updatePrivateRoomConfig(data: {
    ruleSetId?: string
    allowSpectators?: boolean
    maxSpectators?: number
    spectatorMode?: 'free' | 'player1' | 'player2' | 'god'
    isPrivate?: boolean
    password?: string
  }): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Update room config timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('updatePrivateRoomConfig', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async transferPrivateRoomHost(targetPlayerId: string): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transfer host timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('transferPrivateRoomHost', { targetPlayerId }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async kickPlayerFromPrivateRoom(targetPlayerId: string): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Kick player timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('kickPlayerFromPrivateRoom', { targetPlayerId }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async switchToSpectator(): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Switch to spectator timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('switchToSpectator', {}, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async switchToPlayer(team: any[]): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Switch to player timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('switchToPlayer', { team }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async joinSpectateBattle(battleRoomId: string): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join spectate battle timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('joinSpectateBattle', { battleRoomId }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          // Update battle state to active for spectators
          this.updateState({
            battle: 'active',
            roomId: battleRoomId,
          })
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async leaveSpectateBattle(): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Leave spectate battle timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('leaveSpectateBattle', {}, (response: { status: string; error?: string }) => {
        clearTimeout(timeout)
        if (response.status === 'LEFT_SPECTATE') {
          // Update battle state to idle for spectators
          this.updateState({
            battle: 'idle',
            roomId: undefined,
          })
          resolve()
        } else {
          reject(new Error(response.error || 'Failed to leave spectate battle'))
        }
      })
    })
  }

  // 新架构：Timer快照相关方法

  /**
   * 获取玩家Timer快照（优先使用本地缓存）
   */
  getPlayerTimerSnapshot(playerId: playerId): TimerSnapshot | null {
    return this.timerSnapshots.get(playerId) || null
  }

  /**
   * 获取所有Timer快照
   */
  getAllTimerSnapshots(): TimerSnapshot[] {
    return Array.from(this.timerSnapshots.values())
  }

  /**
   * 更新Timer快照缓存
   */
  private updateTimerSnapshots(snapshots: TimerSnapshot[]): void {
    snapshots.forEach(snapshot => {
      this.timerSnapshots.set(snapshot.playerId, snapshot)
    })
    this.lastSnapshotUpdate = Date.now()
  }

  /**
   * 清理Timer快照缓存
   */
  private clearTimerSnapshots(): void {
    this.timerSnapshots.clear()
    this.lastSnapshotUpdate = 0
  }

  /**
   * 清理事件处理器（但保留socket监听器）
   */
  private clearEventHandlers(): void {
    console.log('🧹 Clearing event handlers, current handlers:', Array.from(this.eventHandlers.keys()))
    console.log('🧹 Stack trace:', new Error().stack)
    this.eventHandlers.clear()
    this.timerEventHandlers.clear()
    this.stateChangeListeners.clear()
  }

  once<T extends keyof ServerToClientEvents>(event: T, listener: ServerToClientEvents[T]): this {
    this.socket.once(event, listener as any)
    return this
  }

  on<T extends keyof ServerToClientEvents>(
    event: T,
    handler: (...args: Parameters<ServerToClientEvents[T]>) => void,
  ): () => void {
    // 使用类型安全的包装函数
    const wrapper = (...args: Parameters<ServerToClientEvents[T]>) => handler(...args)

    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
      // 对于这些事件，不需要重复注册socket监听器，因为它们已经在setupEventListeners中注册了
      const preRegisteredEvents = ['battleEvent', 'battleEventBatch', 'privateRoomEvent', 'privateRoomPeerSignal']
      if (!preRegisteredEvents.includes(event)) {
        this.socket.on(event, wrapper as any) // 使用安全类型断言
      }
    }

    this.eventHandlers.get(event)?.add(wrapper)
    return () => this.off(event, wrapper)
  }

  off<T extends keyof ServerToClientEvents>(
    event: T,
    handler: (...args: Parameters<ServerToClientEvents[T]>) => void,
  ): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(h => {
        if (h === handler) {
          // 对于这些事件，不需要移除socket监听器，因为它们是在setupEventListeners中注册的，应该保持活跃
          const preRegisteredEvents = ['battleEvent', 'battleEventBatch', 'privateRoomEvent', 'privateRoomPeerSignal']
          if (!preRegisteredEvents.includes(event)) {
            this.socket.off(event, h as any) // 使用安全类型断言
          }
          handlers.delete(h)
        }
      })
    }
  }

  // 状态变化监听器管理
  onStateChange(listener: (state: ClientState) => void): () => void {
    this.stateChangeListeners.add(listener)
    return () => this.offStateChange(listener)
  }

  offStateChange(listener: (state: ClientState) => void): void {
    this.stateChangeListeners.delete(listener)
  }

  // 计时器事件订阅方法
  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    if (!this.timerEventHandlers.has(eventType)) {
      this.timerEventHandlers.set(eventType, new Set())
    }

    this.timerEventHandlers.get(eventType)?.add(handler)

    return () => this.offTimerEvent(eventType, handler)
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    const handlers = this.timerEventHandlers.get(eventType)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.timerEventHandlers.delete(eventType)
      }
    }
  }

  private setupEventListeners() {
    // 连接状态事件
    this.socket.on('connect', () => {
      this.updateState({ status: 'connected' })
    })

    this.socket.on('disconnect', () => {
      // 保留 battle/matchmaking 状态，避免短暂断线被误判为战斗结束
      this.updateState({
        status: 'disconnected',
      })
    })

    // 服务器状态更新事件
    this.socket.on('updateState', serverState => {
      const handlers = this.eventHandlers.get('updateState')
      if (handlers) {
        handlers.forEach(handler => handler(serverState))
      }
    })

    // 游戏事件
    this.socket.on('matchSuccess', response => {
      if (response.status === 'SUCCESS') {
        this.lastBattleEndEventAt = 0
        this.updateState({
          matchmaking: 'matched',
          battle: 'active',
          roomId: response.data.roomId,
          opponent: response.data.opponent,
        })
      } else {
        console.error('❌ Match success event with error status:', response)
      }
    })

    // 处理单个战斗事件 - 通过eventHandlers管理系统处理
    this.socket.on('battleEvent', message => {
      // 触发battleEvent处理器
      const handlers = this.eventHandlers.get('battleEvent')
      if (handlers) {
        handlers.forEach(handler => handler(message))
      }

      // 检查是否有战斗结束消息
      if (this.isBattleEndMessageType(message.type)) {
        this.lastBattleEndEventAt = Date.now()
      }
    })

    // 处理批量战斗事件 - 通过eventHandlers管理系统处理
    this.socket.on('battleEventBatch', messages => {
      // 逐个处理批量消息
      for (const message of messages) {
        // 触发单个battleEvent处理器
        const handlers = this.eventHandlers.get('battleEvent')
        if (handlers) {
          handlers.forEach(handler => handler(message))
        }

        // 检查是否有战斗结束消息
        if (this.isBattleEndMessageType(message.type)) {
          this.lastBattleEndEventAt = Date.now()
        }
      }
    })

    // 房间关闭通知（服务端强制结束/清理）
    this.socket.on('roomClosed', message => {
      const closedSoonAfterBattleEnd = Date.now() - this.lastBattleEndEventAt < 15000
      if (!closedSoonAfterBattleEnd) {
        this.markBattleEnded('room-closed')
      }
      const handlers = this.eventHandlers.get('roomClosed')
      if (handlers) {
        handlers.forEach(handler => handler(message))
      }
    })

    // 计时器事件处理
    this.socket.on('timerEvent', event => {
      const handlers = this.timerEventHandlers.get(event.type)
      if (handlers) {
        handlers.forEach(handler => handler(event.data))
      }
    })

    // 新架构：Timer快照事件处理
    this.socket.on('timerSnapshot', data => {
      if (data.snapshots) {
        this.updateTimerSnapshots(data.snapshots)

        // 触发timerSnapshot事件处理器
        const handlers = this.timerEventHandlers.get('timerSnapshot')
        if (handlers) {
          handlers.forEach(handler => handler(data))
        }
      }
    })

    // 新架构：Timer事件批处理
    this.socket.on('timerEventBatch', events => {
      // 逐个处理批量Timer事件
      events.forEach(event => {
        const handlers = this.timerEventHandlers.get(event.type)
        if (handlers) {
          handlers.forEach(handler => handler(event.data))
        }
      })
    })

    // 掉线重连事件处理
    this.socket.on('opponentDisconnected', data => {
      const handlers = this.eventHandlers.get('opponentDisconnected')
      if (handlers) {
        handlers.forEach(handler => handler(data))
      }
    })

    this.socket.on('opponentReconnected', data => {
      const handlers = this.eventHandlers.get('opponentReconnected')
      if (handlers) {
        handlers.forEach(handler => handler(data))
      }
    })

    // 战斗重连事件处理（用于页面刷新后自动跳转）
    this.socket.on('battleReconnect', data => {
      const handlers = this.eventHandlers.get('battleReconnect')
      this.updateState({
        matchmaking: 'matched',
        battle: 'active',
        roomId: data.roomId,
      })
      if (handlers) {
        handlers.forEach(handler => handler(data))
      }
    })

    // 重连测试事件处理（用于验证消息发送是否正常）
    this.socket.on('reconnectTest', data => {
      const handlers = this.eventHandlers.get('reconnectTest')
      if (handlers) {
        handlers.forEach(handler => handler(data))
      }
    })

    // 私人房间事件处理
    this.socket.on('privateRoomEvent', event => {
      const handlers = this.eventHandlers.get('privateRoomEvent')
      if (handlers) {
        handlers.forEach(handler => {
          handler(event)
        })
      }
    })

    this.socket.on('privateRoomPeerSignal', (event: PrivateRoomPeerSignalEvent) => {
      const handlers = this.eventHandlers.get('privateRoomPeerSignal')
      if (handlers) {
        handlers.forEach(handler => handler(event))
      }
    })

    // 心跳处理
    this.socket.on('ping', async () => this.socket.emit('pong'))
  }

  private updateState(partialState: Partial<ClientState>) {
    this.state = { ...this.state, ...partialState }

    // 触发专门的状态变化监听器
    this.stateChangeListeners.forEach(listener => {
      try {
        listener(this.state)
      } catch (error) {
        console.error('State change listener error:', error)
      }
    })
  }

  private verifyConnection() {
    if (!this.socket?.connected) {
      throw new Error('Not connected to server')
    }
  }

  private verifyBattleActive() {
    this.verifyConnection()
    if (this.state.battle !== 'active') {
      throw new Error('Battle is not active')
    }
  }

  private handleMatchmakingResponse(
    response: SuccessResponse<{ status: 'QUEUED' }> | ErrorResponse,
    resolve: () => void,
    reject: (error: Error) => void,
  ) {
    if (response.status === 'SUCCESS') {
      // 确认协议中返回的数据结构
      if (!response.data) {
        reject(new Error('Invalid matchmaking response'))
        return
      }
      resolve()
    } else {
      this.updateState({ matchmaking: 'idle' })
      reject(this.parseError(response))
    }
  }

  private parseError(response: ErrorResponse): Error {
    this.handlePotentialBattleUnavailable(response)
    return new Error(response.details ? `${response.code}: ${response.details}` : response.code)
  }

  private markBattleEnded(reason: string): void {
    if (this.state.battle === 'ended' && !this.state.roomId && !this.state.opponent) {
      return
    }

    this.updateState({
      matchmaking: 'idle',
      battle: 'ended',
      roomId: undefined,
      opponent: undefined,
    })

    const handlers = this.eventHandlers.get('battleTerminated')
    if (handlers) {
      handlers.forEach(handler => handler({ reason }))
    }
  }

  private handlePotentialBattleUnavailable(response: ErrorResponse): void {
    const code = response.code
    const details = response.details ?? ''
    const detailUpper = details.toUpperCase()

    const directTerminalCodes = new Set([
      'NOT_IN_BATTLE',
      'BATTLE_NOT_FOUND',
      'BATTLE_ALREADY_ENDED',
    ])

    if (directTerminalCodes.has(code)) {
      this.markBattleEnded(code)
      return
    }

    const wrappedTerminalCodes = new Set([
      'BATTLE_ACTION_ERROR',
      'GET_SELECTION_ERROR',
      'GET_STATE_ERROR',
      'READY_ERROR',
    ])

    if (wrappedTerminalCodes.has(code)) {
      const wrappedTerminal =
        detailUpper.includes('NOT_IN_BATTLE')
        || detailUpper.includes('BATTLE_NOT_FOUND')
        || detailUpper.includes('BATTLE_ALREADY_ENDED')
        || detailUpper.includes('BATTLE IS NOT ACTIVE')
      if (wrappedTerminal) {
        this.markBattleEnded(`${code}:${details}`)
      }
    }
  }

  private isBattleEndMessageType(messageType: string): boolean {
    return messageType === 'BATTLE_END' || messageType === BattleMessageType.BattleEnd
  }
}
