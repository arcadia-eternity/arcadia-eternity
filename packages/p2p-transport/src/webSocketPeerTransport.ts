import { PeerTransportEvents } from './peerTransportEvents'
import { webSocketText } from './webSocketData'
import WebSocket from 'ws'
import type {
  PeerTransportConnectOptions,
  PeerTransportMessage,
  PeerTransportSignal,
  SignalingPeerTransport,
} from './peerTransport'

export interface WebSocketPeerTransportOptions {
  url: string
  roomId: string
  peerId: string
}

export class WebSocketPeerTransport extends PeerTransportEvents implements SignalingPeerTransport {
  readonly name = 'websocket'

  private readonly url: string
  private readonly roomId: string
  private readonly peerId: string
  private remotePeerId?: string
  private socket?: WebSocket

  constructor(options: WebSocketPeerTransportOptions) {
    super()
    this.url = options.url
    this.roomId = options.roomId
    this.peerId = options.peerId
  }

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.remotePeerId = options.remotePeerId
    this.setState('connecting')

    const wsUrl = new URL(this.url)
    wsUrl.searchParams.set('roomId', this.roomId)
    wsUrl.searchParams.set('peerId', this.peerId)

    this.socket = new WebSocket(wsUrl)
    this.socket.on('message', data => {
      const raw = webSocketText(data)
      const parsed = JSON.parse(raw) as PeerTransportMessage
      this.messages.emit(parsed)
    })
    this.socket.on('error', () => {
      this.setState('failed')
    })
    this.socket.on('close', () => {
      if (this.getState() !== 'failed') {
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

  onLocalSignal(_handler: (signal: PeerTransportSignal) => void): () => void {
    void _handler
    return () => {}
  }

  async handleSignal(_signal: PeerTransportSignal): Promise<void> {
    void _signal
    // websocket transport is directly connected and does not require signaling
  }
}
