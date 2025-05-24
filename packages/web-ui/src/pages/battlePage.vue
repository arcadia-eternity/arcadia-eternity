<script setup lang="ts">
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import Mark from '@/components/battle/Mark.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import { useBattleAnimations } from '@/composition/useBattleAnimations'
import { useMusic } from '@/composition/music'
import { useSound } from '@/composition/sound'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { logMessagesKey, markMapKey, petMapKey, playerMapKey, skillMapKey } from '@/symbol/battlelog'
import {
  BattleMessageType,
  Category,
  type BattleMessage,
  type petId,
  type PetSwitchMessage,
  type skillId,
  type SkillMessage,
  type SkillUseEndMessage,
} from '@arcadia-eternity/const'
import { useElementBounding } from '@vueuse/core'
import gsap from 'gsap'
import i18next from 'i18next'
import mitt from 'mitt'
import {
  catchError,
  concatMap,
  filter,
  finalize,
  from,
  mergeMap,
  of,
  startWith,
  take,
  takeUntil,
  tap,
  toArray,
} from 'rxjs'
import { ActionState } from 'seer2-pet-animator'
import { computed, onMounted, onUnmounted, provide, ref, useTemplateRef, nextTick, watch, type Ref } from 'vue'

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}
const panelState = ref<PanelState>(PanelState.SKILLS)

// 定义一个更精确的类型，用于 handleCombatEventMessage，确保消息有 target
type CombatEventMessageWithTarget = Extract<
  BattleMessage,
  | { type: BattleMessageType.SkillMiss; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.Damage; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.DamageFail; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.Heal; data: { target: petId; [key: string]: any } }
>

type AnimationEvents = {
  'attack-hit': 'left' | 'right'
  'animation-complete': 'left' | 'right'
}

const emitter = mitt<AnimationEvents>()

const store = useBattleStore()
const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()
const gameSettingStore = useGameSettingStore()

useMusic()

provide(logMessagesKey, store.log)
provide(markMapKey, store.markMap)
provide(skillMapKey, store.skillMap)
provide(petMapKey, store.petMap)
provide(playerMapKey, store.playerMap)
const battleViewRef = useTemplateRef('battleViewRef')
const leftPetRef = useTemplateRef('leftPetRef')
const rightPetRef = useTemplateRef('rightPetRef')
const leftStatusRef = useTemplateRef('leftStatusRef')
const rightStatusRef = useTemplateRef('rightStatusRef')
const leftStatusRefBounding = useElementBounding(leftStatusRef)
const rightStatusRefBounding = useElementBounding(rightStatusRef)
const battleRefBounding = useElementBounding(battleViewRef)
const isPending = ref(false)
const showBattleEndUI = ref(false)
const showKoBanner = ref(false) // 新增：控制KO横幅显示
const koBannerRef = useTemplateRef('koBannerRef') // 新增：KO横幅的模板引用

// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.battleState?.marks ?? [])
const currentTurn = computed(() => store.battleState?.currentTurn ?? 0)

const {
  showMissMessage,
  showAbsorbMessage,
  showDamageMessage,
  showHealMessage,
  showUseSkillMessage,
  cleanup: cleanupBattleAnimations,
} = useBattleAnimations(
  leftStatusRefBounding,
  rightStatusRefBounding,
  battleRefBounding,
  battleViewRef as Ref<HTMLElement | null>,
  store,
  currentPlayer,
  opponentPlayer,
)

const leftPetSpeciesNum = computed(
  () =>
    gameDataStore.getSpecies(
      currentPlayer.value?.team?.filter(p => p.id === currentPlayer.value!.activePet)[0]?.speciesID ?? '',
    )?.num ?? 0,
)
const rightPetSpeciesNum = computed(
  () =>
    gameDataStore.getSpecies(
      opponentPlayer.value?.team?.filter(p => p.id === opponentPlayer.value!.activePet)[0]?.speciesID ?? '',
    )?.num ?? 0,
)

