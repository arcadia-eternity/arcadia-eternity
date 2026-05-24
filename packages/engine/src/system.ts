// engine/src/system.ts
// Generic System base class — provides typed AttributeSystem access.
// Game-layer system classes extend this with their concrete attribute types.

import type { AttributeSystem, AttributeValue } from './attribute.js'
import type { WorldState, WorldSystems, WorldPlugins } from './world.js'

export class System<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
  TAttributes = Record<string, AttributeValue>,
> {
  constructor(protected readonly attrSystem: AttributeSystem<TState, TSystems, TPlugins, TAttributes>) {}
}
