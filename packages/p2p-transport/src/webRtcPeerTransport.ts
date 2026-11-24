import { Listeners, PeerTransportEvents } from './peerTransportEvents'
import type {
  PeerTransportConnectOptions,
  PeerTransportMessage,
  PeerTransportSignal,
  SignalingPeerTransport,
} from './peerTransport'

export interface WebRTCPeerTransportOptions {
  localPeerId: string
  config?: RTCConfiguration
  channelLabel?: string
}

export class WebRTCPeerTransport extends PeerTransportEvents implements SignalingPeerTransport {
  readonly name = 'webrtc'

  private readonly signals = new Listeners<PeerTransportSignal>()
  private readonly options: WebRTCPeerTransportOptions

  private peerConnection?: RTCPeerConnection
  private dataChannel?: RTCDataChannel
  private pendingMessages: PeerTransportMessage[] = []

  constructor(options: WebRTCPeerTransportOptions) {
    super()
    this.options = options
  }

  async connect(options: PeerTransportConnectOptions): Promise<void> {
    this.destroyPeerConnection()
    this.setState('connecting')

    const peerConnection = this.createPeerConnection()
    this.peerConnection = peerConnection

    if (options.role === 'host') {
      const dataChannel = peerConnection.createDataChannel(this.options.channelLabel ?? 'arcadia-p2p', {
        ordered: true,
      })
      this.attachDataChannel(dataChannel)
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      this.emitLocalDescription('offer', peerConnection.localDescription)
      return
    }

    peerConnection.ondatachannel = event => {
      this.attachDataChannel(event.channel)
    }
  }

  async handleSignal(signal: PeerTransportSignal): Promise<void> {
    if (!this.peerConnection) {
      this.peerConnection = this.createPeerConnection()
    }

    if (signal.kind === 'offer') {
      await this.peerConnection.setRemoteDescription(this.asSessionDescription(signal.payload))
      const answer = await this.peerConnection.createAnswer()
      await this.peerConnection.setLocalDescription(answer)
      this.emitLocalDescription('answer', this.peerConnection.localDescription)
      return
    }

    if (signal.kind === 'answer') {
      await this.peerConnection.setRemoteDescription(this.asSessionDescription(signal.payload))
      return
    }

    if (signal.kind === 'ice-candidate') {
      const candidate = signal.payload
      if (!candidate) return
      await this.peerConnection.addIceCandidate(this.asIceCandidate(signal.payload))
    }
  }

  async send(message: PeerTransportMessage): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      if (this.getState() === 'idle' || this.getState() === 'connecting') {
        this.pendingMessages.push(message)
        return
      }
      throw new Error('WebRTC data channel is not open')
    }

    this.dataChannel.send(JSON.stringify(message))
  }

  async close(): Promise<void> {
    this.destroyPeerConnection()
    this.setState('closed')
  }

  onLocalSignal(handler: (signal: PeerTransportSignal) => void): () => void {
    return this.signals.subscribe(handler)
  }

  private createPeerConnection(): RTCPeerConnection {
    const peerConnection = new RTCPeerConnection(this.options.config)
    peerConnection.onicecandidate = event => {
      const candidate = event.candidate
      if (!candidate) {
        return
      }
      this.signals.forEach(handler =>
        handler({
          kind: 'ice-candidate',
          payload: candidate.toJSON ? candidate.toJSON() : candidate,
        }),
      )
    }
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
        this.setState('failed')
      }
      if (peerConnection.connectionState === 'closed') {
        this.setState('closed')
      }
    }
    return peerConnection
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    if (this.dataChannel && this.dataChannel !== channel) {
      this.dataChannel.close()
    }

    this.dataChannel = channel

    channel.onopen = () => {
      this.setState('connected')
      this.flushPendingMessages()
    }
    channel.onclose = () => {
      if (this.dataChannel === channel) {
        this.dataChannel = undefined
      }
      this.setState('closed')
    }
    channel.onerror = () => {
      this.setState('failed')
    }
    channel.onmessage = event => {
      this.handleIncomingData(event.data)
    }
  }

  private handleIncomingData(payload: unknown): void {
    if (this.isPeerTransportMessage(payload)) {
      this.messages.emit(payload)
      return
    }

    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as PeerTransportMessage
        this.messages.emit(parsed)
        return
      } catch {
        this.messages.forEach(handler =>
          handler({
            type: 'raw',
            payload,
          }),
        )
        return
      }
    }

    this.messages.forEach(handler =>
      handler({
        type: 'raw',
        payload,
      }),
    )
  }

  private emitLocalDescription(kind: 'offer' | 'answer', description: RTCSessionDescription | null): void {
    if (!description) return
    this.signals.forEach(handler =>
      handler({
        kind,
        payload: description.toJSON ? description.toJSON() : description,
      }),
    )
  }

  private flushPendingMessages(): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return
    }

    for (const message of this.pendingMessages.splice(0)) {
      this.dataChannel.send(JSON.stringify(message))
    }
  }

  private asSessionDescription(payload: unknown): RTCSessionDescriptionInit {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid WebRTC session description payload')
    }
    const candidate = payload as RTCSessionDescriptionInit
    if (typeof candidate.type !== 'string' || typeof candidate.sdp !== 'string') {
      throw new Error('Invalid WebRTC session description payload')
    }
    return candidate
  }

  private asIceCandidate(payload: unknown): RTCIceCandidateInit {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid WebRTC ICE candidate payload')
    }
    return payload as RTCIceCandidateInit
  }

  private isPeerTransportMessage(payload: unknown): payload is PeerTransportMessage {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      typeof (payload as { type: unknown }).type === 'string' &&
      'payload' in payload
    )
  }

  private destroyPeerConnection(): void {
    this.pendingMessages = []
    if (this.dataChannel) {
      this.dataChannel.close()
      this.dataChannel = undefined
    }
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.ondatachannel = null
      this.peerConnection.close()
      this.peerConnection = undefined
    }
  }
}