const allTeamMemberSpritesNum = computed<number[]>(() => {
  const allMembers = [...(currentPlayer.value?.team || []), ...(opponentPlayer.value?.team || [])]
  return allMembers.map(pet => gameDataStore.getSpecies(pet.speciesID)?.num || 0)
})

const allSkillId = computed(() =>
  store.battleState?.players
    .map(p => p.team)
    .flat()
    .filter(p => p !== undefined)
    .map(p => p.skills ?? [])
    .flat()
    .map(s => s.baseId),
)
const { playSkillSound, playPetSound, playVictorySound } = useSound(allSkillId, allTeamMemberSpritesNum)

const background = computed(() => {
  if (gameSettingStore.background === 'random') {
    return Object.values(resourceStore.background.byId)[
      Math.floor(Math.random() * resourceStore.background.allIds.length)
    ]
  }
  return (
    resourceStore.getBackGround(gameSettingStore.background) ??
    'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battleBackground/grass.png'
  )
})

const availableSkills = computed<SkillMessage[]>(() => {
  return store.getPetById(currentPlayer.value!.activePet)?.skills?.filter(skill => !skill.isUnknown) ?? []
})

const handleSkillClick = (skillId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handlePetSelect = (petId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'switch-pet' && a.pet === petId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handleEscape = () => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'surrender')
  if (action) store.sendplayerSelection(action)
}

const battleResult = computed(() => {
  if (!store.isBattleEnd) return ''
  return store.victor === store.playerId ? '胜利！🎉' : store.victor ? '失败...💔' : '平局'
})

const isSkillAvailable = (skillId: skillId) => {
  return store.availableActions?.some(a => a.type === 'use-skill' && a.skill === skillId) ?? false
}

const isPetSwitchable = (petId: petId) => {
  return store.availableActions?.some(a => a.type === 'switch-pet' && a.pet === petId) ?? false
}

async function animatePetTransition(
  petSprite: InstanceType<typeof PetSprite> | null,
  targetX: number,
  targetOpacity: number,
  duration: number,
  ease: string,
  onCompleteCallback?: () => void,
) {
  if (petSprite && petSprite.$el && (targetOpacity === 0 ? petSprite.$el.offsetParent !== null : true)) {
    return gsap.to(petSprite.$el, {
      x: targetX,
      opacity: targetOpacity,
      duration,
      ease,
      onComplete: onCompleteCallback,
    })
  }
  return Promise.resolve()
}

async function switchPetAnimate(toPetId: petId, side: 'left' | 'right', petSwitchMessage: PetSwitchMessage) {
  const oldPetSprite = petSprites.value[side]
  const battleViewWidth = battleRefBounding.width.value
  const isLeft = side === 'left'
  const offScreenX = isLeft ? -battleViewWidth / 2 - 100 : battleViewWidth / 2 + 100
  const animationDuration = 1

  await animatePetTransition(oldPetSprite, offScreenX, 0, animationDuration, 'power2.in')
  await store.applyStateDelta(petSwitchMessage)
  await nextTick()

  const newPetSprite = petSprites.value[side]
  if (!newPetSprite || !newPetSprite.$el) {
    console.warn(`New PetSprite on side ${side} not found after state update for pet ${toPetId}`)
    return
  }

  const newPetReadyPromise = newPetSprite.ready
  if (newPetReadyPromise) {
    await newPetReadyPromise
  }

  gsap.set(newPetSprite.$el, { x: offScreenX, opacity: 0 })
  const newPetInfo = store.getPetById(toPetId)
  const newPetSpeciesNum = gameDataStore.getSpecies(newPetInfo?.speciesID ?? '')?.num ?? 0
  if (newPetSpeciesNum !== 0) {
    playPetSound(newPetSpeciesNum)
  }
  await animatePetTransition(newPetSprite, 0, 1, animationDuration, 'power2.out')
}

const petSprites = computed(() => {
  return {
    left: leftPetRef.value!,
    right: rightPetRef.value!,
  }
})

