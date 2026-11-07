import { describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_TIMER_CONFIG,
  BattleMessageType,
  TimerState,
  type BattleMessage,
  type BattleState,
  type PlayerSelection,
} from '@arcadia-eternity/const'
import { InMemoryPeerTransport } from '@/p2p/inMemoryPeerTransport'
import { createP2PHostBattleSystem, P2PPeerBattleSystem } from '@/p2p/p2pBattleSystem'
import { createSandboxWebBattleSession } from '@/services/nativeBattleFactory'
import type { PrivateRoomSignalBridge } from '@/p2p/privateRoomSignalBridge'
vi.mock('@/services/nativeBattleFactory', () => ({ createSandboxWebBattleSession: vi.fn() }))

const DEFAULT_DISABLED_TIMER = {
  config: { ...DEFAULT_TIMER_CONFIG, enabled: false },
  states: [],
}

function createInitPayload(battleState: BattleState, availableSelections: PlayerSelection[]) {
  return {
    viewerId: 'peer',
    battleState,
    availableSelections,
    timer: DEFAULT_DISABLED_TIMER,
  }
}

describe('P2PPeerBattleSystem', () => {
  test('requests sync, accepts init snapshot, and forwards submitAction', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const hostReceived: Array<{ type: string; payload: unknown }> = []
    hostTransport.onMessage(message => hostReceived.push(message))

    const battleState = {
      status: 'On',
      currentTurn: 1,
      currentPhase: 'SELECTION_PHASE',
      players: [],
      sequenceId: 0,
    } as unknown as BattleState
    const selections = [
      {
        player: 'peer',
        type: 'do-nothing',
      },
    ] as unknown as PlayerSelection[]

    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(battleState, selections),
        })
      }
    })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    const statePromise = peerSystem.getState()
    await Promise.resolve()

    expect(hostReceived[0]).toEqual({
      type: 'p2p-battle-sync-request',
      payload: { requesterId: 'peer', lastSeenSequenceId: undefined },
    })

    await expect(statePromise).resolves.toEqual(battleState)
    await expect(peerSystem.getAvailableSelection('peer')).resolves.toEqual(selections)

    const action = {
      player: 'peer',
      type: 'do-nothing',
    } as unknown as PlayerSelection
    await peerSystem.submitAction(action)

    expect(hostReceived[1]).toEqual({
      type: 'p2p-battle-submit-action',
      payload: { selection: action },
    })
  })

  test('emits remote battle events to subscribers', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    const messages: BattleMessage[] = []
    peerSystem.BattleEvent(message => messages.push(message))

    const event = {
      type: 'TurnStart',
      sequenceId: 1,
      data: { turn: 1 },
      stateDelta: {},
    } as unknown as BattleMessage

    await hostTransport.send({
      type: 'p2p-battle-event',
      payload: {
        viewerId: 'peer',
        message: event,
      },
    })
    await Promise.resolve()

    expect(messages).toEqual([event])
  })

  test('hydrates timer state from init snapshot and updates on timer events', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: {
            ...createInitPayload(
              {
                status: 'On',
                currentTurn: 1,
                currentPhase: 'SELECTION_PHASE',
                players: [],
                sequenceId: 1,
              } as unknown as BattleState,
              [],
            ),
            timer: {
              config: {
                ...DEFAULT_TIMER_CONFIG,
                enabled: true,
                turnTimeLimit: 30,
                totalTimeLimit: 1800,
              },
              states: [
                {
                  playerId: 'peer',
                  state: TimerState.Running,
                  remainingTurnTime: 30,
                  remainingTotalTime: 1800,
                  lastUpdateTime: 1,
                },
              ],
            },
          },
        })
      }
    })

    const timeoutEvents: Array<{ player: string; type: 'turn' | 'total' }> = []
    peerSystem.onTimerEvent('timerTimeout', data => {
      timeoutEvents.push({ player: data.player, type: data.type })
    })

    await peerSystem.getState()
    await expect(peerSystem.isTimerEnabled()).resolves.toBe(true)
    await expect(peerSystem.getTimerConfig()).resolves.toEqual(
      expect.objectContaining({ enabled: true, turnTimeLimit: 30, totalTimeLimit: 1800 }),
    )
    await expect(peerSystem.getPlayerTimerState('peer')).resolves.toEqual(
      expect.objectContaining({
        playerId: 'peer',
        state: TimerState.Running,
        remainingTurnTime: 30,
        remainingTotalTime: 1800,
      }),
    )

    await hostTransport.send({
      type: 'p2p-battle-timer-event',
      payload: {
        viewerId: 'peer',
        eventType: 'timerTimeout',
        data: {
          player: 'peer',
          type: 'turn',
        },
      },
    })
    await Promise.resolve()

    expect(timeoutEvents).toEqual([{ player: 'peer', type: 'turn' }])
    await expect(peerSystem.getPlayerTimerState('peer')).resolves.toEqual(
      expect.objectContaining({
        playerId: 'peer',
        state: TimerState.Timeout,
        remainingTurnTime: 0,
      }),
    )
  })

  test('forwards start/end animation to host and resolves remote animation id', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const hostReceived: Array<{ type: string; payload: unknown }> = []
    hostTransport.onMessage(message => {
      hostReceived.push(message)
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(
            {
              status: 'On',
              currentTurn: 1,
              currentPhase: 'SELECTION_PHASE',
              players: [],
              sequenceId: 1,
            } as unknown as BattleState,
            [],
          ),
        })
      }
      if (message.type === 'p2p-battle-start-animation') {
        const payload = message.payload as {
          requestId: string
          source: string
          expectedDuration: number
          ownerId: string
        }
        void hostTransport.send({
          type: 'p2p-battle-start-animation-result',
          payload: {
            viewerId: 'peer',
            requestId: payload.requestId,
            animationId: 'anim_remote_1',
          },
        })
      }
    })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    await peerSystem.ready()
    await expect(peerSystem.startAnimation('skill_xxx', 1200, 'peer')).resolves.toBe('anim_remote_1')
    await peerSystem.endAnimation('anim_remote_1', 1000)

    expect(hostReceived.some(message => message.type === 'p2p-battle-start-animation')).toBe(true)
    expect(
      hostReceived.some(message => {
        if (message.type !== 'p2p-battle-end-animation') {
          return false
        }
        return (message.payload as { animationId: string }).animationId === 'anim_remote_1'
      }),
    ).toBe(true)
  })

  test('requests resync after submitAction when no event arrives', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const hostReceived: Array<{ type: string; payload: unknown }> = []
    hostTransport.onMessage(message => hostReceived.push(message))
    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(
            {
              status: 'On',
              currentTurn: 1,
              currentPhase: 'SELECTION_PHASE',
              players: [],
              sequenceId: 1,
            } as unknown as BattleState,
            [
              {
                player: 'peer',
                type: 'do-nothing',
              },
            ] as unknown as PlayerSelection[],
          ),
        })
      }
    })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    await peerSystem.getState()
    await peerSystem.submitAction({
      player: 'peer',
      type: 'do-nothing',
    } as unknown as PlayerSelection)

    await new Promise(resolve => setTimeout(resolve, 1700))

    expect(hostReceived.some(message => message.type === 'p2p-battle-submit-action')).toBe(true)
    expect(hostReceived.filter(message => message.type === 'p2p-battle-sync-request').length).toBeGreaterThanOrEqual(2)
  })

  test('acks received events and re-syncs with latest sequence after reconnect', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const hostReceived: Array<{ type: string; payload: unknown }> = []
    hostTransport.onMessage(message => hostReceived.push(message))

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(
            {
              status: 'On',
              currentTurn: 2,
              currentPhase: 'SELECTION_PHASE',
              players: [],
              sequenceId: 3,
            } as unknown as BattleState,
            [],
          ),
        })
      }
    })

    await peerSystem.getState()
    await hostTransport.send({
      type: 'p2p-battle-event',
      payload: {
        viewerId: 'peer',
        message: {
          type: 'TurnStart',
          sequenceId: 4,
          data: { turn: 2 },
          stateDelta: {},
        } as unknown as BattleMessage,
      },
    })

    expect(hostReceived.at(-1)).toEqual({
      type: 'p2p-battle-ack',
      payload: { viewerId: 'peer', sequenceId: 4 },
    })

    await peerTransport.close()
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
    await Promise.resolve()

    expect(hostReceived.at(-1)).toEqual({
      type: 'p2p-battle-sync-request',
      payload: { requesterId: 'peer', lastSeenSequenceId: 4 },
    })
  })

  test('retries sync requests until init snapshot arrives', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    let syncRequestCount = 0
    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        syncRequestCount += 1
        if (syncRequestCount === 2) {
          void hostTransport.send({
            type: 'p2p-battle-init',
            payload: createInitPayload(
              {
                status: 'On',
                currentTurn: 3,
                currentPhase: 'SELECTION_PHASE',
                players: [],
                sequenceId: 6,
              } as unknown as BattleState,
              [
                {
                  player: 'peer',
                  type: 'do-nothing',
                },
              ] as unknown as PlayerSelection[],
            ),
          })
        }
      }
    })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    const state = await peerSystem.getState()

    expect(state.sequenceId).toBe(6)
    expect(syncRequestCount).toBeGreaterThanOrEqual(2)
  })

  test('retries resync when init snapshot arrives without selections', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    let syncRequestCount = 0
    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        syncRequestCount += 1
        if (syncRequestCount === 1) {
          void hostTransport.send({
            type: 'p2p-battle-init',
            payload: createInitPayload(
              {
                status: 'On',
                currentTurn: 1,
                currentPhase: 'SELECTION_PHASE',
                players: [],
                sequenceId: 1,
              } as unknown as BattleState,
              [],
            ),
          })
        } else {
          void hostTransport.send({
            type: 'p2p-battle-selection-update',
            payload: {
              viewerId: 'peer',
              availableSelections: [
                {
                  player: 'peer',
                  type: 'do-nothing',
                },
              ] as unknown as PlayerSelection[],
            },
          })
        }
      }
    })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    await peerSystem.getState()
    await new Promise(resolve => setTimeout(resolve, 1200))

    const selections = await peerSystem.getAvailableSelection('peer')
    expect(selections).toHaveLength(1)
    expect(syncRequestCount).toBeGreaterThanOrEqual(2)
  })

  test('emits snapshot update when selections arrive after init snapshot', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    const snapshots: Array<{ battleState: BattleState; availableSelections: PlayerSelection[] }> = []
    peerSystem.onSnapshot(snapshot => snapshots.push(snapshot))

    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(
            {
              status: 'On',
              currentTurn: 1,
              currentPhase: 'SELECTION_PHASE',
              players: [],
              sequenceId: 1,
            } as unknown as BattleState,
            [],
          ),
        })

        queueMicrotask(() => {
          void hostTransport.send({
            type: 'p2p-battle-selection-update',
            payload: {
              viewerId: 'peer',
              availableSelections: [
                {
                  player: 'peer',
                  type: 'do-nothing',
                },
              ] as unknown as PlayerSelection[],
            },
          })
        })
      }
    })

    await peerSystem.getState()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]?.availableSelections).toHaveLength(0)
    expect(snapshots[1]?.availableSelections).toHaveLength(1)
  })

  test('replays missing battle events after resync request', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)

    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

    const hostReceived: Array<{ type: string; payload: unknown }> = []
    hostTransport.onMessage(message => hostReceived.push(message))

    const peerSystem = new P2PPeerBattleSystem(
      'peer',
      {
        transport: peerTransport,
        connect: async () => {},
        close: async () => {},
        sendMessage: async (type, payload) => {
          await peerTransport.send({ type, payload })
        },
        handleSignal: async () => {},
      },
      peerTransport,
    )

    const messages: BattleMessage[] = []
    peerSystem.BattleEvent(message => messages.push(message))

    hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(
            {
              status: 'On',
              currentTurn: 1,
              currentPhase: 'SELECTION_PHASE',
              players: [],
              sequenceId: 1,
            } as unknown as BattleState,
            [],
          ),
        })
        if ((message.payload as { lastSeenSequenceId?: number }).lastSeenSequenceId === 1) {
          void hostTransport.send({
            type: 'p2p-battle-event',
            payload: {
              viewerId: 'peer',
              message: {
                type: 'TurnAction',
                sequenceId: 2,
                data: { player: ['peer'] },
                stateDelta: {},
              } as unknown as BattleMessage,
            },
          })
        }
      }
    })

    await peerSystem.getState()
    await hostTransport.send({
      type: 'p2p-battle-event',
      payload: {
        viewerId: 'peer',
        message: {
          type: 'TurnStart',
          sequenceId: 1,
          data: { turn: 1 },
          stateDelta: {},
        } as unknown as BattleMessage,
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    await peerTransport.close()
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(messages.some(message => message.sequenceId === 2)).toBe(true)
    expect(
      hostReceived.some(message => {
        return (
          message.type === 'p2p-battle-sync-request' &&
          (message.payload as { lastSeenSequenceId?: number }).lastSeenSequenceId === 1
        )
      }),
    ).toBe(true)
  })
})

