import { describe, it, expect } from 'vitest'
import Redis from 'ioredis-mock'
import {
  InMemoryOwnershipCoordinator,
  RedisOwnershipCoordinator,
} from '../src/domain/battle/runtime/ownershipCoordinator'

function createRedisManager() {
  const client = new Redis()
  return {
    client,
    manager: {
      getClient: () => client as any,
    },
  }
}

describe('OwnershipCoordinator', () => {
  it('in-memory coordinator supports claim/get/release lifecycle', async () => {
    const coordinator = new InMemoryOwnershipCoordinator()

    const claimed = await coordinator.claim('room-1', 'instance-a')
    expect(claimed.ownerInstanceId).toBe('instance-a')
    expect(claimed.status).toBe('active')

    const existing = await coordinator.get('room-1')
    expect(existing?.ownerInstanceId).toBe('instance-a')

    await coordinator.markDraining('room-1', 'instance-a')
    const draining = await coordinator.get('room-1')
    expect(draining?.status).toBe('draining')

    await coordinator.release('room-1', 'instance-a')
    const released = await coordinator.get('room-1')
    expect(released).toBeNull()
  })

  it('redis coordinator persists ownership and supports lifecycle transitions', async () => {
    const { client, manager } = createRedisManager()
    const coordinator = new RedisOwnershipCoordinator(manager, 'instance-a', 5000)

    const claimed = await coordinator.claim('room-2', 'instance-a')
    expect(claimed.ownerInstanceId).toBe('instance-a')
    expect(claimed.status).toBe('active')
    expect(claimed.leaseExpireAt).toBeDefined()

    const existing = await coordinator.get('room-2')
    expect(existing?.ownerInstanceId).toBe('instance-a')

    await coordinator.markDraining('room-2', 'instance-a')
    const draining = await coordinator.get('room-2')
    expect(draining?.status).toBe('draining')

    await coordinator.release('room-2', 'instance-a')
    const released = await coordinator.get('room-2')
    expect(released).toBeNull()

    client.disconnect()
  })

  it('redis coordinator arbitrates multi-instance claim with first-owner-wins semantics', async () => {
    const { client, manager } = createRedisManager()
    const ownerA = new RedisOwnershipCoordinator(manager, 'instance-a', 5000)
    const ownerB = new RedisOwnershipCoordinator(manager, 'instance-b', 5000)

    const first = await ownerA.claim('room-3', 'instance-a')
    expect(first.ownerInstanceId).toBe('instance-a')
    expect(first.status).toBe('active')

    const second = await ownerB.claim('room-3', 'instance-b')
    expect(second.ownerInstanceId).toBe('instance-a')
    expect(second.status).toBe('active')

    const persisted = await ownerA.get('room-3')
    expect(persisted?.ownerInstanceId).toBe('instance-a')

    client.disconnect()
  })

  it('redis coordinator refreshes lease when same owner re-claims', async () => {
    const { client, manager } = createRedisManager()
    const owner = new RedisOwnershipCoordinator(manager, 'instance-a', 5000)

    const first = await owner.claim('room-4', 'instance-a')
    const second = await owner.claim('room-4', 'instance-a')

    expect(second.ownerInstanceId).toBe('instance-a')
    expect(second.status).toBe('active')
    expect((second.leaseExpireAt ?? 0) >= (first.leaseExpireAt ?? 0)).toBe(true)

    client.disconnect()
  })

  it('redis coordinator allows takeover after lease expiry (simulated owner crash)', async () => {
    const { client, manager } = createRedisManager()
    const ownerA = new RedisOwnershipCoordinator(manager, 'instance-a', 50)
    const ownerB = new RedisOwnershipCoordinator(manager, 'instance-b', 50)

    await ownerA.claim('room-5', 'instance-a')

    await new Promise(resolve => setTimeout(resolve, 120))

    const takeover = await ownerB.claim('room-5', 'instance-b')
    expect(takeover.ownerInstanceId).toBe('instance-b')
    expect(takeover.status).toBe('active')

    const persisted = await ownerB.get('room-5')
    expect(persisted?.ownerInstanceId).toBe('instance-b')

    client.disconnect()
  })

  it('redis coordinator ignores release from non-owner', async () => {
    const { client, manager } = createRedisManager()
    const ownerA = new RedisOwnershipCoordinator(manager, 'instance-a', 5000)
    const ownerB = new RedisOwnershipCoordinator(manager, 'instance-b', 5000)

    await ownerA.claim('room-6', 'instance-a')
    await ownerB.release('room-6', 'instance-b')

    const persisted = await ownerA.get('room-6')
    expect(persisted?.ownerInstanceId).toBe('instance-a')

    client.disconnect()
  })
})
