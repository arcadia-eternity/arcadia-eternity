<script setup lang="ts">
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import DamageDisplay from '@/components/battle/DamageDisplay.vue'
import Mark from '@/components/battle/Mark.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { logMessagesKey, markMapKey, petMapKey, playerMapKey, skillMapKey } from '@/symbol/battlelog'
import type { DamageMessage, SkillUseEndMessage, SkillUseMessage } from '@test-battle/const'
import { BattleMessageType, Category, type petId, type skillId, type SkillMessage } from '@test-battle/const'
import { useElementBounding } from '@vueuse/core'
import gsap from 'gsap'
import i18next from 'i18next'
import mitt from 'mitt'
import { catchError, concatMap, filter, finalize, from, of, Subject, take, tap, toArray, windowToggle } from 'rxjs'
import { ActionState } from 'seer2-pet-animator'
import { computed, h, onMounted, onUnmounted, provide, ref, render, useTemplateRef } from 'vue'

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}
const panelState = ref<PanelState>(PanelState.SKILLS)

type AnimationEvents = {
  'attack-hit': 'left' | 'right'
  'animation-complete': 'left' | 'right'
}

const emitter = mitt<AnimationEvents>()

const store = useBattleStore()
const gameDataStore = useGameDataStore()

// 提供战斗日志相关数据给子组件
provide(logMessagesKey, store.log)
provide(markMapKey, store.markMap)
provide(skillMapKey, store.skillMap)
provide(petMapKey, store.petMap)
provide(playerMapKey, store.playerMap)
const leftPetRef = useTemplateRef('leftPetRef')
const rightPetRef = useTemplateRef('rightPetRef')
const leftStatusRef = useTemplateRef('leftStatusRef')
const rightStatusRef = useTemplateRef('rightStatusRef')
const isPending = ref(false)

// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.state?.marks ?? [])
const currentTurn = computed(() => store.state?.currentTurn ?? 0)
const leftPetSpeciesNum = computed(() => gameDataStore.getSpecies(currentPlayer.value!.activePet.speciesID)?.num ?? 0)
const rightPetSpeciesNum = computed(() => gameDataStore.getSpecies(opponentPlayer.value!.activePet.speciesID)?.num ?? 0)
const background = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battleBackground/grass.png'

// 当前玩家可用技能
const availableSkills = computed<SkillMessage[]>(() => {
  return store.currentPlayer?.activePet?.skills?.filter(skill => !skill.isUnknown) ?? []
})

// 处理技能点击
const handleSkillClick = (skillId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

// 处理换宠
const handlePetSelect = (petId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'switch-pet' && a.pet === petId)
  if (action) store.sendplayerSelection(action)
}

// 处理投降
const handleEscape = () => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'surrender')
  if (action) store.sendplayerSelection(action)
}

// 战斗结果计算
const battleResult = computed(() => {
  if (!store.isBattleEnd) return ''
  return store.victor === store.playerId ? '胜利！🎉' : store.victor ? '失败...💔' : '平局'
})

const isSkillAvailable = (skillId: skillId) => {
  return store.availableActions?.some(a => a.type === 'use-skill' && a.skill === skillId) ?? false
}

// 检查宠物是否可切换
const isPetSwitchable = (petId: petId) => {
  return store.availableActions?.some(a => a.type === 'switch-pet' && a.pet === petId) ?? false
}

const battleViewRef = ref<HTMLElement | null>(null)

