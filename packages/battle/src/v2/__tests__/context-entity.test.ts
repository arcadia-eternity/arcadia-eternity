import { describe, expect, test } from 'vitest'
import {
  createWorld,
  createEntity,
  addTag,
  setComponent,
  hasEntity,
  hasTag,
  getComponent,
  queryByTag,
} from '@arcadia-eternity/engine'
import {
  createContextEntity,
  findContextByType,
  destroyContextEntity,
  getCurrentContextEntityId,
  setCurrentContextEntityId,
} from '../systems/context-entity.js'

const CONTEXT_TAG = '_battle_context'

describe('context entity lifecycle', () => {
  test('createContextEntity creates entity with correct tag and component', () => {
    const world = createWorld()
    const systems = {}

    const entityId = createContextEntity(world, systems, {
      type: 'use-skill',
      skillId: 'sk_test',
    })

    expect(hasEntity(world, entityId)).toBe(true)
    expect(hasTag(world, entityId, CONTEXT_TAG)).toBe(true)

    const context = getComponent(world, entityId, 'context') as { type: string } | undefined
    expect(context).toBeDefined()
    expect(context!.type).toBe('use-skill')
  })

  test('findContextByType traverses parent chain recursively', () => {
    const world = createWorld()
    const systems = {}

    const entityA = createEntity(world, 'ctx_a')
    addTag(world, entityA.id, CONTEXT_TAG)
    setComponent(world, entityA.id, 'context', { type: 'damage', parentId: undefined })

    const entityB = createEntity(world, 'ctx_b')
    addTag(world, entityB.id, CONTEXT_TAG)
    setComponent(world, entityB.id, 'context', { type: 'heal', parentId: entityA.id })

    const entityC = createEntity(world, 'ctx_c')
    addTag(world, entityC.id, CONTEXT_TAG)
    setComponent(world, entityC.id, 'context', { type: 'use-skill', parentId: entityB.id })

    const result = findContextByType(world, systems, entityC.id, 'damage')
    expect(result).toBeDefined()
    expect(result.type).toBe('damage')
  })

  test('destroyContextEntity removes entity from world', () => {
    const world = createWorld()
    const systems = {}

    const entityId = createContextEntity(world, systems, { type: 'use-skill' })
    expect(hasEntity(world, entityId)).toBe(true)

    destroyContextEntity(world, systems, entityId)

    expect(hasEntity(world, entityId)).toBe(false)
    const taggedEntities = queryByTag(world, CONTEXT_TAG)
    expect(taggedEntities).not.toContain(entityId)
  })

  test('getCurrentContextEntityId / setCurrentContextEntityId roundtrip', () => {
    const world = createWorld()
    const systems = {}

    setCurrentContextEntityId(world, 'test_entity')
    expect(getCurrentContextEntityId(world)).toBe('test_entity')

    setCurrentContextEntityId(world, undefined)
    expect(getCurrentContextEntityId(world)).toBeUndefined()
  })

  test('nested context cleanup: destroy child then parent leaves no orphans', () => {
    const world = createWorld()
    const systems = {}

    const parentId = createContextEntity(world, systems, { type: 'damage' })
    const childId = createContextEntity(world, systems, { type: 'heal', parentId })

    destroyContextEntity(world, systems, childId)
    expect(hasEntity(world, childId)).toBe(false)
    expect(hasEntity(world, parentId)).toBe(true)

    destroyContextEntity(world, systems, parentId)
    expect(hasEntity(world, parentId)).toBe(false)

    const remaining = queryByTag(world, CONTEXT_TAG)
    expect(remaining).not.toContain(childId)
    expect(remaining).not.toContain(parentId)
  })
})
