<script setup lang="ts">
import { ref } from 'vue'
import BattleStatus from '@/components/BattleStatus.vue'
import Pet from '@/components/Pet.vue'
import SkillButton from '@/components/SkillButton.vue'
import Mark from '@/components/Mark.vue'
import BattleLogPanel from '@/components/BattleLogPanel.vue'
import { useBattleLogViewModel } from '@/viewModels/battleLogViewModel'
import type { Element, Category } from '@test-battle/const'
import type { BattleMessage, MarkMessage, PetMessage, PlayerMessage, SkillMessage } from '@test-battle/const'

const messages = ref<BattleMessage[]>([])
const petData = ref<Map<string, PetMessage>>(new Map())
const skillData = ref<Map<string, SkillMessage>>(new Map())
const playerData = ref<Map<string, PlayerMessage>>(new Map())
const markData = ref<Map<string, MarkMessage>>(new Map())

const { formattedMessages, clearMessages, logContainerRef } = useBattleLogViewModel(
  messages.value,
  petData.value,
  skillData.value,
  playerData.value,
  markData.value,
)

defineProps<{
  background?: string
  turns?: number
  leftPlayer: {
    name: string
    rage: number
    currentPet: {
      level: number
      name: string
      speciesNum: number
      currentHp: number
      maxHp: number
      element: Element
      marks?: {
        id: string
        name: string
        stack?: number
        duration?: number
        description?: string
        image?: string
      }[]
    }
  }
  rightPlayer: {
    name: string
    rage: number
    currentPet: {
      level: number
      name: string
      speciesNum: number
      currentHp: number
      maxHp: number
      element: Element
      marks?: {
        id: string
        name: string
        stack?: number
        duration?: number
        description?: string
        image?: string
      }[]
    }
  }
  globalMarks?: {
    id: string
    name: string
    stack?: number
    duration?: number
    description?: string
    image?: string
  }[]
  skills: {
    element: Element
    category: Category
    power: number
    rage: number
    accuracy: number
    name: string
    description: string
    id: string
  }[]
}>()

const emit = defineEmits<{
  (e: 'skill-click', skillId: string): void
}>()
</script>

<template>
  <div class="relative w-screen h-screen flex justify-center items-center bg-gray-900">
    <div
      class="relative w-full max-w-[1600px] h-full max-h-[900px] flex flex-col bg-center bg-no-repeat aspect-video"
      :class="[background ? `bg-cover` : 'bg-gray-900', 'overflow-hidden', 'transition-all duration-300 ease-in-out']"
      :style="{
        backgroundImage: background ? `url(${background})` : 'none',
        backgroundSize: background ? 'auto 100%' : 'auto',
      }"
    >
      <!-- 顶部状态栏 -->
      <div class="flex justify-between p-5">
        <BattleStatus :player="leftPlayer" side="left" />
        <BattleStatus :player="rightPlayer" side="right" />
      </div>

      <!-- 回合信息和全局印记 -->
      <div class="flex flex-col items-center gap-2 py-2">
        <div class="text-white text-xl font-bold">回合 1</div>
        <div class="flex gap-2">
          <Mark
            v-for="mark in globalMarks"
            :key="mark.id"
            :image="mark.image || '/images/default-mark.png'"
            :name="mark.name"
            :stack="mark.stack"
            :duration="mark.duration || -1"
            :description="mark.description || ''"
          />
        </div>
      </div>

      <!-- 中部立绘区域 -->
      <div class="flex-grow flex justify-around items-center">
        <div class="relative">
          <div
            class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-[120px] h-[20px] rounded-full bg-black bg-opacity-30 blur-md"
          ></div>
          <Pet :num="leftPlayer.currentPet.speciesNum" class="w-[200px] h-[200px]" />
        </div>
        <div class="relative">
          <div
            class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-[120px] h-[20px] rounded-full bg-black bg-opacity-30 blur-md"
          ></div>
          <Pet :num="rightPlayer.currentPet.speciesNum" :reverse="true" class="w-[200px] h-[200px]" />
        </div>
      </div>

      <!-- 底部区域 -->
      <div class="flex">
        <!-- 战斗日志 -->
        <div class="w-1/3 p-2">
          <BattleLogPanel
            :formattedMessages="formattedMessages"
            :clearMessages="clearMessages"
            :logContainerRef="logContainerRef"
          />
        </div>

        <!-- 技能按钮 -->
        <div class="flex-1 flex justify-around p-5 bg-black/50">
          <SkillButton
            v-for="(skill, index) in skills"
            :key="index"
            :element="skill.element"
            :category="skill.category"
            :power="skill.power"
            :rage="skill.rage"
            :accuracy="skill.accuracy"
            :name="skill.name"
            :description="skill.description"
            :id="skill.id"
            @click="emit('skill-click', skill.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
