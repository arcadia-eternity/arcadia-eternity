import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, onUnmounted, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import type { baseSkillId } from '@arcadia-eternity/const'

export function useSound(allSkillId: ComputedRef<baseSkillId[] | undefined>) {
  const gameSettingStore = useGameSettingStore()
  const resourceStore = useResourceStore()
  const volume = computed(() => gameSettingStore.soundVolume / 100)
  const { mute, soundMute } = storeToRefs(gameSettingStore)
  const selfMute = computed(() => mute.value || soundMute.value)

  const skillHowlerMap = new Map<baseSkillId, Howl>()

  function registerSkillSound(id: baseSkillId) {
    if (!skillHowlerMap.has(id)) {
      const src =
        resourceStore.getSkillSound(id) ??
        'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/skill/01_1_003.mp3'
      const howler = new Howl({
        src: [src],
        loop: false,
        volume: volume.value,
        mute: selfMute.value,
      })
      skillHowlerMap.set(id, howler)
    }
  }

  for (const id of allSkillId.value ?? []) {
    registerSkillSound(id)
  }

  watch(allSkillId, newVal => {
    if (newVal) {
      for (const id of newVal) {
        registerSkillSound(id)
      }
    }
  })

  watch(selfMute, val => {
    skillHowlerMap.forEach(v => v.mute(val))
  })

  watch(volume, val => {
    skillHowlerMap.forEach(v => v.volume(val))
  })

  const playSkillSound = (id: baseSkillId) => {
    skillHowlerMap.get(id)?.play()
  }

  onUnmounted(() => {
    skillHowlerMap.forEach(v => v.stop())
    skillHowlerMap.forEach(v => v.unload())
  })

  return {
    playSkillSound,
  }
}
