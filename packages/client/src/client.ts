import {
  type BattleState,
  type playerId,
  type PlayerTimerState,
  type TimerConfig,
  type TimerSnapshot,
  type Events,
} from '@arcadia-eternity/const'
import {
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SuccessResponse,
  type ErrorResponse,
} from '@arcadia-eternity/protocol'
import { type PlayerSchemaType, type PlayerSelectionSchemaType } from '@arcadia-eternity/schema'
import { io, type Socket } from 'socket.io-client'

type BattleClientOptions = {
  serverUrl: string
  autoReconnect?: boolean
  reconnectAttempts?: number
  actionTimeout?: number
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

  // 新架构：Timer快照本地缓存
  private timerSnapshots = new Map<playerId, TimerSnapshot>()
  private lastSnapshotUpdate: number = 0

  constructor(options: BattleClientOptions) {
    this.options = {
      autoReconnect: true,
      reconnectAttempts: 5,
      actionTimeout: 30000,
      ...options,
    }

    // 在构造函数中就创建socket
    this.socket = this.createSocket()
    this.setupEventListeners()
  }

  private createSocket() {
    const socketConfig: any = {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: this.options.autoReconnect,
      reconnectionAttempts: this.options.reconnectAttempts,
      reconnectionDelay: 1000,
    }

    // 初始化时设置认证信息
    this.updateSocketAuth(socketConfig)

    return io(this.options.serverUrl, socketConfig)
  }

  private updateSocketAuth(config?: any) {
    if (this.options.auth) {
      try {
        const playerId = this.options.auth.getPlayerId?.()
        const token = this.options.auth.getToken?.()

        if (playerId) {
          if (config) {
            config.query = { playerId }
          } else {
            // 更新现有socket的query参数
            this.socket.io.opts.query = { playerId }
          }
        }

        if (token) {
          if (config) {
            config.auth = { token }
          } else {
            // 更新现有socket的auth
            this.socket.auth = { token }
          }
          console.log('Socket.IO auth configured with token:', token.substring(0, 20) + '...')
        } else {
          console.log('Socket.IO: No token available')
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

  // 公开的状态重置方法
  resetState() {
    console.log('🔄 Resetting BattleClient state to idle')
    this.updateState({
      matchmaking: 'idle',
      battle: 'idle',
      roomId: undefined,
      opponent: undefined,
    })

    // 清理Timer快照缓存
    this.clearTimerSnapshots()

    // 清理事件处理器（但保留socket监听器）
    this.clearEventHandlers()
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
        console.log(`认证失败，尝试重新获取token并重试 (${retryCount + 1}/${maxRetries})`)

        // 尝试重新获取token
        if (this.options.auth?.refreshAuth) {
          try {
            await this.options.auth.refreshAuth()
            console.log('Token刷新成功，重试连接')
            return this.connectWithRetry(retryCount + 1)
          } catch (refreshError) {
            console.error('Token刷新失败:', refreshError)
          }
        }
      }

      throw error
    }
  }

  private attemptConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) return resolve()

      // 更新认证信息
      this.updateSocketAuth()

      const connectTimeout = setTimeout(() => {
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

  async joinMatchmaking(playerData: PlayerSchemaType): Promise<void> {
    this.verifyConnection()
    console.log('🔍 Starting matchmaking process for player:', playerData.id)
    this.updateState({ matchmaking: 'searching' })
    console.log('🔄 State updated to searching, current state:', this.state.matchmaking)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('⏰ Matchmaking timeout after', this.options.actionTimeout, 'ms')
        reject(new Error('Matchmaking timeout'))
      }, this.options.actionTimeout)

      console.log('📤 Sending joinMatchmaking request to server')
      this.socket.emit('joinMatchmaking', playerData, response => {
        clearTimeout(timeout)
        console.log('📥 Received joinMatchmaking response:', response)
        this.handleMatchmakingResponse(response, resolve, reject)
      })
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
          reject(this.parseError(response))
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
          resolve(response.data as BattleState)
        } else {
          reject(this.parseError(response))
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
          reject(this.parseError(response))
        }
      })
    })
  }

  async ready(): Promise<void> {
    return new Promise(resolve => {
      this.socket.emit('ready')
      resolve()
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
    this.eventHandlers.clear()
    this.timerEventHandlers.clear()
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
      // 对于battleEvent和battleEventBatch，不需要重复注册socket监听器
      // 因为它们已经在setupEventListeners中注册了
      if (event !== 'battleEvent' && event !== 'battleEventBatch') {
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
          // 对于battleEvent和battleEventBatch，不需要移除socket监听器
          // 因为它们是在setupEventListeners中注册的，应该保持活跃
          if (event !== 'battleEvent' && event !== 'battleEventBatch') {
            this.socket.off(event, h as any) // 使用安全类型断言
          }
          handlers.delete(h)
        }
      })
    }
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
      this.updateState({
        status: 'disconnected',
        matchmaking: 'idle',
        battle: 'idle',
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
      console.log('🎯 Received matchSuccess event:', response)
      if (response.status === 'SUCCESS') {
        console.log('✅ Match success confirmed, updating state:', {
          roomId: response.data.roomId,
          opponent: response.data.opponent,
          previousState: this.state.matchmaking,
        })
        this.updateState({
          matchmaking: 'matched',
          battle: 'active',
          roomId: response.data.roomId,
          opponent: response.data.opponent,
        })
        console.log('🔄 State updated, new state:', {
          matchmaking: this.state.matchmaking,
          battle: this.state.battle,
          roomId: this.state.roomId,
          opponent: this.state.opponent,
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
      if (message.type === 'BATTLE_END') {
        this.updateState({ battle: 'ended' })
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
        if (message.type === 'BATTLE_END') {
          this.updateState({ battle: 'ended' })
        }
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

    // 心跳处理
    this.socket.on('ping', () => this.socket.emit('pong'))
  }

  private updateState(partialState: Partial<ClientState>) {
    const oldState = { ...this.state }
    this.state = { ...this.state, ...partialState }
    console.log('🔄 BattleClient state updated:', {
      old: oldState,
      new: this.state,
      changes: partialState,
    })

    // 触发状态变化事件，确保Vue响应式系统能够检测到变化
    this.eventHandlers.get('stateChange')?.forEach(handler => handler(this.state))
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
    return new Error(response.details ? `${response.code}: ${response.details}` : response.code)
  }
}
