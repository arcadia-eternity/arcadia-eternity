import WebSocket from 'ws'
import type {
  PeerTransportConnectOptions,
  PeerTransportMessage,
  PeerTransportSignal,
  PeerTransportState,
  SignalingPeerTransport,
} from './peerTransport'

type MessageHandler = (message: PeerTransportMessage) => void
type StateHandler = (state: PeerTransportState) => void

export interface WebSocketPeerTransportOptions {
  url: string
  roomId: string
  peerId: string
}

export class WebSocketPeerTransport implements SignalingPeerTransport {
  readonly name = 'websocket'

  private readonly url: string
  private readonly roomId: string
  private readonly peerId: string
  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly stateHandlers = new Set<StateHandler>()
  private state: PeerTransportState = 'idle'
  private remotePeerId?: string
  private socket?: WebSocket

  constructor(options: WebSocketPeerTransportOptions) {
    this.url = options.url
    this.roomId = options.roomId
    this.peerId = options.peerId
  }

  getState(): PeerTransportState {
    return this.state
  }

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.remotePeerId = options.remotePeerId
    this.setState('connecting')

    const wsUrl = new URL(this.url)
    wsUrl.searchParams.set('roomId', this.roomId)
    wsUrl.searchParams.set('peerId', this.peerId)

    this.socket = new WebSocket(wsUrl)
    this.socket.on('message', data => {
      const raw = typeof data === 'string' ? data : data.toString()
      const parsed = JSON.parse(raw) as PeerTransportMessage
      this.messageHandlers.forEach(handler => handler(parsed))
    })
    this.socket.on('error', () => {
      this.setState('failed')
    })
    this.socket.on('close', () => {
      if (this.state !== 'failed') {
        this.setState('closed')
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.socket!.once('open', () => {
        this.setState('connected')
        resolve()
      })
      this.socket!.once('error', error => reject(error))
    })
  }

  async send(message: PeerTransportMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket peer transport is not connected')
    }
    this.socket.send(JSON.stringify({ to: this.remotePeerId, message }))
  }

  async close(): Promise<void> {
    if (!this.socket) return
    await new Promise<void>(resolve => {
      const socket = this.socket!
      socket.once('close', () => resolve())
      socket.close()
    })
    this.socket = undefined
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  onLocalSignal(_handler: (signal: PeerTransportSignal) => void): () => void {
    return () => {}
  }

  async handleSignal(_signal: PeerTransportSignal): Promise<void> {
    // websocket transport is directly connected and does not require signaling
  }

  private setState(nextState: PeerTransportState): void {
    this.state = nextState
    this.stateHandlers.forEach(handler => handler(nextState))
  }
}
