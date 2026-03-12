import { describe, expect, it } from 'vitest'
import { runInMemoryP2PE2E } from '../src/e2e'

describe('runInMemoryP2PE2E', () => {
  it('completes deterministic roundtrip exchange', async () => {
    const result = await runInMemoryP2PE2E(2)

    expect(result.hostSignals).toHaveLength(1)
    expect(result.peerSignals).toHaveLength(1)
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
