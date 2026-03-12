import type { PeerTransport, PeerTransportConnectOptions, PeerTransportMessage, PeerTransportState } from './peerTransport'

type MessageHandler = (message: PeerTransportMessage) => void
type StateHandler = (state: PeerTransportState) => void

export interface RelayPeerTransport extends PeerTransport {
  receiveRelayMessage(message: PeerTransportMessage): void
  markConnected(): void
}

export class ServerRelayPeerTransport implements RelayPeerTransport {
  readonly name = 'relay'

  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly stateHandlers = new Set<StateHandler>()
  private state: PeerTransportState = 'idle'
  private remotePeerId?: string

  getState(): PeerTransportState {
    return this.state
  }

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.remotePeerId = options.remotePeerId
    this.setState('connecting')
    this.setState('connected')
  }

  async send(_message: PeerTransportMessage): Promise<void> {
    throw new Error('ServerRelayPeerTransport.send should be routed through PrivateRoomSignalBridge')
  }

  async close(): Promise<void> {
    this.setState('closed')
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  receiveRelayMessage(message: PeerTransportMessage): void {
    this.messageHandlers.forEach(handler => handler(message))
  }

  markConnected(): void {
    if (!this.remotePeerId) {
      this.setState('failed')
      return
    }
    this.setState('connected')
  }

  private setState(nextState: PeerTransportState): void {
    this.state = nextState
    this.stateHandlers.forEach(handler => handler(nextState))
  }
}