async function useSkillAnimate(messages: BattleMessage[]): Promise<void> {
  const useSkill = messages.filter(m => m.type === BattleMessageType.SkillUse)[0]
  if (!useSkill) return
  store.applyStateDelta(useSkill)

  const baseSkillId = useSkill.data.baseSkill
  const baseSkillData = gameDataStore.getSkill(baseSkillId)
  const category = store.skillMap.get(useSkill.data.skill)?.category || Category.Physical
  const side = getTargetSide(useSkill.data.user)
  const source = petSprites.value[side]

  if (!source) {
    throw new Error('找不到精灵组件')
  }

  const availableState = source.availableState
  const stateMap = new Map<Category, ActionState>([
    [Category.Physical, ActionState.ATK_PHY],
    [Category.Special, ActionState.ATK_SPE],
    [Category.Status, ActionState.ATK_BUF],
    [
      Category.Climax,
      availableState.includes(ActionState.INTERCOURSE) && baseSkillData.tags.includes('combination')
        ? ActionState.INTERCOURSE
        : availableState.includes(ActionState.ATK_POW)
          ? ActionState.ATK_POW
          : ActionState.ATK_PHY,
    ],
  ])
  const state = stateMap.get(category) || ActionState.ATK_PHY

  if (!source.availableState.includes(state)) {
    throw new Error(`无效的动画状态: ${state}`)
  }

  showUseSkillMessage(side, baseSkillId)
  source.$el.style.zIndex = 1
  source.setState(state)
  if (category === 'Climax') playSkillSound(baseSkillId)

  const hitPromise = new Promise<void>(resolve => {
    const handler = (hitSide: 'left' | 'right') => {
      if (hitSide === side) {
        emitter.off('attack-hit', handler)
        resolve()
      }
    }
    setTimeout(async () => {
      if ((await source.getState()) !== ActionState.IDLE) return
      resolve()
    }, 5000)
    emitter.on('attack-hit', handler)
  })

  const animateCompletePromise = new Promise<void>(resolve => {
    const handler = (completeSide: 'left' | 'right') => {
      if (completeSide === side) {
        emitter.off('animation-complete', handler)
        resolve()
      }
    }
    setTimeout(async () => {
      if ((await source.getState()) !== ActionState.IDLE) return
      resolve()
    }, 5000)
    emitter.on('animation-complete', handler)
  })

  await hitPromise
  if (category !== 'Climax' && !messages.some(msg => msg.type === BattleMessageType.SkillMiss))
    playSkillSound(baseSkillId)

  for (const msg of messages) {
    await store.applyStateDelta(msg)
    const combatEventTypes: BattleMessageType[] = [
      BattleMessageType.SkillMiss,
      BattleMessageType.Damage,
      BattleMessageType.DamageFail,
      BattleMessageType.Heal,
    ]
    if (combatEventTypes.includes(msg.type as BattleMessageType)) {
      handleCombatEventMessage(msg as CombatEventMessageWithTarget, true)
    }
  }

  await animateCompletePromise
  source.$el.style.zIndex = ''
}

