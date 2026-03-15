import type { PrivateRoomPeerSignalEvent, PrivateRoomPeerSignalPayload } from './types'
import type { PeerTransport, PeerTransportMessage, SignalingPeerTransport } from './peerTransport'
import type { RelayPeerTransport } from './relayPeerTransport'

export interface PrivateRoomSignalBridge {
  transport: PeerTransport
  connect(role: 'host' | 'peer', remotePeerId: string): Promise<void>
  sendMessage(type: string, payload: unknown): Promise<void>
  handleSignal(event: PrivateRoomPeerSignalEvent): Promise<void>
  close(): Promise<void>
}

export interface PrivateRoomSignalBridgeOptions {
  transport: PeerTransport
  signalTransport?: PrivateRoomPeerSignalPayload['transport']
  onOutgoingSignal: (signal: PrivateRoomPeerSignalPayload) => Promise<void>
}

function isSignalingPeerTransport(transport: PeerTransport): transport is SignalingPeerTransport {
  return 'onLocalSignal' in transport && 'handleSignal' in transport
}

function isRelayPeerTransport(transport: PeerTransport): transport is RelayPeerTransport {
  return 'receiveRelayMessage' in transport && 'markConnected' in transport
}

export function createPrivateRoomSignalBridge(
  options: PrivateRoomSignalBridgeOptions,
): PrivateRoomSignalBridge {
  const { transport, onOutgoingSignal, signalTransport = 'webrtc' } = options
  let connectedOnce = false
  let currentRole: 'host' | 'peer' | null = null
  let currentRemotePeerId: string | null = null

  transport.onStateChange(state => {
    if (state === 'connected') {
      connectedOnce = true
    }
  })

  if (isSignalingPeerTransport(transport)) {
    transport.onLocalSignal(signal => {
      void onOutgoingSignal({
        transport: signalTransport,
        kind: signal.kind,
        payload: signal.payload,
      })
    })
  }

  return {
    transport,
    async connect(role, remotePeerId) {
      currentRole = role
      currentRemotePeerId = remotePeerId
      await transport.connect({ role, remotePeerId })
      await onOutgoingSignal({
        transport: signalTransport,
        kind: 'ready',
        payload: { role, remotePeerId },
      })
    },
    async sendMessage(type, payload) {
      const message: PeerTransportMessage = { type, payload }
      if (isRelayPeerTransport(transport)) {
        await onOutgoingSignal({
          transport: signalTransport,
          kind: 'custom',
          payload: message,
        })
        return
      }
      await transport.send(message)
    },
    async handleSignal(event) {
      if (event.signal.kind === 'ready') {
        if (isRelayPeerTransport(transport)) {
          const shouldEchoReady = transport.getState() !== 'connected'
          transport.markConnected()
          if (shouldEchoReady) {
            await onOutgoingSignal({
              transport: signalTransport,
              kind: 'ready',
              payload: event.signal.payload,
            })
          }
        }
        if (
          isSignalingPeerTransport(transport) &&
          currentRole === 'host' &&
          currentRemotePeerId &&
          connectedOnce
        ) {
          await transport.connect({ role: 'host', remotePeerId: currentRemotePeerId })
        }
        return
      }

      if (event.signal.kind === 'custom') {
        if (isRelayPeerTransport(transport)) {
          transport.receiveRelayMessage(event.signal.payload as PeerTransportMessage)
        }
        return
      }

      if (
        isSignalingPeerTransport(transport) &&
        (event.signal.kind === 'offer' ||
          event.signal.kind === 'answer' ||
          event.signal.kind === 'ice-candidate')
      ) {
        await (transport as SignalingPeerTransport).handleSignal({
          kind: event.signal.kind,
          payload: event.signal.payload,
        })
      }
    },
    async close() {
      await transport.close()
    },
  }
}
