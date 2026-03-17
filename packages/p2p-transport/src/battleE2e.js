import { LocalBattleSystemV2 } from '../../battle/src/v2/local-battle.js'
import { createLocalBattleFromYAML } from '../../battle/src/v2/data/battle-factory-node.js'
import { InMemoryPeerTransport } from './inMemoryPeerTransport'

function debugLog(...args) {
  if (process.env.P2P_BATTLE_E2E_DEBUG === '1') {
    console.log('[p2p-battle-e2e]', ...args)
  }
}

function isP2PBattleMessage(value) {
  if (!value || typeof value !== 'object') return false
  return typeof value.type === 'string' && 'payload' in value
}

function chooseSelection(selections) {
  return (
    selections.find(selection => selection.type === 'use-skill') ??
    selections.find(selection => selection.type === 'switch-pet') ??
    selections.find(selection => selection.type === 'do-nothing') ??
    selections.find(selection => selection.type === 'surrender') ??
    null
  )
}

const NEXT_ACTION_EVENT_TYPES = new Set(['TURN_ACTION', 'FORCED_SWITCH', 'FAINT_SWITCH', 'TEAM_SELECTION_START'])

async function waitFor(fn, predicate, timeoutMs = 3000) {
  const startedAt = Date.now()
  while (true) {
    const value = await fn()
    if (predicate(value)) return value
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for battle state to advance')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

class PeerBattleProxy {
  constructor(localPlayerId, transport) {
    this.localPlayerId = localPlayerId
    this.transport = transport
    this.battleState = null
    this.availableSelections = []
    this.events = []
    this.initWaiters = []
    this.syncInflight = null
    this.offMessage = this.transport.onMessage(message => {
      void this.handleMessage(message)
    })
  }

  async ready() {
    await this.ensureInitialized()
  }

  async getState() {
    await this.ensureInitialized()
    if (!this.battleState) throw new Error('Peer battle state not initialized')
    return this.battleState
  }

  async getAvailableSelection() {
    await this.ensureInitialized()
    return this.availableSelections
  }

  async submitAction(selection) {
    await this.transport.send({
      type: 'p2p-battle-submit-action',
      payload: { selection },
    })
  }

  getEvents() {
    return [...this.events]
  }

  async cleanup() {
    this.offMessage()
  }

  async ensureInitialized() {
    if (this.battleState) return
    if (this.syncInflight) {
      await this.syncInflight
      return
    }

    this.syncInflight = (async () => {
      const initPromise = new Promise(resolve => {
        this.initWaiters.push(resolve)
      })
      debugLog('peer -> sync-request')
      await this.transport.send({
        type: 'p2p-battle-sync-request',
        payload: { requesterId: this.localPlayerId },
      })
      if (this.battleState) {
        for (const resolve of this.initWaiters.splice(0)) {
          resolve(this.battleState)
        }
      }
      await initPromise
    })()

    try {
      await this.syncInflight
    } finally {
      this.syncInflight = null
    }
  }

  async handleMessage(message) {
    if (!isP2PBattleMessage(message)) return
    if ('viewerId' in message.payload && message.payload.viewerId !== this.localPlayerId) return

    if (message.type === 'p2p-battle-init') {
      debugLog('peer <- init', {
        currentTurn: message.payload.battleState.currentTurn,
        currentPhase: message.payload.battleState.currentPhase,
        selectionCount: message.payload.availableSelections.length,
      })
      this.battleState = message.payload.battleState
      this.availableSelections = message.payload.availableSelections
      for (const resolve of this.initWaiters.splice(0)) {
        resolve(this.battleState)
      }
      return
    }

    if (message.type === 'p2p-battle-selection-update') {
      debugLog('peer <- selection-update', message.payload.availableSelections.length)
      this.availableSelections = message.payload.availableSelections
      return
    }

    if (message.type === 'p2p-battle-event') {
      debugLog('peer <- event', message.payload.message.type, message.payload.message.sequenceId)
      this.events.push(message.payload.message)
    }
  }
}

class HostBattleRelay {
  constructor(battleSystem, remotePlayerId, transport) {
    this.battleSystem = battleSystem
    this.remotePlayerId = remotePlayerId
    this.transport = transport
    this.remoteEvents = []

    this.offTransportMessage = this.transport.onMessage(message => {
      void this.handleTransportMessage(message)
    })
    this.offBattleEvent = this.battleSystem.BattleEvent(
      message => {
        this.remoteEvents.push(message)
        void this.transport.send({
          type: 'p2p-battle-event',
          payload: {
            viewerId: this.remotePlayerId,
            message,
          },
        })
        void this.pushRemoteSelections()
      },
      { viewerId: this.remotePlayerId, showHidden: false },
    )
  }

  async ready() {
    debugLog('host ready')
    await this.battleSystem.ready()
    await this.pushRemoteSelections()
  }

  getRemoteEvents() {
    return [...this.remoteEvents]
  }

  async cleanup() {
    this.offTransportMessage()
    this.offBattleEvent()
    this.transport.close().catch(() => {})
    if (typeof this.battleSystem.cleanup === 'function') {
      await this.battleSystem.cleanup()
    }
  }

  async handleTransportMessage(message) {
    if (!isP2PBattleMessage(message)) return

    if (message.type === 'p2p-battle-sync-request') {
      debugLog('host <- sync-request')
      const battleState = await this.battleSystem.getState(this.remotePlayerId, false)
      const availableSelections = await this.battleSystem.getAvailableSelection(this.remotePlayerId)
      await this.transport.send({
        type: 'p2p-battle-init',
        payload: {
          viewerId: this.remotePlayerId,
          battleState,
          availableSelections,
        },
      })
      return
    }

    if (message.type === 'p2p-battle-submit-action') {
      debugLog('host <- submit-action', message.payload.selection.type)
      await this.battleSystem.submitAction(message.payload.selection)
    }
  }

  async pushRemoteSelections() {
    const availableSelections = await this.battleSystem.getAvailableSelection(this.remotePlayerId)
    debugLog('host -> selection-update', availableSelections.length)
    await this.transport.send({
      type: 'p2p-battle-selection-update',
      payload: {
        viewerId: this.remotePlayerId,
        availableSelections,
      },
    })
  }
}

export async function runInMemoryP2PBattleE2E(options) {
  const packRef = options.packRef ?? 'builtin:workspace'
  const maxRounds = options.rounds ?? 2
  const peerActionMode = options.peerActionMode ?? 'normal'
  if (!Number.isFinite(maxRounds) || maxRounds <= 0) {
    throw new Error(`Invalid rounds: ${maxRounds}`)
  }
  if (peerActionMode !== 'normal' && peerActionMode !== 'skip') {
    throw new Error(`Invalid peerActionMode: ${peerActionMode}`)
  }

  const battleSystem = await createLocalBattleFromYAML(packRef, options.playerATeam, options.playerBTeam, {
    allowFaintSwitch: true,
    showHidden: false,
    ...options.battleConfig,
  })

  const initialState = await battleSystem.getState(undefined, true)
  debugLog('battle created', {
    playerAId: initialState.players[0]?.id,
    playerBId: initialState.players[1]?.id,
    currentTurn: initialState.currentTurn,
    currentPhase: initialState.currentPhase,
  })
  const playerAId = initialState.players[0]?.id
  const playerBId = initialState.players[1]?.id
  if (!playerAId || !playerBId) {
    throw new Error('Failed to resolve battle player IDs')
  }

  const hostTransport = new InMemoryPeerTransport()
  const peerTransport = new InMemoryPeerTransport()
  hostTransport.pairWith(peerTransport)
  peerTransport.pairWith(hostTransport)
  await hostTransport.connect({ role: 'host', remotePeerId: playerBId })
  await peerTransport.connect({ role: 'peer', remotePeerId: playerAId })

  const hostRelay = new HostBattleRelay(battleSystem, playerBId, hostTransport)
  const peerProxy = new PeerBattleProxy(playerBId, peerTransport)

  try {
    await hostRelay.ready()
    await peerProxy.ready()
    debugLog('both sides ready')

    let roundsPlayed = 0
    let finalState = await battleSystem.getState(undefined, true)
    let playerASelections = await battleSystem.getAvailableSelection(playerAId)
    let playerBSelections = await peerProxy.getAvailableSelection()

    while (roundsPlayed < maxRounds && finalState.status !== 'Ended') {
      const actionA = chooseSelection(playerASelections)
      const actionB = chooseSelection(playerBSelections)
      const shouldSubmitPeerAction = peerActionMode === 'normal'
      debugLog('round selections', {
        roundsPlayed,
        actionA: actionA?.type,
        actionB: actionB?.type,
        shouldSubmitPeerAction,
        currentTurn: finalState.currentTurn,
        currentPhase: finalState.currentPhase,
        sequenceId: finalState.sequenceId,
      })
      if (!actionA) break
      if (shouldSubmitPeerAction && !actionB) break

      const previousPeerEventCount = peerProxy.getEvents().length
      await battleSystem.submitAction(actionA)
      if (shouldSubmitPeerAction && actionB) {
        await peerProxy.submitAction(actionB)
      }

      const advanced = await waitFor(
        async () => {
          const state = await battleSystem.getState(undefined, true)
          const peerEvents = peerProxy.getEvents()
          const lastPeerEvent = peerEvents.at(-1)?.type ?? null
          return { state, peerEventCount: peerEvents.length, lastPeerEvent }
        },
        snapshot =>
          snapshot.state.status === 'Ended' ||
          (snapshot.peerEventCount > previousPeerEventCount && NEXT_ACTION_EVENT_TYPES.has(snapshot.lastPeerEvent)),
      )
      finalState = advanced.state

      roundsPlayed += 1
      debugLog('round advanced', {
        roundsPlayed,
        currentTurn: finalState.currentTurn,
        currentPhase: finalState.currentPhase,
        sequenceId: finalState.sequenceId,
        status: finalState.status,
      })
      if (finalState.status === 'Ended') break

      playerASelections = await battleSystem.getAvailableSelection(playerAId)
      playerBSelections = await peerProxy.getAvailableSelection()
    }

    return {
      playerAId,
      playerBId,
      roundsPlayed,
      finalState,
      playerASelections,
      playerBSelections,
      hostEvents: hostRelay.getRemoteEvents(),
      peerEvents: peerProxy.getEvents(),
    }
  } finally {
    await peerProxy.cleanup()
    await hostRelay.cleanup()
    await peerTransport.close().catch(() => {})
    await hostTransport.close().catch(() => {})
  }
}

export { LocalBattleSystemV2 }
