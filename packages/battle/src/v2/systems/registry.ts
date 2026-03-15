// battle/src/v2/systems/registry.ts
// Runtime registry — stores system instances in world.meta so stateless
// handlers can access them without dependency injection.

import type { World, AttributeSystem } from '@arcadia-eternity/engine'

const ATTR_SYSTEM_KEY = '__attrSystem'

export function registerAttrSystem(world: World, attrSystem: AttributeSystem): void {
  world.meta[ATTR_SYSTEM_KEY] = attrSystem
}

export function getAttrSystem(world: World): AttributeSystem {
  const sys = world.meta[ATTR_SYSTEM_KEY] as AttributeSystem | undefined
  if (!sys) throw new Error('AttributeSystem not registered in world.meta')
  return sys
}
