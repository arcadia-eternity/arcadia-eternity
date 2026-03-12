import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WebRTCPeerTransport } from '../src/webRtcPeerTransport'

class FakeRTCDataChannel {
  readyState: RTCDataChannelState = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  counterpart?: FakeRTCDataChannel
  sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
    this.counterpart?.onmessage?.({ data } as MessageEvent)
  }

  close(): void {
    this.readyState = 'closed'
    this.onclose?.()
  }

  open(): void {
    this.readyState = 'open'
    this.onopen?.()
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = []
  static hostChannel?: FakeRTCDataChannel

  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null
  readonly role: 'host' | 'peer'
  addedCandidates: RTCIceCandidateInit[] = []
  closed = false

  constructor() {
    this.role = FakeRTCPeerConnection.instances.length === 0 ? 'host' : 'peer'
    FakeRTCPeerConnection.instances.push(this)
  }

  createDataChannel(): RTCDataChannel {
    const channel = new FakeRTCDataChannel()
    FakeRTCPeerConnection.hostChannel = channel
    return channel as unknown as RTCDataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = {
      ...description,
      toJSON: () => description,
    } as RTCSessionDescription
    this.onicecandidate?.({
      candidate: {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
        toJSON() {
          return {
            candidate: 'candidate:1',
            sdpMid: '0',
            sdpMLineIndex: 0,
          }
        },
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent)
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = {
      ...description,
      toJSON: () => description,
    } as RTCSessionDescription

    if (description.type === 'offer' && this.role === 'peer') {
      const peerChannel = new FakeRTCDataChannel()
      const hostChannel = FakeRTCPeerConnection.hostChannel
      if (hostChannel) {
        hostChannel.counterpart = peerChannel
        peerChannel.counterpart = hostChannel
        this.ondatachannel?.({ channel: peerChannel as unknown as RTCDataChannel } as RTCDataChannelEvent)
        hostChannel.open()
        peerChannel.open()
      }
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate)
  }

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }
}

describe('WebRTCPeerTransport', () => {
  beforeEach(() => {
    FakeRTCPeerConnection.instances = []
    FakeRTCPeerConnection.hostChannel = undefined
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('host emits offer and peer answers through signaling', async () => {
    const host = new WebRTCPeerTransport({ localPeerId: 'host' })
    const peer = new WebRTCPeerTransport({ localPeerId: 'peer' })
    const hostSignals: Array<{ kind: string; payload: unknown }> = []
    const peerSignals: Array<{ kind: string; payload: unknown }> = []

    host.onLocalSignal(signal => hostSignals.push(signal))
    peer.onLocalSignal(signal => peerSignals.push(signal))

    await host.connect({ role: 'host', remotePeerId: 'peer' })
    await peer.connect({ role: 'peer', remotePeerId: 'host' })

    const offer = hostSignals.find(signal => signal.kind === 'offer')
    expect(offer).toBeTruthy()

    await peer.handleSignal(offer!)
    const answer = peerSignals.find(signal => signal.kind === 'answer')
    expect(answer).toBeTruthy()

    await host.handleSignal(answer!)

    expect(host.getState()).toBe('connected')
    expect(peer.getState()).toBe('connected')
  })

  test('messages flow over the data channel after signaling completes', async () => {
    const host = new WebRTCPeerTransport({ localPeerId: 'host' })
    const peer = new WebRTCPeerTransport({ localPeerId: 'peer' })
    const received: Array<{ type: string; payload: unknown }> = []
    const hostSignals: Array<{ kind: string; payload: unknown }> = []
    const peerSignals: Array<{ kind: string; payload: unknown }> = []

    host.onLocalSignal(signal => hostSignals.push(signal))
    peer.onLocalSignal(signal => peerSignals.push(signal))
    peer.onMessage(message => received.push(message))

    await host.connect({ role: 'host', remotePeerId: 'peer' })
    await peer.connect({ role: 'peer', remotePeerId: 'host' })
    await peer.handleSignal(hostSignals.find(signal => signal.kind === 'offer')!)
    await host.handleSignal(peerSignals.find(signal => signal.kind === 'answer')!)

    await host.send({ type: 'battle-event', payload: { sequenceId: 1 } })

    expect(received).toEqual([{ type: 'battle-event', payload: { sequenceId: 1 } }])

    await host.close()
    await peer.close()
  })

  test('messages queued before data channel open are flushed after signaling completes', async () => {
    const host = new WebRTCPeerTransport({ localPeerId: 'host' })
    const peer = new WebRTCPeerTransport({ localPeerId: 'peer' })
    const received: Array<{ type: string; payload: unknown }> = []
    const hostSignals: Array<{ kind: string; payload: unknown }> = []
    const peerSignals: Array<{ kind: string; payload: unknown }> = []

    host.onLocalSignal(signal => hostSignals.push(signal))
    peer.onLocalSignal(signal => peerSignals.push(signal))
    peer.onMessage(message => received.push(message))

    await host.connect({ role: 'host', remotePeerId: 'peer' })
    await host.send({ type: 'queued-event', payload: { sequenceId: 7 } })
    await peer.connect({ role: 'peer', remotePeerId: 'host' })
    await peer.handleSignal(hostSignals.find(signal => signal.kind === 'offer')!)
    await host.handleSignal(peerSignals.find(signal => signal.kind === 'answer')!)

    expect(received).toEqual([{ type: 'queued-event', payload: { sequenceId: 7 } }])

    await host.close()
    await peer.close()
  })
})
