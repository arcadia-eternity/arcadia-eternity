import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, onUnmounted, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import type { baseSkillId } from '@arcadia-eternity/const'

export function useSound(
  allSkillId: ComputedRef<baseSkillId[] | undefined>,
  allTeamMemberSpritesNum: ComputedRef<number[] | undefined>, // 添加 allTeamMemberSpritesNum 参数
) {
  const gameSettingStore = useGameSettingStore()
  const resourceStore = useResourceStore()
  const volume = computed(() => gameSettingStore.soundVolume / 100)
  const { mute, soundMute } = storeToRefs(gameSettingStore)
  const selfMute = computed(() => mute.value || soundMute.value)

  const skillHowlerMap = new Map<baseSkillId, Howl>()
  const soundSrcHowlerMap = new Map<string, Howl>() // 新增 Map 用于存储 src -> Howl

  function registerSkillSound(id: baseSkillId) {
    // 确保即使技能ID已存在于skillHowlerMap，但如果其src对应的Howl实例尚未创建或需要更新，也进行处理

    const src =
      resourceStore.getSkillSound(id) ??
      'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/skill/01_1_003.mp3'

    if (soundSrcHowlerMap.has(src)) {
      // 如果该声音文件已存在 Howl 实例，则共享它
      const existingHowler = soundSrcHowlerMap.get(src)!
      skillHowlerMap.set(id, existingHowler)
    } else {
      // 否则，创建新的 Howl 实例
      const newHowler = new Howl({
        src: [src],
        loop: false,
        volume: volume.value,
        mute: selfMute.value,
      })
      soundSrcHowlerMap.set(src, newHowler)
      skillHowlerMap.set(id, newHowler)
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
    soundSrcHowlerMap.forEach(v => v.mute(val)) // 改为遍历 soundSrcHowlerMap
  })

  watch(volume, val => {
    soundSrcHowlerMap.forEach(v => v.volume(val)) // 改为遍历 soundSrcHowlerMap
  })

  const playSkillSound = (id: baseSkillId) => {
    skillHowlerMap.get(id)?.play()
  }

  const playPetSound = (petSpriteNum: number) => {
    const src = `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/pet/${petSpriteNum}.mp3`
    let howler = soundSrcHowlerMap.get(src)
    if (!howler) {
      howler = new Howl({
        src: [src],
        loop: false,
        volume: volume.value,
        mute: selfMute.value,
      })
      soundSrcHowlerMap.set(src, howler)
    }
    howler.play()
  }

  onUnmounted(() => {
    soundSrcHowlerMap.forEach(v => {
      v.stop()
      v.unload()
    })
    skillHowlerMap.clear()
    soundSrcHowlerMap.clear()
  })

  return {
    playSkillSound,
    playPetSound,
  }
}