const showMissMessage = (side: 'left' | 'right') => {
  // 获取状态面板元素
  console.log(side)
  const statusElement = side === 'left' ? leftStatusRef.value : rightStatusRef.value
  if (!statusElement) return

  // 计算起始位置（状态面板下方居中）
  const { bottom, left, width } = useElementBounding(statusElement)
  const startX = left.value + width.value / 2
  const startY = bottom.value + 120

  // 创建动画容器
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = `${startX}px`
  container.style.top = `${startY}px`
  container.style.transformOrigin = 'center center'
  container.style.pointerEvents = 'none'
  document.body.appendChild(container)

  // 创建miss图片元素
  const missImg = document.createElement('img')
  missImg.src = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/damage/miss.png'
  missImg.className = 'h-20'
  container.appendChild(missImg)

  // 初始状态
  gsap.set(container, {
    scale: 1,
    opacity: 0,
  })

  // 创建时间轴动画
  const tl = gsap.timeline({
    onComplete: () => {
      document.body.removeChild(container)
    },
  })

  // 第一阶段：淡入 (0.3秒)
  tl.to(container, {
    y: -125,
    opacity: 1,
    duration: 0.3,
    ease: 'power2.out',
  })

  // 第二阶段：停留1秒
  tl.to({}, { duration: 0.5 })

  // 第三阶段：淡出 (0.5秒)
  tl.to(container, {
    opacity: 0,
    duration: 0.5,
    ease: 'power2.out',
  })
}

const showAbsorbMessage = (side: 'left' | 'right') => {
  // 获取状态面板元素
  const statusElement = side === 'left' ? leftStatusRef.value : rightStatusRef.value
  if (!statusElement) return

  // 计算起始位置（状态面板下方居中）
  const { bottom, left, width } = useElementBounding(statusElement)
  const startX = left.value + width.value / 2
  const startY = bottom.value + 120

  // 创建动画容器
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = `${startX}px`
  container.style.top = `${startY}px`
  container.style.transformOrigin = 'center center'
  container.style.pointerEvents = 'none'
  document.body.appendChild(container)

  // 创建absorb图片元素
  const absorbImg = document.createElement('img')
  absorbImg.src = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/damage/absorb.png'
  absorbImg.className = 'h-20'
  container.appendChild(absorbImg)

  // 初始状态
  gsap.set(container, {
    scale: 1,
    opacity: 0,
  })

  // 创建时间轴动画
  const tl = gsap.timeline({
    onComplete: () => {
      document.body.removeChild(container)
    },
  })

  // 第一阶段：淡入 (0.3秒)
  tl.to(container, {
    y: -125,
    opacity: 1,
    duration: 0.3,
    ease: 'power2.out',
  })

  // 第二阶段：停留1秒
  tl.to({}, { duration: 0.5 })

  // 第三阶段：淡出 (0.5秒)
  tl.to(container, {
    opacity: 0,
    duration: 0.5,
    ease: 'power2.out',
  })
}

const flashAndShake = () => {
  const flash = document.createElement('div')
  flash.style.position = 'absolute'
  flash.style.top = '0'
  flash.style.left = '0'
  flash.style.width = '100%'
  flash.style.height = '100%'
  flash.style.backgroundColor = 'white'
  flash.style.opacity = '0'
  flash.style.pointerEvents = 'none'
  flash.style.zIndex = '100'
  battleViewRef.value?.appendChild(flash)

  gsap.to(flash, {
    opacity: 0.7,
    duration: 0.1,
    ease: 'power2.out',
    onComplete: () => {
      gsap.to(flash, {
        opacity: 0,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
          battleViewRef.value?.removeChild(flash)
        },
      })
    },
  })
}

