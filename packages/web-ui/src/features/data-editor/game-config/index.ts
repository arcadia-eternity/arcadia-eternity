import { provide, inject, type InjectionKey } from 'vue'
import type { GameConfig, EntityKind, EntityConfig } from './types'

const CONFIG_KEY = Symbol('game-config') as InjectionKey<GameConfig>

export function provideGameConfig(config: GameConfig): void {
  provide(CONFIG_KEY, config)
}

export function useGameConfig(): GameConfig {
  const config = inject(CONFIG_KEY)
  if (!config) {
    throw new Error(
      'useGameConfig() called without a parent provideGameConfig(). ' +
      'Ensure provideGameConfig() is called at app root before any data-editor component mounts.',
    )
  }
  return config
}

export function getEntityConfig(config: GameConfig, kind: EntityKind): EntityConfig {
  const entity = config.entities[kind]
  if (!entity) {
    throw new Error(`Unknown entity kind: "${kind}". Registered kinds: ${Object.keys(config.entities).join(', ')}`)
  }
  return entity
}

export function getEntityKinds(config: GameConfig): EntityKind[] {
  return Object.keys(config.entities)
}
