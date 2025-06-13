import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, onUnmounted, watch, ref } from 'vue' // Added ref
import { storeToRefs } from 'pinia'

export function useMusic() {
  const gameSettingStore = useGameSettingStore()
  const resourceStore = useResourceStore()

  const volume = computed(() => gameSettingStore.musicVolume / 100)
  const musicSrc = computed(() => {
    if (gameSettingStore.battleMusic === 'random') {
      if (resourceStore.music.allIds.length === 0) {
        return 'https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3'
      }
      return (
        resourceStore.getMusic(
          resourceStore.music.allIds[Math.floor(Math.random() * resourceStore.music.allIds.length)],
        ) ?? 'https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3'
      )
    }
    return (
      resourceStore.getMusic(gameSettingStore.battleMusic) ??
      'https://seer2-resource.yuuinih.com/music/battle/BGM_1002.mp3'
    )
  })

  const { mute, musicMute } = storeToRefs(gameSettingStore)
  const selfMute = computed(() => mute.value || musicMute.value)

  const howlerInstance = ref<Howl | null>(null)

  const createNewHowl = (src: string) => {
    if (howlerInstance.value) {
      howlerInstance.value.stop()
      howlerInstance.value.unload()
    }
    const newHowl = new Howl({
      src: [src],
      loop: true,
      volume: volume.value,
      mute: selfMute.value,
    })
    howlerInstance.value = newHowl
    return newHowl
  }

  watch(volume, newVolume => {
    if (howlerInstance.value) {
      howlerInstance.value.volume(newVolume)
    }
  })

  watch(selfMute, newMuteState => {
    if (howlerInstance.value) {
      howlerInstance.value.mute(newMuteState)
      if (!newMuteState && !howlerInstance.value.playing()) {
        howlerInstance.value.play()
      }
    }
  })

  watch(
    musicSrc,
    (newSrc, oldSrc) => {
      if (newSrc !== oldSrc || !howlerInstance.value) {
        let shouldPlayAfterCreation = false
        if (howlerInstance.value) {
          shouldPlayAfterCreation = howlerInstance.value.playing()
        } else {
          shouldPlayAfterCreation = !selfMute.value
        }

        createNewHowl(newSrc)

        if (shouldPlayAfterCreation && !selfMute.value) {
          howlerInstance.value?.play()
        }
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    if (howlerInstance.value && !selfMute.value && !howlerInstance.value.playing()) {
      howlerInstance.value.play()
    }
  })

  onUnmounted(() => {
    if (howlerInstance.value) {
      howlerInstance.value.stop()
      howlerInstance.value.unload()
    }
  })
}
