import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { BattleMessageType } from '@arcadia-eternity/const'

const STORAGE_PREFIX = 'gameSetting.'

// 默认显示的日志类型
const DEFAULT_VISIBLE_LOG_TYPES: Set<BattleMessageType> = new Set([
  BattleMessageType.SkillUse,
  BattleMessageType.Damage,
  BattleMessageType.Heal,
  BattleMessageType.SkillMiss,
  BattleMessageType.PetSwitch,
  BattleMessageType.BattleStart,
  BattleMessageType.BattleEnd,
  BattleMessageType.ForcedSwitch,
  BattleMessageType.FaintSwitch,
  BattleMessageType.PetDefeated,
  BattleMessageType.MarkApply,
  BattleMessageType.MarkDestroy,
])

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

  // 战斗日志过滤设置
  const visibleLogTypes = ref<Set<BattleMessageType>>(
    new Set(loadFromStorage('visibleLogTypes', Array.from(DEFAULT_VISIBLE_LOG_TYPES))),
  )

  watchEffect(() => {
    debouncedSaveAllSettings({
      mute: mute.value,
      musicVolume: musicVolume.value,
      musicMute: musicMute.value,
      soundVolume: soundVolume.value,
      soundMute: soundMute.value,
      background: background.value,
      battleMusic: battleMusic.value,
      visibleLogTypes: Array.from(visibleLogTypes.value),
    })
  })

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
    visibleLogTypes.value = new Set(DEFAULT_VISIBLE_LOG_TYPES)
  }

  const showAllLogTypes = () => {
    visibleLogTypes.value = new Set(Object.values(BattleMessageType))
  }

  const hideAllLogTypes = () => {
    visibleLogTypes.value = new Set()
  }

  return {
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
