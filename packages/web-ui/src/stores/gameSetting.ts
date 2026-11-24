import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Value } from '@sinclair/typebox/value'
import { defaultSettings, SettingsSchema } from '@arcadia-eternity/local-profile'
import { BattleMessageType } from '@arcadia-eternity/const'
import { readLocalData, writeLocalData } from '@/services/localStorage'

const STORAGE_PREFIX = 'gameSetting.'

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = readLocalData(STORAGE_PREFIX + key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

function saveToStorage(key: string, value: unknown) {
  writeLocalData(STORAGE_PREFIX + key, JSON.stringify(value))
}

const saveAllSettings = (settings: Record<string, unknown>) => {
  for (const key in settings) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      saveToStorage(key, settings[key])
    }
  }
}

export const useGameSettingStore = defineStore('gameSetting', () => {
  const defaults = defaultSettings()
  const storedRenderer = loadFromStorage('battleRenderer', defaults.battleRenderer)
  const battleRenderer = ref(
    Value.Check(SettingsSchema.properties.battleRenderer, storedRenderer) ? storedRenderer : defaults.battleRenderer,
  )
  const storedMotion = loadFromStorage('battleMotion', defaults.battleMotion)
  const battleMotion = ref(
    Value.Check(SettingsSchema.properties.battleMotion, storedMotion) ? storedMotion : defaults.battleMotion,
  )
  const mute = ref(loadFromStorage('mute', defaults.mute))
  const musicVolume = ref(loadFromStorage('musicVolume', defaults.musicVolume))
  const musicMute = ref(loadFromStorage('musicMute', defaults.musicMute))
  const soundVolume = ref(loadFromStorage('soundVolume', defaults.soundVolume))
  const soundMute = ref(loadFromStorage('soundMute', defaults.soundMute))
  const background = ref(loadFromStorage('background', defaults.background))
  const battleMusic = ref(loadFromStorage('battleMusic', defaults.battleMusic))
  const visibleLogTypes = ref(new Set(loadFromStorage('visibleLogTypes', defaults.visibleLogTypes)))

  watch(
    () => ({
      battleRenderer: battleRenderer.value,
      battleMotion: battleMotion.value,
      mute: mute.value,
      musicVolume: musicVolume.value,
      musicMute: musicMute.value,
      soundVolume: soundVolume.value,
      soundMute: soundMute.value,
      background: background.value,
      battleMusic: battleMusic.value,
      visibleLogTypes: Array.from(visibleLogTypes.value),
    }),
    saveAllSettings,
    { flush: 'sync', immediate: true },
  )

  function reloadFromLocal() {
    battleRenderer.value = loadFromStorage('battleRenderer', battleRenderer.value)
    battleMotion.value = loadFromStorage('battleMotion', battleMotion.value)
    mute.value = loadFromStorage('mute', mute.value)
    musicVolume.value = loadFromStorage('musicVolume', musicVolume.value)
    musicMute.value = loadFromStorage('musicMute', musicMute.value)
    soundVolume.value = loadFromStorage('soundVolume', soundVolume.value)
    soundMute.value = loadFromStorage('soundMute', soundMute.value)
    background.value = loadFromStorage('background', background.value)
    battleMusic.value = loadFromStorage('battleMusic', battleMusic.value)
    visibleLogTypes.value = new Set(loadFromStorage('visibleLogTypes', [...visibleLogTypes.value]))
  }

  // 日志类型管理方法
  const toggleLogType = (logType: BattleMessageType) => {
    if (visibleLogTypes.value.has(logType)) {
      visibleLogTypes.value.delete(logType)
    } else {
      visibleLogTypes.value.add(logType)
    }
    // 触发响应式更新
    visibleLogTypes.value = new Set(visibleLogTypes.value)
  }

  const resetLogTypesToDefault = () => {
    visibleLogTypes.value = new Set(defaults.visibleLogTypes)
  }

  const showAllLogTypes = () => {
    visibleLogTypes.value = new Set(Object.values(BattleMessageType))
  }

  const hideAllLogTypes = () => {
    visibleLogTypes.value = new Set()
  }

  return {
    reloadFromLocal,
    battleRenderer,
    battleMotion,
    mute,
    musicVolume,
    musicMute,
    soundVolume,
    soundMute,
    background,
    battleMusic,
    visibleLogTypes,
    toggleLogType,
    resetLogTypesToDefault,
    showAllLogTypes,
    hideAllLogTypes,
  }
})