function handleCombatEventMessage(message: CombatEventMessageWithTarget, isFromSkillSequenceContext: boolean) {
  const targetPetId = message.data.target
  const targetSide = getTargetSide(targetPetId)
  const targetPetSprite = petSprites.value[targetSide]

  if (!targetPetSprite) {
    console.warn(`Target pet sprite not found for side: ${targetSide}`, message)
    return
  }

  switch (message.type) {
    case BattleMessageType.SkillMiss:
      targetPetSprite.setState(ActionState.MISS)
      showMissMessage(targetSide)
      break
    case BattleMessageType.Damage: {
      const damageData = message.data
      if (damageData.damage === 0) {
        targetPetSprite.setState(ActionState.MISS)
        showAbsorbMessage(targetSide)
      } else {
        const targetPetInfo = store.getPetById(damageData.target)
        if (!targetPetInfo) {
          console.warn(`Target pet info not found for ID: ${damageData.target}`, message)
          return
        }
        const { currentHp, maxHp } = targetPetInfo
        const { availableState } = targetPetSprite
        const isDead = currentHp <= 0
        const isCriticalHealth = currentHp < maxHp * 0.25
        const shouldSetPetAnimationState =
          !isFromSkillSequenceContext || (isFromSkillSequenceContext && damageData.damageType !== 'Effect')

        if (shouldSetPetAnimationState) {
          if (isDead && availableState.includes(ActionState.DEAD)) {
            targetPetSprite.setState(ActionState.DEAD)
          } else if (isCriticalHealth && availableState.includes(ActionState.ABOUT_TO_DIE)) {
            targetPetSprite.setState(ActionState.ABOUT_TO_DIE)
          } else {
            targetPetSprite.setState(damageData.isCrit ? ActionState.UNDER_ULTRA : ActionState.UNDER_ATK)
          }
        }
        showDamageMessage(
          targetSide,
          damageData.damage,
          damageData.effectiveness > 1 ? 'up' : damageData.effectiveness < 1 ? 'down' : 'normal',
          damageData.isCrit,
        )
      }
      break
    }
    case BattleMessageType.DamageFail:
      targetPetSprite.setState(ActionState.MISS)
      showAbsorbMessage(targetSide)
      break
    case BattleMessageType.Heal:
      showHealMessage(targetSide, message.data.amount)
      break
    default:
      console.warn(
        'Unhandled message type in handleCombatEventMessage (should not happen with CombatEventMessageWithTarget):',
        message,
      )
  }
}

const handleAttackHit = (side: 'left' | 'right') => {
  emitter.emit('attack-hit', side)
}

const handleAnimationComplete = (side: 'left' | 'right') => {
  emitter.emit('animation-complete', side)
}

onUnmounted(() => {
  emitter.all.clear()
})

const getTargetSide = (targetPetId: string): 'left' | 'right' => {
  const isCurrentPlayerPet = currentPlayer.value?.team?.some(p => p.id === targetPetId)
  return isCurrentPlayerPet ? 'left' : 'right'
}

let messageSubscription: { unsubscribe: () => void } | null = null
const animationQueue = store.animateQueue
const animating = ref(false)
const sequenceId = ref(-1)

const animatesubscribe = animationQueue
  .pipe(
    concatMap(task =>
      from(task()).pipe(
        tap(() => {
          animating.value = true
        }),
        finalize(() => {
          animating.value = false
        }),
        catchError(err => {
          console.error('动画执行失败:', err)
          return of(null)
        }),
      ),
    ),
  )
  .subscribe()

const preloadPetSprites = () => {
  allTeamMemberSpritesNum.value.forEach(num => {
    const img = new Image()
    img.src = `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-pet-preview@master/public/fight/${num}.swf`
  })
}

async function animatePetEntry(
  petSprite: InstanceType<typeof PetSprite> | null,
  initialX: number,
  targetX: number,
  duration: number,
  onCompleteCallback?: () => void,
) {
  if (petSprite && petSprite.$el) {
    gsap.set(petSprite.$el, { x: initialX, opacity: 0 })
    return animatePetTransition(petSprite, targetX, 1, duration, 'power2.out', onCompleteCallback)
  }
  return Promise.resolve()
}

async function initialPetEntryAnimation() {
  const leftPet = petSprites.value.left
  const rightPet = petSprites.value.right
  const battleViewWidth = battleRefBounding.width.value
  const animationDuration = 1
  const animations = []

  if (leftPet && leftPet.$el) {
    if (leftPetSpeciesNum.value !== 0) {
      playPetSound(leftPetSpeciesNum.value)
    }

    // Check if PRESENT state is available, use setState animation instead of translation
    if (leftPet.availableState.includes(ActionState.PRESENT)) {
      animations.push(leftPet.setState(ActionState.PRESENT))
    } else {
      animations.push(animatePetEntry(leftPet, -battleViewWidth / 2 - 100, 0, animationDuration))
    }
  }
  if (rightPet && rightPet.$el) {
    if (rightPetSpeciesNum.value !== 0) {
      playPetSound(rightPetSpeciesNum.value)
    }

    // Check if PRESENT state is available, use setState animation instead of translation
    if (rightPet.availableState.includes(ActionState.PRESENT)) {
      animations.push(rightPet.setState(ActionState.PRESENT))
    } else {
      animations.push(animatePetEntry(rightPet, battleViewWidth / 2 + 100, 0, animationDuration))
    }
  }
  await Promise.all(animations)
}

