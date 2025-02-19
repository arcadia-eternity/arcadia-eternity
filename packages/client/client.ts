import { BattleMessage, BattleState } from '@test-battle/const'
import { ClientToServerEvents, ServerToClientEvents } from '@test-battle/protocol'
import { Player, PlayerSelection } from '@test-battle/schema'
import { io, Socket } from 'socket.io-client'

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

type BattleClientOptions = {
  serverUrl: string
  playerDataPath?: string
}

export class BattleClient {
  private socket: ClientSocket
  private roomId?: string
  private opponent?: { id: string; name: string }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private eventHandlers = new Map<string, Set<Function>>()
  private options: BattleClientOptions

  constructor(options: BattleClientOptions) {
    this.options = {
      ...options,
    }

    this.socket = io(this.options.serverUrl, {
      // 使用配置的服务器地址
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    this.setupEventListeners()
  }

  on<T extends keyof ServerToClientEvents>(event: T, handler: ServerToClientEvents[T]) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off<T extends keyof ServerToClientEvents>(event: T, handler: ServerToClientEvents[T]) {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private setupEventListeners() {
    this.socket.on('battleEvent', (message: BattleMessage) => {
      this.emitProxy('battleEvent', message)
    })

    this.socket.on('roomClosed', () => {
      this.roomId = undefined
    })

    this.socket.on('matchmakingError', error => {
      console.error('Matchmaking failed:', error.code, error.details)
    })

    this.socket.on('connect_error', error => {
      console.error('Connection error:', error.message)
    })

    this.socket.on('matchSuccess', response => {
      if (response.status === 'SUCCESS' && response.data) {
        this.roomId = response.data.roomId
        this.opponent = response.data.opponent

        this.emitProxy('matchSuccess', response)
      }
    })

    this.socket.on('ping', () => {
      this.socket.emit('pong')
    })
  }

  private emitProxy<T extends keyof ServerToClientEvents>(event: T, ...args: Parameters<ServerToClientEvents[T]>) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    this.eventHandlers.get(event)?.forEach(handler => (handler as Function)(...args))
  }

  connect() {
    if (!this.socket.connected) {
      this.socket.connect()
    }
  }

  disconnect() {
    if (this.socket.connected) {
      this.socket.disconnect()
    }
  }

  async joinMatchmaking(playerData: Player): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('joinMatchmaking', playerData, response => {
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(new Error(`${response.code}: ${response.details || 'Matchmaking failed'}`))
        }
      })
    })
  }

  async sendPlayerAction(selection: PlayerSelection): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('playerAction', selection, response => {
        if (response.status === 'SUCCESS') {
          resolve()
        } else {
          reject(new Error(`${response.code}: ${response.details || 'Action rejected'}`))
        }
      })
    })
  }

  async getBattleState(): Promise<BattleState> {
    return new Promise((resolve, reject) => {
      this.socket.emit('getState', response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data!)
        } else {
          reject(new Error(`${response.code}: ${response.details || 'Failed to get state'}`))
        }
      })
    })
  }

  async getAvailableSelection(): Promise<PlayerSelection[]> {
    return new Promise((resolve, reject) => {
      this.socket.emit('getAvailableSelection', response => {
        if (response.status === 'SUCCESS') {
          resolve(response.data!)
        } else {
          reject(new Error(`${response.code}: ${response.details || 'Failed to get options'}`))
        }
      })
    })
  }
}
