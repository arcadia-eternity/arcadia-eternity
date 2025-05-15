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
  const soundSrcHowlerMap = new Map<string, Howl>()

  const ensureHowlInstance = (src: string): Howl => {
    if (!soundSrcHowlerMap.has(src)) {
      const newHowler = new Howl({
        src: [src],
        loop: false,
        volume: volume.value,
        mute: selfMute.value,
      })
      soundSrcHowlerMap.set(src, newHowler)
    }
    return soundSrcHowlerMap.get(src)!
  }

  function registerSkillSound(id: baseSkillId) {
    const src =
      resourceStore.getSkillSound(id) ??
      'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/skill/01_1_003.mp3'
    const howlerInstance = ensureHowlInstance(src)
    skillHowlerMap.set(id, howlerInstance)
  }

  if (allSkillId.value) {
    for (const id of allSkillId.value) {
      registerSkillSound(id)
    }
  }

  const victorySoundSrc = `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/battle/ko.mp3`
  ensureHowlInstance(victorySoundSrc)

  const registerPetSounds = (spriteNums: number[] | undefined) => {
    if (spriteNums) {
      for (const num of spriteNums) {
        const src = `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/pet/${num}.mp3`
        ensureHowlInstance(src)
      }
    }
  }

  registerPetSounds(allTeamMemberSpritesNum.value)

  watch(allSkillId, newVal => {
    if (newVal) {
      for (const id of newVal) {
        if (!skillHowlerMap.has(id)) {
          registerSkillSound(id)
        }
      }
    }
  })

  watch(
    allTeamMemberSpritesNum,
    newVal => {
      registerPetSounds(newVal)
    },
    { deep: true },
  )

  watch(selfMute, val => {
    soundSrcHowlerMap.forEach(v => v.mute(val))
  })

  watch(volume, val => {
    soundSrcHowlerMap.forEach(v => v.volume(val))
  })

  const playSkillSound = (id: baseSkillId) => {
    skillHowlerMap.get(id)?.play()
  }

  const playPetSound = (petSpriteNum: number) => {
    const src = `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/sound/pet/${petSpriteNum}.mp3`
    const howler = ensureHowlInstance(src)
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

  const playVictorySound = () => {
    const howler = ensureHowlInstance(victorySoundSrc)
    howler.play()
  }

  return {
    playSkillSound,
    playPetSound,
    playVictorySound,
  }
}
