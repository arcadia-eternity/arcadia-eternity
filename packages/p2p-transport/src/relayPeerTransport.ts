import { PeerTransportEvents } from './peerTransportEvents'
import type { PeerTransport, PeerTransportConnectOptions, PeerTransportMessage } from './peerTransport'

export interface RelayPeerTransport extends PeerTransport {
  receiveRelayMessage(message: PeerTransportMessage): void
  markConnected(): void
}

export class ServerRelayPeerTransport extends PeerTransportEvents implements RelayPeerTransport {
  readonly name = 'relay'

  private remotePeerId?: string

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.remotePeerId = options.remotePeerId
    this.setState('connecting')
    this.setState('connected')
  }

  async send(_message: PeerTransportMessage): Promise<void> {
    void _message
    throw new Error('ServerRelayPeerTransport.send should be routed through PrivateRoomSignalBridge')
  }

  async close(): Promise<void> {
    this.setState('closed')
  }

  receiveRelayMessage(message: PeerTransportMessage): void {
    this.messages.emit(message)
  }

  markConnected(): void {
    if (!this.remotePeerId) {
      this.setState('failed')
      return
    }
    this.setState('connected')
  }
}
