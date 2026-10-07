import { inject, provide, type InjectionKey } from 'vue'
import { useGameDataStore } from '@/stores/gameData'

/**
 * Shared game data reference used by all DSL node editors for entity lookups
 * (marks, skills, species, effects options in select dropdowns).
 */
export type DslGameDataRef = ReturnType<typeof useGameDataStore>

const DSL_GAME_DATA_KEY: InjectionKey<DslGameDataRef> = Symbol('dsl:gameData')

/**
 * Provide the game data store to all descendant DSL node editors.
 * Call once in EffectProperties.vue setup.
 */
export function useProvideDslContext(): void {
  const gameData = useGameDataStore()
  provide(DSL_GAME_DATA_KEY, gameData)
}

/**
 * Consume the game data store from the nearest ancestor that called useProvideDslContext.
 */
export function useDslContext(): DslGameDataRef {
  const ctx = inject(DSL_GAME_DATA_KEY)
  if (!ctx) {
    throw new Error('useDslContext() must be used within a component that calls useProvideDslContext()')
  }
  return ctx
}