test('passes host admission cancellation through to the local battle factory', async () => {
  const controller = new AbortController()
  vi.mocked(createSandboxWebBattleSession).mockImplementationOnce(
    (_a, _b, _data, _config, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }),
      ),
  )
  const transport = new InMemoryPeerTransport()
  const options = {
    localPlayerId: 'host',
    remotePlayerId: 'peer',
    localPlayerName: 'Host',
    remotePlayerName: 'Peer',
    localTeam: [],
    remoteTeam: [],
    dataStore: {},
    bridge: {},
    transport,
    signal: controller.signal,
  } as Parameters<typeof createP2PHostBattleSystem>[0]
  const starting = createP2PHostBattleSystem(options)
  expect(vi.mocked(createSandboxWebBattleSession).mock.lastCall?.[4]).toBe(controller.signal)
  controller.abort()
  await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
})

const activeState = (): BattleState =>
  ({
    status: 'On',
    currentTurn: 1,
    currentPhase: 'SELECTION_PHASE',
    players: [],
    sequenceId: 0,
  }) as unknown as BattleState
const availableAction = { player: 'peer', type: 'do-nothing' } as PlayerSelection
function peerEvent(sequenceId: number, terminal = false): BattleMessage {
  return {
    type: terminal ? BattleMessageType.BattleEnd : BattleMessageType.TurnStart,
    sequenceId,
    data: terminal ? { winner: 'host', reason: 'surrender' } : { turn: sequenceId },
    stateDelta: {},
  } as unknown as BattleMessage
}