onMounted(async () => {
  preloadPetSprites()
  messageSubscription = store._messageSubject
    .pipe(
      concatMap(msg => {
        if (msg.type === BattleMessageType.SkillUse) {
          return store._messageSubject.pipe(
            startWith(msg),
            takeUntil(
              store._messageSubject.pipe(
                filter(
                  (endMsg): endMsg is SkillUseEndMessage =>
                    endMsg.type === BattleMessageType.SkillUseEnd && endMsg.data.user === msg.data.user,
                ),
                take(1),
              ),
            ),
            toArray(),
            mergeMap(messages => {
              const task = async () => {
                if (sequenceId.value >= (msg.sequenceId ?? -1)) return
                await useSkillAnimate(messages)
                sequenceId.value = Math.max(sequenceId.value, messages[messages.length - 1].sequenceId ?? -1)
              }
              return of(task)
            }),
          )
        }
        const task = async () => {
          if (sequenceId.value >= (msg.sequenceId ?? -1)) return

          if (msg.type === BattleMessageType.PetSwitch) {
            // 对于 PetSwitch，状态更新由 switchPetAnimate 内部精确控制时机
            await switchPetAnimate(msg.data.toPet, getTargetSide(msg.data.toPet), msg as PetSwitchMessage)
          } else {
            // 对于其他所有消息，先应用状态变更
            await store.applyStateDelta(msg)

            const combatEventTypes: BattleMessageType[] = [
              BattleMessageType.SkillMiss,
              BattleMessageType.Damage,
              BattleMessageType.DamageFail,
              BattleMessageType.Heal,
            ]
            if (combatEventTypes.includes(msg.type as BattleMessageType)) {
              handleCombatEventMessage(msg as CombatEventMessageWithTarget, false)
            } else {
              // 处理其他非战斗事件相关的消息 (PetSwitch 已在上面单独处理)
              switch (msg.type) {
                case BattleMessageType.TurnAction:
                  panelState.value = PanelState.SKILLS
                  break
                case BattleMessageType.ForcedSwitch:
                  // 确保 msg.data 和 msg.data.player 存在
                  if (
                    msg.data &&
                    'player' in msg.data &&
                    Array.isArray(msg.data.player) &&
                    !msg.data.player.some(p => p === currentPlayer.value?.id)
                  )
                    break
                  panelState.value = PanelState.PETS
                  break
                case BattleMessageType.FaintSwitch:
                  // 确保 msg.data 和 msg.data.player 存在
                  if (msg.data && 'player' in msg.data && !(msg.data.player === currentPlayer.value?.id)) break
                  panelState.value = PanelState.PETS
                  break
                // PetSwitch 类型的消息已在外部 if 条件中处理
                default:
                  // 其他消息类型，如果它们不直接触发战斗动画或UI，则仅应用状态（已在上方完成）
                  break
              }
            }
          }
          sequenceId.value = Math.max(sequenceId.value, msg.sequenceId ?? -1)
        }
        return of(task)
      }),
    )
    .subscribe(task => animationQueue.next(task))

  const leftReadyPromise = leftPetRef.value?.ready
  const rightReadyPromise = rightPetRef.value?.ready
  const promisesToWaitFor: Promise<void>[] = []
  if (leftReadyPromise) {
    promisesToWaitFor.push(leftReadyPromise.catch(() => {}))
  }
  if (rightReadyPromise) {
    promisesToWaitFor.push(rightReadyPromise.catch(() => {}))
  }
  if (promisesToWaitFor.length > 0) {
    await Promise.all(promisesToWaitFor)
  }

  await store.ready()
  await initialPetEntryAnimation()
})

onUnmounted(() => {
  messageSubscription?.unsubscribe()
  animatesubscribe.unsubscribe()
  cleanupBattleAnimations()
  emitter.all.clear()
})

