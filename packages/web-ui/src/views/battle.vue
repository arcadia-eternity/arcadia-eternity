<script setup lang="ts">
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import DamageDisplay from '@/components/battle/DamageDisplay.vue'
import Mark from '@/components/battle/Mark.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import { useGameDataStore } from '@/stores/gameData'
import {
  Category,
  type MarkMessage,
  type petId,
  type PlayerMessage,
  type skillId,
  type SkillMessage,
} from '@test-battle/const'
import type { PlayerSelectionSchemaType } from '@test-battle/schema'
import { useElementBounding } from '@vueuse/core'
import gsap from 'gsap'
import i18next from 'i18next'
import { ActionState } from 'seer2-pet-animator'
import { computed, h, ref, render, useTemplateRef } from 'vue'

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}

const leftPetRef = useTemplateRef('leftPetRef')
const rightPetRef = useTemplateRef('rightPetRef')
const leftStatusRef = useTemplateRef('leftStatusRef')
const rightStatusRef = useTemplateRef('rightStatusRef')

const panelState = ref<PanelState>(PanelState.SKILLS)

interface BattleProps {
  background?: string
  leftPlayer: PlayerMessage
  rightPlayer: PlayerMessage
  skills: SkillMessage[]
  globalMarks: MarkMessage[]
  availableActions?: PlayerSelectionSchemaType[]
  turns?: number
  isPending?: boolean
}

const props = defineProps<BattleProps>()

const gameDataStore = useGameDataStore()

const handleSkillClick = (skillId: skillId) => {
  console.log('Skill clicked:', skillId)
  emit('skillClick', skillId)
}

const handleEscape = () => {
  console.log('逃跑按钮点击')
  emit('escape')
}

const handlePetSelect = (petId: petId) => {
  console.log('宠物选择:', petId)
  emit('petSelect', petId as petId)
  panelState.value = PanelState.SKILLS
}

const leftPetSpeciesNum = computed(() => gameDataStore.getSpecies(props.leftPlayer.activePet.speciesID)?.num ?? 0)
const rightPetSpeciesNum = computed(() => gameDataStore.getSpecies(props.rightPlayer.activePet.speciesID)?.num ?? 0)

const isSkillAvailable = (skillId: skillId) => {
  return props.availableActions?.some(a => a.type === 'use-skill' && a.skill === skillId) ?? false
}

// 检查宠物是否可切换
const isPetSwitchable = (petId: petId) => {
  return props.availableActions?.some(a => a.type === 'switch-pet' && a.pet === petId) ?? false
}

const emit = defineEmits<{
  skillClick: [id: skillId]
  petSelect: [petId: petId]
  escape: []
}>()

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
  const currentPet = side === 'left' ? props.leftPlayer.activePet : props.rightPlayer.activePet

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
  const skillName = i18next.t(`${baseSkillId}`, { ns: 'skill' })
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
    const handler = () => {
      resolve()
    }
    pendingHandle.value = handler
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
  // 恢复默认z-index
  await new Promise<void>(resolve => {
    const handler = () => {
      resolve()
    }
    pendingHandle.value = handler
  })
  source.$el.style.zIndex = ''
}

const pendingHandle = ref<Function | null>(null)

const hitHandle = () => {
  if (pendingHandle.value !== null) {
    pendingHandle.value()
    pendingHandle.value = null
  }
}

const animationCompleteHandle = () => {
  if (pendingHandle.value !== null) {
    pendingHandle.value()
    pendingHandle.value = null
  }
}

defineExpose({
  showDamageMessage,
  showMissMessage,
  showAbsorbMessage,
  showUseSkillMessage,
  useSkillAnimate,
})
</script>

<template>
  <div
    ref="battleViewRef"
    class="relative h-dvh flex justify-center aspect-video items-center object-contain bg-gray-900"
  >
    <div
      class="relative h-full flex flex-col bg-center bg-no-repeat aspect-video overflow-hidden"
      :class="[
        props.background ? `bg-cover` : 'bg-gray-900',
        'overflow-hidden',
        'transition-all duration-300 ease-in-out',
      ]"
      :style="{
        backgroundImage: props.background ? `url(${props.background})` : 'none',
        backgroundSize: props.background ? 'auto 100%' : 'auto',
      }"
    >
      <div class="flex justify-between p-5">
        <BattleStatus ref="leftStatusRef" class="w-1/3" :player="props.leftPlayer" side="left" />
        <BattleStatus ref="rightStatusRef" class="w-1/3" :player="props.rightPlayer" side="right" />
      </div>

      <div class="flex flex-col items-center gap-2 py-2">
        <div class="text-white text-xl font-bold">
          {{
            i18next.t('turn', {
              ns: 'battle',
            })
          }}
          {{ props.turns || 1 }}
        </div>
        <div class="flex gap-2">
          <Mark v-for="mark in props.globalMarks" :key="mark.id" :mark="mark" />
        </div>
      </div>

      <div class="flex-grow flex justify-around items-center relative">
        <div class="absolute h-full w-full">
          <PetSprite
            ref="leftPetRef"
            :num="leftPetSpeciesNum"
            class="absolute"
            @hit="hitHandle"
            @animate-complete="animationCompleteHandle"
          />
        </div>
        <div class="absolute h-full w-full">
          <PetSprite
            ref="rightPetRef"
            :num="rightPetSpeciesNum"
            :reverse="true"
            class="absolute"
            @hit="hitHandle"
            @animate-complete="animationCompleteHandle"
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
              v-for="(skill, index) in props.skills.filter(s => s.category !== Category.Climax)"
              :key="'normal-' + skill.id"
            >
              <SkillButton
                :skill="skill"
                @click="handleSkillClick(skill.id)"
                :disabled="!isSkillAvailable(skill.id) || props.isPending"
                :style="{ 'grid-column-start': index + 1 }"
              />
            </template>

            <!-- Climax技能 -->
            <template
              v-for="(skill, index) in props.skills.filter(s => s.category === Category.Climax)"
              :key="'climax-' + skill.id"
            >
              <SkillButton
                :skill="skill"
                @click="handleSkillClick(skill.id)"
                :disabled="!isSkillAvailable(skill.id) || props.isPending"
                :style="{ 'grid-column-start': 5 - index }"
                class="justify-self-end"
              />
            </template>
          </div>

          <div class="grid grid-cols-6 gap-2 h-full" v-else>
            <PetButton
              v-for="pet in props.leftPlayer.team"
              :key="pet.id"
              :pet="pet"
              :disabled="!isPetSwitchable(pet.id) || props.isPending"
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
</template>

<style scoped></style>
