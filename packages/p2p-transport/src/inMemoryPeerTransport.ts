import { Listeners, PeerTransportEvents } from './peerTransportEvents'
import type {
  PeerTransportConnectOptions,
  PeerTransportMessage,
  PeerTransportSignal,
  SignalingPeerTransport,
} from './peerTransport'

export class InMemoryPeerTransport extends PeerTransportEvents implements SignalingPeerTransport {
  readonly name = 'in-memory'

  private readonly signals = new Listeners<PeerTransportSignal>()
  private peer?: InMemoryPeerTransport

  pairWith(peer: InMemoryPeerTransport): void {
    this.peer = peer
  }

  async connect(_options: PeerTransportConnectOptions): Promise<void> {
    this.setState('connecting')
    if (!this.peer) {
      this.setState('failed')
      throw new Error('InMemoryPeerTransport peer is not paired')
    }
    this.setState('connected')
  }

  async send(message: PeerTransportMessage): Promise<void> {
    if (this.getState() !== 'connected' || !this.peer) {
      throw new Error('Peer transport is not connected')
    }

    this.peer.messages.emit(message)
  }

  async close(): Promise<void> {
    this.setState('closed')
  }

  onLocalSignal(handler: (signal: PeerTransportSignal) => void): () => void {
    return this.signals.subscribe(handler)
  }

  async handleSignal(_signal: PeerTransportSignal): Promise<void> {
    void _signal
    // in-memory transport does not require external signaling
  }
}
