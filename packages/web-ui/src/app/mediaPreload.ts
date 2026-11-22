import { computed, watch, type App } from 'vue'
import type { Pinia } from 'pinia'
import { createMediaPreloader } from '@/services/environmentMedia'
import { activeMediaCatalog, mediaEnvironment } from '@/services/mediaLoader'
import { preloadSwfPlayer } from '@/services/swf/assets'
import { useGameSettingStore } from '@/stores/gameSetting'
import { usePetStorageStore } from '@/stores/petStorage'

export function preferredMediaTeam(storage: ReturnType<typeof usePetStorageStore>) {
  const team =
    storage.teams.find(row => row.id === storage.lastMatchingConfig?.teamId) ?? storage.teams[storage.currentTeamIndex]
  return (
    team?.pets.map(({ species, skills, ability, emblem }) => ({ species, skills: [...skills], ability, emblem })) ?? []
  )
}

export function installMediaPreload(app: App, pinia: Pinia) {
  const storage = usePetStorageStore(pinia)
  const settings = useGameSettingStore(pinia)
  const sweep = createMediaPreloader('环境全量预载', 'environment')
  const environment = computed(() => {
    const catalog = activeMediaCatalog()
    return catalog ? mediaEnvironment(catalog) : null
  })
  const stopEnvironment = watch(
    environment,
    () => {
      sweep.update(activeMediaCatalog(), preferredMediaTeam(storage), settings)
    },
    { immediate: true },
  )
  const stopPlayer = watch(
    () =>
      settings.battleRenderer !== 'image' &&
      activeMediaCatalog()?.species.some(row => row.presentation?.battle?.renderer === 'seer2-swf')
        ? environment.value
        : null,
    (enabled, _, cleanup) => {
      if (!enabled) return
      const controller = new AbortController()
      cleanup(() => controller.abort())
      void preloadSwfPlayer(controller.signal)
    },
    { immediate: true },
  )
  app.onUnmount(() => {
    stopEnvironment()
    stopPlayer()
    sweep.stop()
  })
}