async function connectedPeer(ack?: (payload: unknown) => Promise<void>) {
  const hostTransport = new InMemoryPeerTransport()
  const peerTransport = new InMemoryPeerTransport()
  hostTransport.pairWith(peerTransport)
  peerTransport.pairWith(hostTransport)
  await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
  await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
  const sendMessage = vi.fn<PrivateRoomSignalBridge['sendMessage']>(async (type, payload) => {
    if (type === 'p2p-battle-ack' && ack) return ack(payload)
    await peerTransport.send({ type, payload })
  })
  const system = new P2PPeerBattleSystem(
    'peer',
    {
      transport: peerTransport,
      connect: async () => {},
      close: async () => {},
      handleSignal: async () => {},
      sendMessage,
    },
    peerTransport,
  )
  return {
    system,
    hostTransport,
    peerTransport,
    sendMessage,
    initialize: (selections: PlayerSelection[] = [availableAction]) =>
      hostTransport.send({
        type: 'p2p-battle-init',
        payload: createInitPayload(activeState(), selections),
      }),
    event: (message: BattleMessage) =>
      hostTransport.send({
        type: 'p2p-battle-event',
        payload: { viewerId: 'peer', message },
      }),
    cleanup: async () => {
      await system.cleanup()
      await hostTransport.close()
      await peerTransport.close()
    },
  }
}

