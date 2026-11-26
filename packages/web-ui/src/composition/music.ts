import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { mediaEnvironment, loadMedia } from '@/services/mediaLoader'
import { battleScene } from '@/services/environmentMedia'
import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, watch, ref, shallowRef } from 'vue'
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

  const howlerInstance = shallowRef<Howl | null>(null)
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

  let ready: Promise<void>
  watch(
    [musicSrc, () => mediaEnvironment().scope],
    ([source], _previous, cleanup) => {
      const controller = new AbortController()
      let url: string | undefined
      let instance: Howl | undefined
      let finishLoad: (() => void) | undefined
      cleanup(() => {
        controller.abort()
        finishLoad?.()
        instance?.unload()
        howlerInstance.value = null
        if (url) URL.revokeObjectURL(url)
      })
      ready = loadMedia('audio', source, controller.signal, 'deferred').then(blob => {
        controller.signal.throwIfAborted()
        const sourceUrl = URL.createObjectURL(blob)
        url = sourceUrl
        return new Promise<void>((resolve, reject) => {
          finishLoad = resolve
          instance = new Howl({
            src: [sourceUrl],
            format: [blob.type === 'audio/ogg' ? 'ogg' : 'mp3'],
            loop: true,
            volume: volume.value,
            mute: selfMute.value,
            onload: () => resolve(),
            onloaderror: (_id, cause) => reject(new Error(String(cause))),
          })
          howlerInstance.value = instance
          if (isStarted.value && !selfMute.value) instance.play()
        })
      })
      // Loading starts on mount, before battle preparation subscribes.
      void ready.catch(() => {})
    },
    { immediate: true },
  )

  async function whenMusicReady() {
    let selected: Promise<void>
    do {
      selected = ready
      try {
        await selected
      } catch (error) {
        if (selected === ready) throw error
      }
    } while (selected !== ready)
  }

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
    whenMusicReady,
    startMusic,
    stopMusic,
  }
}