watch(
  () => store.isBattleEnd,
  async (newVal, oldVal) => {
    if (newVal && !oldVal) {
      const victor = store.victor
      const leftPet = petSprites.value.left
      const rightPet = petSprites.value.right
      const isVictor = store.victor === store.playerId

      if (victor === null) {
        if (leftPet && leftPet.availableState.includes(ActionState.DEAD)) leftPet.setState(ActionState.DEAD)
        if (rightPet && rightPet.availableState.includes(ActionState.DEAD)) rightPet.setState(ActionState.DEAD)
      } else if (isVictor) {
        if (leftPet && leftPet.availableState.includes(ActionState.WIN)) leftPet.setState(ActionState.WIN)
        if (rightPet && rightPet.availableState.includes(ActionState.DEAD)) rightPet.setState(ActionState.DEAD)
      } else {
        if (leftPet && leftPet.availableState.includes(ActionState.DEAD)) leftPet.setState(ActionState.DEAD)
        if (rightPet && rightPet.availableState.includes(ActionState.WIN)) rightPet.setState(ActionState.WIN)
      }

      showKoBanner.value = true
      playVictorySound()
      await nextTick()

      if (koBannerRef.value) {
        const tl = gsap.timeline({
          onComplete: () => {
            showKoBanner.value = false
            setTimeout(() => {
              showBattleEndUI.value = true
            }, 500)
          },
        })
        gsap.set(koBannerRef.value, { opacity: 0, scale: 0.8, xPercent: -50, yPercent: -50 })
        tl.to(koBannerRef.value, {
          opacity: 1,
          scale: 1,
          xPercent: -50,
          yPercent: -50,
          duration: 0.3,
          ease: 'power2.out',
        })
          .to(koBannerRef.value, { duration: 1.5 })
          .to(koBannerRef.value, {
            opacity: 0,
            scale: 0.8,
            xPercent: -50,
            yPercent: -50,
            duration: 0.3,
            ease: 'power2.in',
          })
      } else {
        setTimeout(() => {
          showBattleEndUI.value = true
        }, 2000)
      }
    }
  },
)
</script>