describe('P2P terminal delivery', () => {
  test('delivers events in receive order without waiting for a slow acknowledgment', async () => {
    let releaseAck!: () => void
    const slow = new Promise<void>(resolve => {
      releaseAck = resolve
    })
    const peer = await connectedPeer(payload =>
      (payload as { sequenceId: number }).sequenceId === 1 ? slow : Promise.resolve(),
    )
    const received: BattleMessage[] = []
    peer.system.BattleEvent(message => received.push(message))
    const events = [peerEvent(1), peerEvent(2), peerEvent(3, true)]
    try {
      for (const event of events) await peer.event(event)
      expect(received).toEqual(events)
      releaseAck()
      await Promise.resolve()
      expect(received).toEqual(events)
    } finally {
      releaseAck()
      await peer.cleanup()
    }
  })

  test('delivers the terminal event even when its acknowledgment is rejected', async () => {
    const peer = await connectedPeer(async () => {
      throw new Error('relay room already closed')
    })
    const received: BattleMessage[] = []
    peer.system.BattleEvent(message => received.push(message))
    const events = [peerEvent(1), peerEvent(2, true)]
    try {
      for (const event of events) await peer.event(event)
      await Promise.resolve()
      expect(received).toEqual(events)
    } finally {
      await peer.cleanup()
    }
  })

  test('preserves local subscriber failures instead of treating them as acknowledgment failures', async () => {
    const peer = await connectedPeer()
    const failure = new Error('subscriber failed to apply battle event')
    peer.system.BattleEvent(() => {
      throw failure
    })
    const handler = peer.system as unknown as {
      handleMessage(message: { type: string; payload: unknown }): Promise<void>
    }
    try {
      await expect(
        handler.handleMessage({
          type: 'p2p-battle-event',
          payload: { viewerId: 'peer', message: peerEvent(1) },
        }),
      ).rejects.toBe(failure)
    } finally {
      await peer.cleanup()
    }
  })

  test('clears recovery and selections on terminal delivery and does not send further actions or resync', async () => {
    vi.useFakeTimers()
    const peer = await connectedPeer()
    try {
      await peer.initialize([])
      await peer.system.submitAction(availableAction)
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await peer.event(peerEvent(1, true))
      peer.sendMessage.mockClear()

      await expect(peer.system.getAvailableSelection()).resolves.toEqual([])
      await expect(peer.system.submitAction(availableAction)).rejects.toThrow()
      await peer.hostTransport.send({
        type: 'p2p-battle-selection-update',
        payload: { viewerId: 'peer', availableSelections: [availableAction] },
      })
      await expect(peer.system.getAvailableSelection()).resolves.toEqual([])
      await peer.peerTransport.close()
      await peer.peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(peer.sendMessage).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await peer.cleanup()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  test('uses local animation IDs after terminal delivery without signaling the closed room', async () => {
    const peer = await connectedPeer()
    try {
      await peer.initialize()
      await peer.event(peerEvent(1, true))
      await peer.peerTransport.close()
      peer.sendMessage.mockClear()
      const animationId = await peer.system.startAnimation('victory', 500, 'peer')
      expect(animationId).toEqual(expect.any(String))
      expect(animationId.length).toBeGreaterThan(0)
      await peer.system.endAnimation(animationId, 500)
      await peer.system.endAnimation('old-remote-animation', 100)
      expect(peer.sendMessage).not.toHaveBeenCalled()
    } finally {
      await peer.cleanup()
    }
  })

  test('settles a pending animation start on terminal delivery and clears its timeout', async () => {
    vi.useFakeTimers()
    const peer = await connectedPeer()
    try {
      await peer.initialize()
      const starting = peer.system.startAnimation('last-hit', 300, 'peer')
      const resolved = expect(starting).resolves.toEqual(expect.any(String))
      await Promise.resolve()
      expect(peer.sendMessage.mock.calls.some(([type]) => type === 'p2p-battle-start-animation')).toBe(true)
      await peer.event(peerEvent(1, true))
      await resolved
      const animationId = await starting
      peer.sendMessage.mockClear()
      await peer.system.endAnimation(animationId, 300)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(peer.sendMessage).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await peer.cleanup()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  test('rejects an outstanding initial snapshot wait during cleanup without leaving retry timers', async () => {
    vi.useFakeTimers()
    const peer = await connectedPeer()
    try {
      const waiting = peer.system.getState()
      const rejected = expect(waiting).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(0)
      expect(peer.sendMessage.mock.calls.some(([type]) => type === 'p2p-battle-sync-request')).toBe(true)
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await peer.system.cleanup()
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await peer.cleanup()
      vi.useRealTimers()
    }
  })

  test('accepts an ended initial snapshot while clearing the initialization wait and stale selections', async () => {
    vi.useFakeTimers()
    const peer = await connectedPeer()
    const ended = { ...activeState(), status: 'Ended', sequenceId: 4 } as BattleState
    peer.hostTransport.onMessage(message => {
      if (message.type === 'p2p-battle-sync-request') {
        void peer.hostTransport.send({
          type: 'p2p-battle-init',
          payload: createInitPayload(ended, [availableAction]),
        })
      }
    })
    try {
      await expect(peer.system.getState()).resolves.toEqual(ended)
      await expect(peer.system.getAvailableSelection()).resolves.toEqual([])
      peer.sendMessage.mockClear()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(peer.sendMessage).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await peer.cleanup()
      vi.useRealTimers()
    }
  })

  test('rejects a pending transport wait during cleanup without leaving its timeout', async () => {
    vi.useFakeTimers()
    const peer = await connectedPeer()
    try {
      await peer.peerTransport.close()
      const waiting = peer.system.startAnimation('pending-connect', 100, 'peer')
      const rejected = expect(waiting).rejects.toThrow()
      await Promise.resolve()
      await peer.system.cleanup()
      await rejected
      expect(vi.getTimerCount()).toBe(0)
      expect(peer.sendMessage).not.toHaveBeenCalled()
    } finally {
      await peer.cleanup()
      vi.useRealTimers()
    }
  })

  test('drops a host selection read that completes after the terminal event', async () => {
    const hostTransport = new InMemoryPeerTransport()
    const peerTransport = new InMemoryPeerTransport()
    hostTransport.pairWith(peerTransport)
    peerTransport.pairWith(hostTransport)
    await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
    await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })
    let relay!: (message: BattleMessage) => void
    let finishSelections!: (selections: PlayerSelection[]) => void
    const selections = new Promise<PlayerSelection[]>(resolve => {
      finishSelections = resolve
    })
    const local = {
      BattleEvent: vi.fn((callback: (message: BattleMessage) => void) => {
        relay = callback
        return vi.fn()
      }),
      onTimerEvent: vi.fn(() => vi.fn()),
      getAvailableSelection: vi.fn(() => selections),
      cleanup: vi.fn(async () => {}),
    }
    vi.mocked(createSandboxWebBattleSession).mockResolvedValueOnce({
      system: local,
      data: { species: [], skills: [], marks: [] },
    } as unknown as Awaited<ReturnType<typeof createSandboxWebBattleSession>>)
    const sendMessage = vi.fn<PrivateRoomSignalBridge['sendMessage']>(async (type, payload) =>
      hostTransport.send({ type, payload }),
    )
    const host = await createP2PHostBattleSystem({
      localPlayerId: 'host',
      remotePlayerId: 'peer',
      localPlayerName: 'Host',
      remotePlayerName: 'Peer',
      localTeam: [],
      remoteTeam: [],
      dataStore: {
        species: { allIds: [], byId: {} },
        skills: { allIds: [], byId: {} },
        marks: { allIds: [], byId: {} },
      },
      transport: hostTransport,
      bridge: {
        transport: hostTransport,
        connect: async () => {},
        close: async () => {},
        handleSignal: async () => {},
        sendMessage,
      },
    })
    try {
      relay(peerEvent(1))
      expect(local.getAvailableSelection).toHaveBeenCalledOnce()
      relay(peerEvent(2, true))
      finishSelections([availableAction])
      await Promise.resolve()
      await Promise.resolve()
      expect(sendMessage.mock.calls.filter(([type]) => type === 'p2p-battle-event')).toHaveLength(2)
      expect(sendMessage.mock.calls.some(([type]) => type === 'p2p-battle-selection-update')).toBe(false)
      expect(local.getAvailableSelection).toHaveBeenCalledOnce()
    } finally {
      finishSelections([])
      await host.cleanup()
      await hostTransport.close()
      await peerTransport.close()
    }
  })
})
