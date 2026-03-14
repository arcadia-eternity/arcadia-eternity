import { describe, expect, it } from 'vitest'
import { runWebSocketP2PE2E } from '../src/webSocketE2e'

describe('runWebSocketP2PE2E', () => {
  it('completes websocket roundtrip exchange through relay server', async () => {
    const result = await runWebSocketP2PE2E(2)

    expect(result.hostPhase).toBe('connected')
    expect(result.peerPhase).toBe('connected')
    expect(result.hostReceived).toHaveLength(2)
    expect(result.peerReceived).toHaveLength(2)
    expect(result.peerReceived[0]).toEqual({
      type: 'battle-action',
      payload: { round: 1, actor: 'host' },
    })
    expect(result.hostReceived[0]).toEqual({
      type: 'battle-ack',
      payload: { round: 1, actor: 'peer' },
    })
  })
})
