import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useGameSettingStore = defineStore('gameSetting', () => {
  const mute = ref<boolean>(false)
  const musicVolume = ref<number>(50)
  const musicMute = ref<boolean>(false)
  const soundVolume = ref<number>(50)
  const soundMute = ref<boolean>(false)
  const background = ref<string | 'random'>('random')
  const battleMusic = ref<string | 'random'>('random')

  return {
    mute,
    musicVolume,
    musicMute,
    soundVolume,
    soundMute,
    background,
    battleMusic,
  }
})