const showDamageMessage = (
  side: 'left' | 'right',
  value: number,
  effectiveness: 'up' | 'normal' | 'down' = 'normal',
  crit: boolean = false,
) => {
  // 获取状态面板元素
  const statusElement = side === 'left' ? leftStatusRef.value : rightStatusRef.value
  if (!statusElement) return

  // 获取当前侧Pet的最大血量
  const currentPet = side === 'left' ? currentPlayer.value!.activePet : opponentPlayer.value!.activePet

  const { bottom, left, width } = useElementBounding(statusElement)
  const startX = left.value + width.value / 2
  const startY = bottom.value + 120 // 状态面板下方20px

  const hpRatio = value / currentPet.maxHp

  if ((hpRatio > 0.25 || crit) && battleViewRef.value) {
    const shakeIntensity = 5 + Math.random() * 10 // 5-15之间的随机强度
    const shakeAngle = Math.random() * Math.PI * 2 // 随机角度
    const shakeX = Math.cos(shakeAngle) * shakeIntensity
    const shakeY = Math.sin(shakeAngle) * shakeIntensity

    gsap.to(battleViewRef.value, {
      x: shakeX,
      y: shakeY,
      duration: 0.05,
      repeat: 5,
      yoyo: true,
      ease: 'power1.inOut',
    })
  }

  // 如果伤害超过最大血量1/2，添加白屏闪屏效果
  if (hpRatio > 0.5 && battleViewRef.value) {
    flashAndShake()
  }

  // 使用已计算的状态面板下方位置
  // 创建动画容器
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = `${startX}px`
  container.style.top = `${startY}px`
  container.style.transformOrigin = 'center center'
  container.style.pointerEvents = 'none'
  document.body.appendChild(container)

  // 渲染DamageDisplay组件
  const damageVNode = h(DamageDisplay, {
    value,
    type: effectiveness === 'up' ? 'red' : effectiveness === 'down' ? 'blue' : '',
    class: 'overflow-visible',
  })
  render(damageVNode, container)

  // 动画参数
  const moveX = side === 'left' ? 300 : -300 // 水平偏移量
  const baseScale = crit ? 1.5 : 1
  const targetScale = crit ? 2.5 : 1.8

  // 初始状态
  gsap.set(container, {
    scale: baseScale,
    opacity: 1,
  })

  // 创建时间轴动画
  const tl = gsap.timeline({
    onComplete: () => {
      document.body.removeChild(container)
      render(null, container) // 清理VNode
    },
  })

  // 第一阶段：移动并放大 (0.5秒)
  tl.to(container, {
    x: moveX,
    y: -150,
    scale: targetScale,
    duration: 0.25,
    ease: 'power2.out',
  })

  // 第二阶段：停留1秒
  tl.to({}, { duration: 0.5 })

  // 第三阶段：淡出 (0.5秒)
  tl.to(container, {
    opacity: 0,
    duration: 0.5,
    ease: 'power2.out',
  })
}

const showUseSkillMessage = (side: 'left' | 'right', baseSkillId: string) => {
  // 获取BattleStatus的DOM元素
  const statusElement = side === 'left' ? leftStatusRef.value : rightStatusRef.value
  if (!statusElement) return

  // 计算目标位置（BattleStatus下方）
  const { width, bottom } = useElementBounding(statusElement)
  const { left: viewLeft, right: viewRight } = useElementBounding(battleViewRef)
  if (!viewLeft || !viewRight) return
  const targetX = side === 'left' ? viewLeft.value : viewRight.value - width.value * 0.75
  const targetY = bottom.value + 20

  // 创建动画容器
  const container = document.createElement('div')
  container.className = 'fixed pointer-events-none'
  container.style.left = `${targetX}px`
  container.style.top = `${targetY}px`
  container.style.transformOrigin = 'center center'
  document.body.appendChild(container)

  const box = document.createElement('div')
  box.className = 'h-[60px] flex justify-center items-center font-bold text-lg text-white'
  box.style.backgroundImage =
    side === 'left'
      ? 'linear-gradient(to right, rgba(0,0,0,0.8), rgba(0,0,0,0.3))'
      : 'linear-gradient(to left, rgba(0,0,0,0.8), rgba(0,0,0,0.3))'
  box.style.padding = '15px 0'
  box.style.left = '0'
  box.style.width = `${width.value * 0.75}px` // petStatus的3/4宽
  const skillName = i18next.t(`${baseSkillId}.name`, { ns: 'skill' })
  box.textContent = skillName

  container.appendChild(box)

  // 初始状态 - 从侧边开始
  const startX = side === 'left' ? -200 : 200
  gsap.set(container, {
    x: startX,
    opacity: 0,
    scale: 0.8,
  })

  // 创建时间轴动画
  const tl = gsap.timeline({
    onComplete: () => {
      document.body.removeChild(container)
    },
  })

  // 第一阶段：从侧边弹入
  tl.to(container, {
    x: 0,
    opacity: 1,
    scale: 1,
    duration: 0.3,
    ease: 'back.out(1.7)',
  })

  // 第二阶段：停留1秒
  tl.to({}, { duration: 1 })

  // 第三阶段：向同侧弹出
  tl.to(container, {
    x: startX,
    opacity: 0,
    duration: 0.5,
    ease: 'power2.in',
  })
}

