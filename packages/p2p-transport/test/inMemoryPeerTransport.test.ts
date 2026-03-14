import { describe, expect, test } from 'vitest'
import { InMemoryPeerTransport } from '../src/inMemoryPeerTransport'
import { createPrivateRoomSignalBridge } from '../src/privateRoomSignalBridge'

describe('InMemoryPeerTransport', () => {
  test('connects paired transports and forwards messages', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    const received: Array<{ type: string; payload: unknown }> = []
    peerTransport.onMessage(message => received.push(message))

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
    await hostTransport.send({ type: 'battle-action', payload: { action: 'use-skill' } })

    expect(hostTransport.getState()).toBe('connected')
    expect(peerTransport.getState()).toBe('connected')
    expect(received).toEqual([{ type: 'battle-action', payload: { action: 'use-skill' } }])
  })

  test('signal bridge emits ready signal on connect', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    const emittedSignals: unknown[] = []
    const bridge = createPrivateRoomSignalBridge({
      transport: hostTransport,
      onOutgoingSignal: async signal => {
        emittedSignals.push(signal)
      },
    })

    await bridge.connect('host', 'peer')

    expect(emittedSignals).toEqual([
      {
        transport: 'webrtc',
        kind: 'ready',
        payload: {
          role: 'host',
          remotePeerId: 'peer',
        },
      },
    ])
  })
})
