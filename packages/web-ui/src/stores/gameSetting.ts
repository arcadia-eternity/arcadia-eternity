import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { useDebounceFn } from '@vueuse/core'

const STORAGE_PREFIX = 'gameSetting.'

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

function saveToStorage(key: string, value: any) {
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
}

const debouncedSaveAllSettings = useDebounceFn((settings: Record<string, any>) => {
  for (const key in settings) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      saveToStorage(key, settings[key])
    }
  }
}, 300)

export const useGameSettingStore = defineStore('gameSetting', () => {
  const mute = ref<boolean>(loadFromStorage('mute', false))
  const musicVolume = ref<number>(loadFromStorage('musicVolume', 50))
  const musicMute = ref<boolean>(loadFromStorage('musicMute', false))
  const soundVolume = ref<number>(loadFromStorage('soundVolume', 50))
  const soundMute = ref<boolean>(loadFromStorage('soundMute', false))
  const background = ref<string | 'random'>(loadFromStorage('background', 'random'))
  const battleMusic = ref<string | 'random'>(loadFromStorage('battleMusic', 'random'))

  watchEffect(() => {
    debouncedSaveAllSettings({
      mute: mute.value,
      musicVolume: musicVolume.value,
      musicMute: musicMute.value,
      soundVolume: soundVolume.value,
      soundMute: soundMute.value,
      background: background.value,
      battleMusic: battleMusic.value,
    })
  })

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
