export type PeerTransportState = 'idle' | 'connecting' | 'connected' | 'closed' | 'failed'

export interface PeerTransportMessage {
  type: string
  payload: unknown
}

export interface PeerTransportConnectOptions {
  role: 'host' | 'peer'
  remotePeerId: string
}

export interface PeerTransport {
  readonly name: string
  getState(): PeerTransportState
  connect(options: PeerTransportConnectOptions): Promise<void>
  send(message: PeerTransportMessage): Promise<void>
  close(): Promise<void>
  onMessage(handler: (message: PeerTransportMessage) => void): () => void
  onStateChange(handler: (state: PeerTransportState) => void): () => void
}

export interface PeerTransportSignal {
  kind: 'offer' | 'answer' | 'ice-candidate'
  payload: unknown
}

export interface SignalingPeerTransport extends PeerTransport {
  onLocalSignal(handler: (signal: PeerTransportSignal) => void): () => void
  handleSignal(signal: PeerTransportSignal): Promise<void>
}
