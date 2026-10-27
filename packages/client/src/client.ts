import {
  type BattleState,
  type BattleMessage,
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
  type CreatePrivateRoomRequest,
  type JoinPrivateRoomRequest,
  type JoinPrivateRoomSpectatorRequest,
  type ServerEnvironmentAcceptance,
} from '@arcadia-eternity/protocol'
import { type PlayerSchemaType, type PlayerSelectionSchemaType, type PetSchemaType } from '@arcadia-eternity/schema'
import { io, type ManagerOptions, type Socket } from 'socket.io-client'
import { nanoid } from 'nanoid'

// 私人房间相关类型定义
export type PrivateRoomConfig = CreatePrivateRoomRequest['config']
export type CreatePrivateRoomData = CreatePrivateRoomRequest
export type JoinPrivateRoomData = JoinPrivateRoomRequest
export type JoinSpectatorData = JoinPrivateRoomSpectatorRequest

export type SendPrivateRoomPeerSignalData = {
  targetPlayerId: string
  targetSessionId?: string
  signal: PrivateRoomPeerSignalPayload
}

type BattleClientOptions = {
  serverUrl: string
  socketPath?: string
  autoReconnect?: boolean
  reconnectAttempts?: number
  actionTimeout?: number
  sessionId?: string // 预设的 sessionId
  auth?: {
    getToken?: () => string | null
    /** Current room seat ID, never a local profile UID or authentication proof. */
    getPlayerId?: () => string
    /** Stable for a server session even if its token is refreshed. */
    getSessionId?: () => string | null
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

// These events are dispatched by the client's permanent socket listeners. Other
// events are subscribed directly, with one removable socket callback per subscription.
const dispatchedEvents = new Set<string>([
  'updateState',
  'battleEvent',
  'roomClosed',
  'opponentDisconnected',
  'opponentReconnected',
  'battleReconnect',
  'reconnectTest',
  'privateRoomEvent',
  'privateRoomPeerSignal',
  'battleTerminated',
])

export class BattleClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()
  private subscriptions = new Map<string, Map<(...args: unknown[]) => void, Set<(...args: unknown[]) => void>>>()
  private timerEventHandlers = new Map<string, Set<(data: unknown) => void>>()
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
  private currentBattleTurn: number | null = null

  // 多实例支持：会话管理
  private sessionId: string
  private authIdentity: string | null | undefined
  private connectionTask?: Promise<void>
  private connecting = false
  private connectionEpoch = 0
  private cancelConnection?: (error: Error) => void

  /** Endpoint of this connection, used to scope its server-owned content catalog. */
  get serverUrl(): string {
    return this.options.serverUrl
  }

  constructor(options: BattleClientOptions) {
    this.options = {
      socketPath: '/socket.io',
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
      path: this.normalizeSocketPath(this.options.socketPath),
    }

    // 初始化时设置认证信息
    this.updateSocketAuth(socketConfig)

    return io(this.options.serverUrl, socketConfig)
  }

  private normalizeSocketPath(pathValue: string): string {
    const trimmed = pathValue.trim()
    if (!trimmed) return '/socket.io'
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
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

  private updateSocketAuth(config?: Record<string, unknown>) {
    // Socket.IO invokes this for every handshake, including automatic reconnects.
    // Profile and seat IDs are deliberately absent: only the server token authorizes a session.
    const auth = (callback: (data: { token?: string }) => void) => {
      let token: string | null
      let sessionId: string | null
      try {
        token = this.options.auth?.getToken?.() ?? null
        sessionId = this.options.auth?.getSessionId?.() ?? null
      } catch (error) {
        token = null
        sessionId = null
        console.warn('Failed to read session credentials:', error)
      }

      const identity = token ? (sessionId ? `session:${sessionId}` : `token:${token}`) : null
      if (this.authIdentity !== undefined && this.authIdentity !== identity) {
        if (this.state.battle === 'active' || this.state.roomId) {
          this.markBattleEnded('session-changed')
        }
        this.resetState()
      }
      this.authIdentity = identity
      callback(token ? { token } : {})
    }

    if (config) {
      config.auth = auth
      config.query = {}
    } else {
      this.socket.auth = auth
      this.socket.io.opts.query = {}
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
    this.currentBattleTurn = null

    // 清理Timer快照缓存
    this.clearTimerSnapshots()
  }

  async connect(): Promise<void> {
    return this.startConnection()
  }

  private startConnection(refreshFirst = false): Promise<void> {
    if (this.connectionTask) return this.connectionTask
    this.connecting = true
    const epoch = this.connectionEpoch
    this.connectionTask = (async () => {
      if (refreshFirst) {
        await this.options.auth?.refreshAuth?.()
      }
      await this.connectWithRetry(epoch)
    })().finally(() => {
      this.connecting = false
      this.connectionTask = undefined
    })
    return this.connectionTask
  }

  private async connectWithRetry(epoch: number, retryCount = 0): Promise<void> {
    if (epoch !== this.connectionEpoch) throw new Error('Connection cancelled')
    const maxRetries = 2

    try {
      await this.attemptConnection()
    } catch (error) {
      if (epoch !== this.connectionEpoch) throw new Error('Connection cancelled', { cause: error })
      if (this.isAuthError(error) && retryCount < maxRetries && this.options.auth?.refreshAuth) {
        await this.options.auth.refreshAuth()
        return this.connectWithRetry(epoch, retryCount + 1)
      }

      this.updateState({ status: 'disconnected' })
      throw error
    }
  }

  private attemptConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) return resolve()
      this.updateSocketAuth()

      const cleanup = () => {
        clearTimeout(connectTimeout)
        this.socket.off('connect', onConnect)
        this.socket.off('connect_error', onError)
        this.cancelConnection = undefined
      }
      const onConnect = () => {
        cleanup()
        this.updateState({ status: 'connected' })
        this.socket.emit('getServerState', response => {
          if (response.status === 'SUCCESS') {
            this.eventHandlers.get('updateState')?.forEach(handler => handler(response.data))
          }
        })
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        this.updateState({ status: 'disconnected' })
        reject(error)
      }
      const connectTimeout = setTimeout(() => {
        onError(new Error('Connection timeout'))
        this.socket.disconnect()
      }, this.options.actionTimeout)

      this.cancelConnection = onError
      this.socket.once('connect', onConnect)
      this.socket.once('connect_error', onError)
      this.updateState({ status: 'connecting' })
      this.socket.connect()
    })
  }

  private isAuthError(error: unknown): boolean {
    const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined
    const errorMessage = typeof message === 'string' ? message : typeof error === 'string' ? error : ''
    return (
      errorMessage.includes('INVALID_TOKEN') ||
      errorMessage.includes('INVALID_SESSION') ||
      errorMessage.includes('SESSION_EXPIRED') ||
      errorMessage.includes('SESSION_REQUIRED') ||
      errorMessage.includes('TOKEN_REQUIRED') ||
      errorMessage.includes('TOKEN_REQUIRED_FOR_REGISTERED_USER') ||
      errorMessage.includes('AUTHENTICATION_ERROR')
    )
  }

  disconnect() {
    this.connectionEpoch += 1
    this.cancelConnection?.(new Error('Connection cancelled'))
    if (this.socket) {
      this.socket.disconnect()
    }
    this.updateState({
      status: 'disconnected',
      matchmaking: 'idle',
      battle: 'idle',
      roomId: undefined,
      opponent: undefined,
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
    const expectedTurn = this.currentBattleTurn ?? (await this.getBattleState()).currentTurn
    const request = { ...selection, expectedTurn, requestId: nanoid() }
    const roomId = this.state.roomId

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>
      let settled = false
      let attempts = 0
      const send = () => {
        attempts += 1
        timeout = setTimeout(() => {
          if (settled) return
          if (attempts < 2 && this.socket.connected && this.state.roomId === roomId && this.state.battle === 'active') {
            // An acknowledgement may be lost after the server accepted the action.
            // Retransmit the exact request so the server can return its saved result.
            send()
          } else {
            settled = true
            reject(new Error('Action timeout'))
          }
        }, this.options.actionTimeout)

        this.socket.emit('submitPlayerSelection', request, response => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (response.status === 'SUCCESS') resolve()
          else reject(this.parseError(response))
        })
      }
      send()
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
          this.currentBattleTurn = state.currentTurn
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
          this.resetState()
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async togglePrivateRoomReady(team?: PetSchemaType[], environment?: ServerEnvironmentAcceptance): Promise<void> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Toggle ready timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('togglePrivateRoomReady', { team, ...(environment && { environment }) }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async startPrivateRoomBattle(
    hostTeam: PetSchemaType[],
    environment?: ServerEnvironmentAcceptance,
  ): Promise<PrivateRoomBattleStartInfo> {
    this.verifyConnection()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Start battle timeout'))
      }, this.options.actionTimeout)

      this.socket.emit('startPrivateRoomBattle', { hostTeam, ...(environment && { environment }) }, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') {
          resolve(response.data)
        } else {
          reject(this.parseError(response))
        }
      })
    })
  }

  async finishPrivateRoomBattle(data: { winner: string | null; reason: string }): Promise<void> {
    this.verifyConnection()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Finish battle timeout')), this.options.actionTimeout)
      this.socket.emit('finishPrivateRoomBattle', data, response => {
        clearTimeout(timeout)
        if (response.status === 'SUCCESS') resolve()
        else reject(this.parseError(response))
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

  async getPrivateRoomInfo(roomCode: string): Promise<unknown> {
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

  async getCurrentPrivateRoom(): Promise<unknown> {
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

  async switchToPlayer(team: PetSchemaType[]): Promise<void> {
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

  /** Remove external subscriptions while preserving the client's own socket listeners. */
  private clearEventHandlers(): void {
    for (const [event, handlers] of this.eventHandlers) {
      if (!dispatchedEvents.has(event))
        for (const handler of handlers) this.socket.off(event as keyof ServerToClientEvents, handler as never)
    }
    for (const subscriptions of this.subscriptions.values())
      for (const wrappers of subscriptions.values()) wrappers.clear()
    this.eventHandlers.clear()
    this.subscriptions.clear()
    this.timerEventHandlers.clear()
    this.stateChangeListeners.clear()
  }

  once<T extends keyof ServerToClientEvents>(event: T, listener: ServerToClientEvents[T]): this {
    this.subscribe(event, listener, true)
    return this
  }

  on<T extends keyof ServerToClientEvents>(event: T, handler: ServerToClientEvents[T]): () => void {
    return this.subscribe(event, handler, false)
  }

  private subscribe<T extends keyof ServerToClientEvents>(
    event: T,
    handler: ServerToClientEvents[T],
    once: boolean,
  ): () => void {
    const original = handler as (...args: unknown[]) => void
    const handlers = this.eventHandlers.get(event) ?? new Set()
    const subscriptions = this.subscriptions.get(event) ?? new Map()
    const wrappers = subscriptions.get(original) ?? new Set()
    const wrapper = (...args: unknown[]) => {
      if (once) unsubscribe()
      original(...args)
    }
    const unsubscribe = () => {
      if (!wrappers.delete(wrapper)) return
      handlers.delete(wrapper)
      if (!dispatchedEvents.has(event)) this.socket.off(event, wrapper as never)
      if (!wrappers.size) subscriptions.delete(original)
      if (!handlers.size) this.eventHandlers.delete(event)
      if (!subscriptions.size) this.subscriptions.delete(event)
    }
    handlers.add(wrapper)
    wrappers.add(wrapper)
    subscriptions.set(original, wrappers)
    this.eventHandlers.set(event, handlers)
    this.subscriptions.set(event, subscriptions)
    if (!dispatchedEvents.has(event)) this.socket.on(event, wrapper as never)
    return unsubscribe
  }

  off<T extends keyof ServerToClientEvents>(event: T, handler: ServerToClientEvents[T]): void {
    const original = handler as (...args: unknown[]) => void
    const wrappers = this.subscriptions.get(event)?.get(original)
    if (!wrappers) return
    for (const wrapper of wrappers) {
      this.eventHandlers.get(event)?.delete(wrapper)
      if (!dispatchedEvents.has(event)) this.socket.off(event, wrapper as never)
    }
    this.subscriptions.get(event)?.delete(original)
    if (!this.eventHandlers.get(event)?.size) this.eventHandlers.delete(event)
    if (!this.subscriptions.get(event)?.size) this.subscriptions.delete(event)
    wrappers.clear()
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

    this.timerEventHandlers.get(eventType)?.add(handler as unknown as (data: unknown) => void)

    return () => this.offTimerEvent(eventType, handler)
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    const handlers = this.timerEventHandlers.get(eventType)
    if (handlers) {
      handlers.delete(handler as unknown as (data: unknown) => void)
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

    this.socket.on('connect_error', error => {
      if (!this.connecting && this.options.autoReconnect && this.isAuthError(error) && this.options.auth?.refreshAuth) {
        // Middleware auth rejection stops Socket.IO's automatic reconnect. Obtain a
        // new server session explicitly; its identity change clears the old room.
        void this.startConnection(true).catch(refreshError => {
          this.updateState({ status: 'disconnected' })
          console.warn('Failed to reconnect session:', refreshError)
        })
      }
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
        this.currentBattleTurn = null
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
      this.trackBattleTurn(message)
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
        this.trackBattleTurn(message)
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
      const snapshots = data.snapshots as TimerSnapshot[] | undefined
      if (snapshots) {
        this.updateTimerSnapshots(snapshots)

        // 触发timerSnapshot事件处理器
        const handlers = this.timerEventHandlers.get('timerSnapshot')
        if (handlers) {
          handlers.forEach(handler => handler(data))
        }
      }
    })

    // 新架构：Timer事件批处理
    this.socket.on('timerEventBatch', events => {
      const batch = events as Array<{ type: string; data: unknown }>
      batch.forEach(event => {
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
      this.currentBattleTurn = data.fullBattleState?.currentTurn ?? null
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
      if (event.type === 'battleStarted' && event.data.battleMode === 'server') {
        this.lastBattleEndEventAt = 0
        this.currentBattleTurn = null
        this.updateState({ matchmaking: 'matched', battle: 'active', roomId: event.data.battleRoomId })
      }
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

  private trackBattleTurn(message: BattleMessage): void {
    if (message.type === BattleMessageType.TurnStart) {
      this.currentBattleTurn = message.data.turn
    }
    const delta = message.stateDelta
    if (delta && typeof delta === 'object' && !Array.isArray(delta) && 'currentTurn' in delta) {
      const change = delta.currentTurn
      if (Array.isArray(change) && (change.length === 1 || change.length === 2)) {
        const turn = change.at(-1)
        if (typeof turn === 'number') this.currentBattleTurn = turn
      }
    }
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

    const directTerminalCodes = new Set(['NOT_IN_BATTLE', 'BATTLE_NOT_FOUND', 'BATTLE_ALREADY_ENDED'])

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
        detailUpper.includes('NOT_IN_BATTLE') ||
        detailUpper.includes('BATTLE_NOT_FOUND') ||
        detailUpper.includes('BATTLE_ALREADY_ENDED') ||
        detailUpper.includes('BATTLE IS NOT ACTIVE')
      if (wrappedTerminal) {
        this.markBattleEnded(`${code}:${details}`)
      }
    }
  }

  private isBattleEndMessageType(messageType: string): boolean {
    return messageType === 'BATTLE_END' || messageType === BattleMessageType.BattleEnd
  }
}
