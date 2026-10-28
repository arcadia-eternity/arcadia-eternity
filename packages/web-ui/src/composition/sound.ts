import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { Howl } from 'howler'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { computed, onMounted, onUnmounted, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import type { baseSkillId } from '@arcadia-eternity/const'
import { useGameDataStore } from '@/stores/gameData'
import { resolveSkillSfxUrl } from '@/utils/resourceResolver'

export function useSound(
  allSkillId: ComputedRef<baseSkillId[] | undefined>,
  allTeamMemberSpritesNum: ComputedRef<number[] | undefined>, // 添加 allTeamMemberSpritesNum 参数
) {
  const gameSettingStore = useGameSettingStore()
  const resourceStore = useResourceStore()
  const gameDataStore = useGameDataStore()
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
    if (gameDataStore.serverFallback) return
    const skill = gameDataStore.getSkill(id)
    const src = resolveSkillSfxUrl(skill, resourceStore.getSkillSound)
    const howlerInstance = ensureHowlInstance(src)
    skillHowlerMap.set(id, howlerInstance)
  }

  if (allSkillId.value) {
    for (const id of allSkillId.value) {
      registerSkillSound(id)
    }
  }

  const victorySoundSrc = officialAssetUrl(`https://seer2-resource.yuuinih.com/sound/battle/ko.mp3`)
  if (!gameDataStore.serverFallback) ensureHowlInstance(victorySoundSrc)

  const registerPetSounds = (spriteNums: number[] | undefined) => {
    if (gameDataStore.serverFallback) return
    if (spriteNums) {
      for (const num of spriteNums) {
        // Unknown/hidden pets have no official numeric sound resource.
        if (!Number.isFinite(num) || num <= 0) continue
        const src =
          resourceStore.getPetSoundByNum(num) ??
          officialAssetUrl(`https://seer2-resource.yuuinih.com/sound/pet/${num}.mp3`)
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

  const activeMedia = new Set<() => void>()
  const playOnce = async (source: string) => {
    if (selfMute.value) return
    const controller = new AbortController()
    let url: string | undefined
    let audio: HTMLAudioElement | undefined
    const dispose = () => {
      controller.abort()
      audio?.pause()
      if (url) URL.revokeObjectURL(url)
      activeMedia.delete(dispose)
    }
    activeMedia.add(dispose)
    try {
      const response = await fetch(source, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      if (!response.ok) throw new Error(`音频加载失败 (${response.status})`)
      const blob = await response.blob()
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      audio = new Audio(url)
      audio.volume = volume.value
      audio.addEventListener('ended', dispose, { once: true })
      audio.addEventListener('error', dispose, { once: true })
      await audio.play()
    } catch {
      dispose()
    }
  }
  const playSkillSound = (id: baseSkillId) => {
    if (gameDataStore.serverFallback) {
      void playOnce(resolveSkillSfxUrl(gameDataStore.getSkill(id), resourceStore.getSkillSound))
      return
    }
    skillHowlerMap.get(id)?.play()
  }

  const playPetSound = (petSpriteNum: number, speciesId?: string) => {
    const cry = speciesId && gameDataStore.getSpecies(speciesId)?.presentation?.cry
    if (typeof cry === 'string') {
      void playOnce(cry)
      return
    }
    if (gameDataStore.serverFallback) {
      if (petSpriteNum > 0)
        void playOnce(officialAssetUrl(`https://seer2-resource.yuuinih.com/sound/pet/${petSpriteNum}.mp3`))
      return
    }
    if (!Number.isFinite(petSpriteNum) || petSpriteNum <= 0) return
    const src =
      resourceStore.getPetSoundByNum(petSpriteNum) ??
      officialAssetUrl(`https://seer2-resource.yuuinih.com/sound/pet/${petSpriteNum}.mp3`)
    const howler = ensureHowlInstance(src)
    howler.play()
  }

  onUnmounted(() => {
    for (const dispose of [...activeMedia]) dispose()
    soundSrcHowlerMap.forEach(v => {
      v.stop()
      v.unload()
    })
    skillHowlerMap.clear()
    soundSrcHowlerMap.clear()
  })

  const playVictorySound = () => {
    if (gameDataStore.serverFallback) {
      void playOnce(victorySoundSrc)
      return
    }
    const howler = ensureHowlInstance(victorySoundSrc)
    howler.play()
  }

  return {
    playSkillSound,
    playPetSound,
    playVictorySound,
  }
}
