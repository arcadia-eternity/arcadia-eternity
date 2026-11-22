import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { mediaEnvironment, battleScene, MOVIE_LIMIT, readMediaBytes } from '@/services/environmentMedia'
import { audioResourceBlob } from '@/services/audioResource'
import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, watch, ref } from 'vue' // Added ref
import { storeToRefs } from 'pinia'

export function useMusic(autoPlay: boolean = true) {
  const gameSettingStore = useGameSettingStore()
  const resourceStore = useResourceStore()

  const volume = computed(() => gameSettingStore.musicVolume / 100)
  const musicSrc = computed(() => {
    const selected = battleScene(mediaEnvironment(), 'music', gameSettingStore.battleMusic)
    if (selected) return selected
    if (gameSettingStore.battleMusic === 'random') {
      if (resourceStore.music.allIds.length === 0) {
        return officialAssetUrl('https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3')
      }
      return (
        resourceStore.getMusic(
          resourceStore.music.allIds[Math.floor(Math.random() * resourceStore.music.allIds.length)],
        ) ?? officialAssetUrl('https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3')
      )
    }
    return (
      resourceStore.getMusic(gameSettingStore.battleMusic) ??
      officialAssetUrl('https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3')
    )
  })

  const { mute, musicMute } = storeToRefs(gameSettingStore)
  const selfMute = computed(() => mute.value || musicMute.value)

  const howlerInstance = ref<Howl | null>(null)
  const isStarted = ref(false)

  watch(volume, newVolume => {
    if (howlerInstance.value) {
      howlerInstance.value.volume(newVolume)
    }
  })

  watch(selfMute, newMuteState => {
    if (howlerInstance.value) {
      howlerInstance.value.mute(newMuteState)
      if (!newMuteState && !howlerInstance.value.playing() && isStarted.value) {
        howlerInstance.value.play()
      }
    }
  })

  watch(
    () => [musicSrc.value, mediaEnvironment().scope] as const,
    async ([source], _previous, cleanup) => {
      const controller = new AbortController()
      let url: string | undefined
      let instance: Howl | undefined
      cleanup(() => {
        controller.abort()
        instance?.unload()
        howlerInstance.value = null
        if (url) URL.revokeObjectURL(url)
      })
      try {
        const bytes = await readMediaBytes(source, { signal: controller.signal, maxBytes: MOVIE_LIMIT })
        if (controller.signal.aborted) return
        const blob = audioResourceBlob(bytes)
        url = URL.createObjectURL(blob)
        instance = new Howl({
          src: [url],
          format: [blob.type === 'audio/ogg' ? 'ogg' : 'mp3'],
          loop: true,
          volume: volume.value,
          mute: selfMute.value,
        })
        howlerInstance.value = instance
        if (isStarted.value && !selfMute.value) instance.play()
      } catch {
        /* Optional music can be unavailable in this environment. */
      }
    },
    { immediate: true },
  )

  // 手动启动音乐的方法
  const startMusic = () => {
    isStarted.value = true
    if (howlerInstance.value && !selfMute.value && !howlerInstance.value.playing()) {
      howlerInstance.value.play()
    }
  }

  // 停止音乐的方法
  const stopMusic = () => {
    isStarted.value = false
    if (howlerInstance.value && howlerInstance.value.playing()) {
      howlerInstance.value.stop()
    }
  }

  onMounted(() => {
    if (autoPlay) {
      startMusic()
    }
  })

  return {
    startMusic,
    stopMusic,
  }
}
