import { describe, expect, test } from 'vitest'
import {
  DEFAULT_TIMER_CONFIG,
  TimerState,
  type BattleMessage,
  type BattleState,
  type PlayerSelection,
} from '@arcadia-eternity/const'
import { InMemoryPeerTransport } from '@/p2p/inMemoryPeerTransport'
import { P2PPeerBattleSystem } from '@/p2p/p2pBattleSystem'

const DEFAULT_DISABLED_TIMER = {
  config: { ...DEFAULT_TIMER_CONFIG, enabled: false },
  states: [],
}

function createInitPayload(
  battleState: BattleState,
  availableSelections: PlayerSelection[],
) {
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
    expect(hostReceived.some(message => {
      if (message.type !== 'p2p-battle-end-animation') {
        return false
      }
      return (message.payload as { animationId: string }).animationId === 'anim_remote_1'
    })).toBe(true)
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
    expect(hostReceived.some(message => {
      return (
        message.type === 'p2p-battle-sync-request' &&
        (message.payload as { lastSeenSequenceId?: number }).lastSeenSequenceId === 1
      )
    })).toBe(true)
  })
})