<template>
  <div class="h-screen bg-[#1a1a2e] flex justify-center items-center">
    <div
      ref="battleViewRef"
      class="w-[1600px] relative flex justify-center aspect-video items-center object-contain bg-gray-900"
    >
      <img
        v-show="showKoBanner"
        ref="koBannerRef"
        src="/ko.png"
        alt="KO Banner"
        class="absolute left-1/2 top-1/2 z-[1000] max-w-[80%] max-h-[80%] object-contain"
      />
      <div
        class="relative h-full flex flex-col bg-center bg-no-repeat aspect-video overflow-hidden"
        :class="[background ? `bg-cover` : 'bg-gray-900', 'overflow-hidden', 'transition-all duration-300 ease-in-out']"
        :style="{
          backgroundImage: background ? `url(${background})` : 'none',
          backgroundSize: background ? 'auto 100%' : 'auto',
        }"
      >
        <div class="flex justify-between p-5">
          <BattleStatus ref="leftStatusRef" class="w-1/3" :player="currentPlayer!" side="left" />
          <BattleStatus ref="rightStatusRef" class="w-1/3" :player="opponentPlayer!" side="right" />
        </div>

        <div class="flex flex-col items-center gap-2 py-2">
          <div class="text-white text-xl font-bold">
            {{
              i18next.t('turn', {
                ns: 'battle',
              })
            }}
            {{ currentTurn || 1 }}
          </div>
          <div class="absolute flex gap-2">
            <Mark v-for="mark in globalMarks" :key="mark.id" :mark="mark" />
          </div>
        </div>

        <div class="flex-grow flex justify-around items-center relative">
          <div class="absolute h-full w-full">
            <PetSprite
              v-if="leftPetSpeciesNum !== 0"
              ref="leftPetRef"
              :num="leftPetSpeciesNum"
              class="absolute"
              @hit="handleAttackHit('left')"
              @animate-complete="handleAnimationComplete('left')"
            />
          </div>
          <div class="absolute h-full w-full">
            <PetSprite
              v-if="rightPetSpeciesNum !== 0"
              ref="rightPetRef"
              :num="rightPetSpeciesNum"
              :reverse="true"
              class="absolute"
              @hit="handleAttackHit('right')"
              @animate-complete="handleAnimationComplete('right')"
            />
          </div>
        </div>

        <div class="flex h-1/5 flex-none">
          <div class="w-1/5 h-full p-2">
            <BattleLogPanel />
          </div>

          <div class="flex-1 h-full">
            <div class="h-full grid grid-cols-5 gap-2" v-show="panelState === PanelState.SKILLS">
              <template
                v-for="(skill, index) in availableSkills.filter(s => s.category !== Category.Climax)"
                :key="'normal-' + skill.id"
              >
                <SkillButton
                  :skill="skill"
                  @click="handleSkillClick(skill.id)"
                  :disabled="!isSkillAvailable(skill.id) || isPending"
                  :style="{ 'grid-column-start': index + 1 }"
                />
              </template>
              <template
                v-for="(skill, index) in availableSkills.filter(s => s.category === Category.Climax)"
                :key="'climax-' + skill.id"
              >
                <SkillButton
                  :skill="skill"
                  @click="handleSkillClick(skill.id)"
                  :disabled="!isSkillAvailable(skill.id) || isPending"
                  :style="{ 'grid-column-start': 5 - index }"
                  class="justify-self-end"
                />
              </template>
            </div>

            <div class="grid grid-cols-6 gap-2 h-full" v-show="panelState === PanelState.PETS">
              <PetButton
                v-for="pet in currentPlayer!.team"
                :key="pet.id"
                :pet="pet"
                :disabled="!isPetSwitchable(pet.id) || isPending"
                @click="handlePetSelect"
                position="bottom"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 p-2 w-1/5 flex-none h-full">
            <button
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
              @click="panelState = PanelState.SKILLS"
            >
              {{
                i18next.t('fight', {
                  ns: 'battle',
                })
              }}
            </button>
            <button
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
              @click="panelState = PanelState.PETS"
            >
              {{
                i18next.t('switch', {
                  ns: 'battle',
                })
              }}
            </button>
            <button
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold disabled:bg-gray-700 disabled:text-gray-400 disabled:border-gray-500 disabled:cursor-not-allowed"
              :disabled="!store.availableActions.find(a => a.type === 'do-nothing')"
              @click="store.sendplayerSelection(store.availableActions.find(a => a.type === 'do-nothing')!)"
            >
              {{ i18next.t('do-nothing', { ns: 'battle' }) }}
            </button>
            <button
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold disabled:bg-gray-700 disabled:text-gray-400 disabled:border-gray-500 disabled:cursor-not-allowed"
              :disabled="!store.availableActions.find(a => a.type === 'surrender')"
              @click="handleEscape"
            >
              {{
                i18next.t('surrunder', {
                  ns: 'battle',
                })
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <Transition name="fade">
      <div v-if="showBattleEndUI" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
        <div
          class="bg-gradient-to-br from-[#2a2a4a] to-[#1a1a2e] p-8 rounded-2xl shadow-[0_0_30px_rgba(81,65,173,0.4)] text-center"
        >
          <h2 class="text-5xl mb-4 text-white [text-shadow:_0_0_20px_#fff]">{{ battleResult }}</h2>
          <div class="flex gap-4 mt-8">
            <button
              class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
              @click="$router.push({ name: 'Lobby', query: { startMatching: 'true' } })"
            >
              重新匹配
            </button>
            <button
              class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
              @click="$router.push('/')"
            >
              返回大厅
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style>
/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.bg-battle-gradient {
  background: linear-gradient(145deg, #2a2a4a 0%, #1a1a2e 100%);
}

/* 战斗结果浮动动画 */
@keyframes float {
  0%,
  100% {
    transform: translateY(-50%) translateY(0);
  }
  50% {
    transform: translateY(-50%) translateY(-20px);
  }
}

.float-animation {
  animation: float 2s ease-in-out infinite;
}
</style>
