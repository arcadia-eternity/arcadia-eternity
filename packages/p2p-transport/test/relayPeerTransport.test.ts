import { describe, expect, it } from 'vitest'
import { createPrivateRoomSignalBridge } from '../src/privateRoomSignalBridge'
import { ServerRelayPeerTransport } from '../src/relayPeerTransport'
import type { PrivateRoomPeerSignalPayload } from '../src/types'

describe('ServerRelayPeerTransport', () => {
  it('forwards custom messages through the signal bridge and becomes connected on ready', async () => {
    const outgoingSignals: PrivateRoomPeerSignalPayload[] = []
    const transport = new ServerRelayPeerTransport()
    const receivedMessages: Array<{ type: string; payload: unknown }> = []
    const states: string[] = []

    transport.onMessage(message => {
      receivedMessages.push(message)
    })
    transport.onStateChange(state => {
      states.push(state)
    })

    const bridge = createPrivateRoomSignalBridge({
      transport,
      signalTransport: 'relay',
      onOutgoingSignal: async signal => {
        outgoingSignals.push(signal)
      },
    })

    await bridge.connect('host', 'peer-1')
    expect(outgoingSignals).toEqual([
      {
        transport: 'relay',
        kind: 'ready',
        payload: { role: 'host', remotePeerId: 'peer-1' },
      },
    ])

    await bridge.handleSignal({
      roomCode: 'ROOM01',
      from: { playerId: 'peer-1', sessionId: 'session-1' },
      to: { playerId: 'host-1', sessionId: 'session-host' },
      signal: {
        transport: 'relay',
        kind: 'ready',
        payload: {},
      },
      timestamp: Date.now(),
    })

    expect(transport.getState()).toBe('connected')
    expect(states).toContain('connected')

    await bridge.sendMessage('relay-battle-event', { step: 1 })
    expect(outgoingSignals.at(-1)).toEqual({
      transport: 'relay',
      kind: 'custom',
      payload: {
        type: 'relay-battle-event',
        payload: { step: 1 },
      },
    })

    await bridge.handleSignal({
      roomCode: 'ROOM01',
      from: { playerId: 'peer-1', sessionId: 'session-1' },
      to: { playerId: 'host-1', sessionId: 'session-host' },
      signal: {
        transport: 'relay',
        kind: 'custom',
        payload: {
          type: 'relay-battle-event',
          payload: { step: 2 },
        },
      },
      timestamp: Date.now(),
    })

    expect(receivedMessages).toEqual([
      {
        type: 'relay-battle-event',
        payload: { step: 2 },
      },
    ])
  })

  it('echoes ready and marks relay transport connected when remote becomes available', async () => {
    const outgoingSignals: PrivateRoomPeerSignalPayload[] = []
    const transport = new ServerRelayPeerTransport()

    const bridge = createPrivateRoomSignalBridge({
      transport,
      signalTransport: 'relay',
      onOutgoingSignal: async signal => {
        outgoingSignals.push(signal)
      },
    })

    await bridge.connect('peer', 'host-1')

    expect(transport.getState()).toBe('connected')
    expect(outgoingSignals).toEqual([
      {
        transport: 'relay',
        kind: 'ready',
        payload: { role: 'peer', remotePeerId: 'host-1' },
      },
    ])

    await bridge.handleSignal({
      roomCode: 'ROOM01',
      from: { playerId: 'host-1', sessionId: 'session-host' },
      to: { playerId: 'peer-1', sessionId: 'session-peer' },
      signal: {
        transport: 'relay',
        kind: 'ready',
        payload: { role: 'host', remotePeerId: 'peer-1' },
      },
      timestamp: Date.now(),
    })

    expect(transport.getState()).toBe('connected')
    expect(outgoingSignals).toEqual([{
      transport: 'relay',
      kind: 'ready',
      payload: { role: 'peer', remotePeerId: 'host-1' },
    }])
  })
})