async function useSkillAnimate(
  baseSkillId: string,
  category: Category,
  results: Array<{
    type: 'damage' | 'miss' | 'heal'
    targetSide: 'left' | 'right'
    value?: number
    effectiveness?: 'up' | 'normal' | 'down'
    crit?: boolean
  }>,
  side: 'left' | 'right',
  specialState?: ActionState,
): Promise<void> {
  const petSprites = {
    left: leftPetRef.value!,
    right: rightPetRef.value!,
  }
  // 参数校验
  const stateMap = new Map<Category, ActionState>([
    [Category.Physical, ActionState.ATK_PHY],
    [Category.Special, ActionState.ATK_SPE],
    [Category.Status, ActionState.ATK_BUF],
    [
      Category.Climax,
      petSprites[side].availableState.includes(ActionState.ATK_POW) ? ActionState.ATK_POW : ActionState.ATK_PHY,
    ],
  ])

  const state = specialState || stateMap.get(category) || ActionState.ATK_PHY

  const source = petSprites[side]

  if (!source) {
    throw new Error('找不到精灵组件')
  }

  if (!source.availableState.includes(state)) {
    throw new Error(`无效的动画状态: ${state}`)
  }

  showUseSkillMessage(side, baseSkillId)
  source.$el.style.zIndex = 100

  source.setState(state)
  await new Promise<void>(resolve => {
    const handler = (hitSide: 'left' | 'right') => {
      if (hitSide === side) {
        emitter.off('attack-hit', handler)
        resolve()
      }
    }
    emitter.on('attack-hit', handler)
  })
  for (const result of results) {
    const target = petSprites[result.targetSide]
    switch (result.type) {
      case 'miss':
        target.setState(ActionState.MISS)
        showMissMessage(result.targetSide)
        break
      case 'damage':
        if (result.value === 0) {
          target.setState(ActionState.MISS)
          showAbsorbMessage(result.targetSide)
          break
        } else {
          target.setState(result.crit ? ActionState.UNDER_ULTRA : ActionState.UNDER_ATK)
          showDamageMessage(
            result.targetSide,
            result.value || 0,
            result.effectiveness || 'normal',
            result.crit || false,
          )
          break
        }
      case 'heal':
        //TODO: heal
        break
    }
  }
  await new Promise<void>(resolve => {
    const handler = (completeSide: 'left' | 'right') => {
      if (completeSide === side) {
        emitter.off('animation-complete', handler)
        resolve()
      }
    }
    emitter.on('animation-complete', handler)
  })
  source.$el.style.zIndex = ''
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

defineExpose({
  showDamageMessage,
  showMissMessage,
  showAbsorbMessage,
  showUseSkillMessage,
  useSkillAnimate,
})

// 获取目标方位置
const getTargetSide = (targetPetId: string): 'left' | 'right' => {
  const [firstPlayer, secondPlayer] = store.state?.players || []
  const isFirstPlayerPet = firstPlayer?.team?.some(p => p.id === targetPetId)
  const isSecondPlayerPet = secondPlayer?.team?.some(p => p.id === targetPetId)
  return isSecondPlayerPet ? 'right' : 'left'
}

// 消息订阅逻辑
let messageSubscription: { unsubscribe: () => void } | null = null

const animationQueue = new Subject<() => Promise<void>>()
animationQueue
  .pipe(
    // 使用 concatMap 强制顺序执行异步任务
    concatMap(task =>
      from(task()).pipe(
        // 将 Promise 转为 Observable
        tap(() => {
          console.log('任务开始')
        }),
        finalize(() => {
          console.log('任务结束')
        }),
        catchError(err => {
          console.error('动画执行失败:', err)
          return of(null) // 捕获错误后继续后续任务
        }),
      ),
    ),
  )
  .subscribe()

onMounted(() => {
  messageSubscription = store._messageSubject
    .pipe(
      // 主消息处理流程
      windowToggle(
        store._messageSubject.pipe(filter((msg): msg is SkillUseMessage => msg.type === BattleMessageType.SkillUse)),
        (openMsg: SkillUseMessage) =>
          store._messageSubject.pipe(
            filter(
              (msg): msg is SkillUseEndMessage =>
                msg.type === BattleMessageType.SkillUseEnd && msg.data.user === openMsg.data.user,
            ),
            take(1),
          ),
      ),
      concatMap(win =>
        win.pipe(
          toArray(),
          filter(messages => {
            const hasUse = messages.some(m => m.type === BattleMessageType.SkillUse)
            const hasEnd = messages.some(m => m.type === BattleMessageType.SkillUseEnd)
            return hasUse && hasEnd
          }),
          // 将动画任务推入队列
          tap(messages => {
            animationQueue.next(async () => {
              const skillUseMsg = messages.find(m => m.type === BattleMessageType.SkillUse)! as SkillUseMessage

              const damages = messages.filter((m): m is DamageMessage => m.type === BattleMessageType.Damage)

              // 执行动画并等待
              await useSkillAnimate(
                store.skillMap.get(skillUseMsg.data.skill)?.baseId || '',
                store.skillMap.get(skillUseMsg.data.skill)?.category || Category.Physical,
                damages.map(dmg => ({
                  type: 'damage',
                  targetSide: getTargetSide(dmg.data.target),
                  value: dmg.data.damage,
                  effectiveness: dmg.data.effectiveness > 1 ? 'up' : dmg.data.effectiveness < 1 ? 'down' : 'normal',
                  crit: dmg.data.isCrit,
                })),
                getTargetSide(skillUseMsg.data.user),
              )
            })
          }),
        ),
      ),
    )
    .subscribe()
})

onUnmounted(() => {
  messageSubscription?.unsubscribe()
  emitter.all.clear()
})
</script>

<template>
  <div class="h-screen bg-[#1a1a2e]">
    <!-- <Battle
      v-if="currentPlayer && opponentPlayer"
      background="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battleBackground/grass.png"
      :left-player="currentPlayer"
      :right-player="opponentPlayer"
      :skills="availableSkills"
      :global-marks="globalMarks"
      :turns="currentTurn"
      :available-actions="store.availableActions"
      :is-pending="isPending"
      @skill-click="handleSkillClick"
      @pet-select="handlePetSelect"
      @escape="handleEscape"
    >
    </Battle> -->
    <div
      ref="battleViewRef"
      class="relative h-dvh flex justify-center aspect-video items-center object-contain bg-gray-900"
    >
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
          <div class="flex gap-2">
            <Mark v-for="mark in globalMarks" :key="mark.id" :mark="mark" />
          </div>
        </div>

        <div class="flex-grow flex justify-around items-center relative">
          <div class="absolute h-full w-full">
            <PetSprite
              ref="leftPetRef"
              :num="leftPetSpeciesNum"
              class="absolute"
              @hit="handleAttackHit('left')"
              @animate-complete="handleAnimationComplete('left')"
            />
          </div>
          <div class="absolute h-full w-full">
            <PetSprite
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
            <div class="h-full grid grid-cols-5 gap-2" v-if="panelState === PanelState.SKILLS">
              <!-- 普通技能 -->
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

              <!-- Climax技能 -->
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

            <div class="grid grid-cols-6 gap-2 h-full" v-else>
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
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
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
      <div v-if="store.isBattleEnd" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
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
