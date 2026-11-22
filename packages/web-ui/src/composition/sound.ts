import { isRemoteContentActive } from '@/i18n/serverContent'
import { battleUiUrl, loadMedia, mediaEnvironment } from '@/services/mediaLoader'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { useGameSettingStore } from '@/stores/gameSetting'
import { computed, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { baseSkillId } from '@arcadia-eternity/const'
import { useGameDataStore } from '@/stores/gameData'
import { resolveSkillSfxUrl } from '@/utils/resourceResolver'

export function useSound() {
  const gameSettingStore = useGameSettingStore()
  const gameDataStore = useGameDataStore()
  const volume = computed(() => gameSettingStore.soundVolume / 100)
  const { mute, soundMute } = storeToRefs(gameSettingStore)
  const selfMute = computed(() => mute.value || soundMute.value)

  const playing = new Set<HTMLAudioElement>()
  watch([volume, selfMute], () => {
    for (const audio of playing) {
      audio.volume = volume.value
      audio.muted = selfMute.value
    }
  })
  const activeMedia = new Set<() => void>()
  const playOnce = async (source: string, prepared?: Blob) => {
    if (selfMute.value || !source) return
    const controller = new AbortController()
    let url: string | undefined
    let audio: HTMLAudioElement | undefined
    const dispose = () => {
      if (controller.signal.aborted) return
      controller.abort()
      if (audio) {
        audio.pause()
        playing.delete(audio)
      }
      if (url) URL.revokeObjectURL(url)
      activeMedia.delete(dispose)
    }
    activeMedia.add(dispose)
    try {
      const blob = prepared ?? (await loadMedia('audio', source, controller.signal))
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      audio = new Audio(url)
      audio.volume = volume.value
      audio.muted = selfMute.value
      playing.add(audio)
      audio.addEventListener('ended', dispose, { once: true })
      audio.addEventListener('error', dispose, { once: true })
      await audio.play()
    } catch {
      dispose()
    }
  }
  const playSkillSound = (id: baseSkillId) => {
    void playOnce(resolveSkillSfxUrl(gameDataStore.getSkill(id)))
  }
  const playPetSound = (speciesId?: string) => {
    const cry = speciesId && gameDataStore.getSpecies(speciesId)?.presentation?.cry
    if (typeof cry === 'string') void playOnce(officialAssetUrl(cry))
  }
  const preload = new AbortController()
  const victorySource = () => battleUiUrl('ko', !isRemoteContentActive())
  let victory: { source: string; environment: ReturnType<typeof mediaEnvironment>; blob: Blob } | undefined
  const prepareVictorySound = async () => {
    const source = victorySource()
    const environment = mediaEnvironment()
    if (!source || (victory?.source === source && victory.environment === environment)) return
    const blob = await loadMedia('audio', source, preload.signal)
    preload.signal.throwIfAborted()
    victory = { source, environment, blob }
  }

  onUnmounted(() => {
    preload.abort()
    victory = undefined
    for (const dispose of [...activeMedia]) dispose()
  })
  const playVictorySound = () => {
    const source = victorySource()
    void playOnce(
      source,
      victory?.source === source && victory.environment === mediaEnvironment() ? victory.blob : undefined,
    )
  }

  return {
    playSkillSound,
    playPetSound,
    playVictorySound,
    prepareVictorySound,
  }
}
