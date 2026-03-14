import type {
  PeerTransportConnectOptions,
  PeerTransportMessage,
  PeerTransportSignal,
  PeerTransportState,
  SignalingPeerTransport,
} from './peerTransport'

type MessageHandler = (message: PeerTransportMessage) => void
type StateHandler = (state: PeerTransportState) => void

export class InMemoryPeerTransport implements SignalingPeerTransport {
  readonly name = 'in-memory'

  private state: PeerTransportState = 'idle'
  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly stateHandlers = new Set<StateHandler>()
  private readonly signalHandlers = new Set<(signal: PeerTransportSignal) => void>()
  private peer?: InMemoryPeerTransport
  private remotePeerId?: string

  pairWith(peer: InMemoryPeerTransport): void {
    this.peer = peer
  }

  getState(): PeerTransportState {
    return this.state
  }

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.remotePeerId = options.remotePeerId
    this.setState('connecting')
    if (!this.peer) {
      this.setState('failed')
      throw new Error('InMemoryPeerTransport peer is not paired')
    }
    this.setState('connected')
  }

  async send(message: PeerTransportMessage): Promise<void> {
    if (this.state !== 'connected' || !this.peer) {
      throw new Error('Peer transport is not connected')
    }

    this.peer.dispatchMessage(message)
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

  onLocalSignal(handler: (signal: PeerTransportSignal) => void): () => void {
    this.signalHandlers.add(handler)
    return () => this.signalHandlers.delete(handler)
  }

  async handleSignal(_signal: PeerTransportSignal): Promise<void> {
    // in-memory transport does not require external signaling
  }

  private dispatchMessage(message: PeerTransportMessage): void {
    this.messageHandlers.forEach(handler => handler(message))
  }

  private setState(nextState: PeerTransportState): void {
    this.state = nextState
    this.stateHandlers.forEach(handler => handler(nextState))
  }
}
