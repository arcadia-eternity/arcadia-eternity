<script setup lang="ts">
import BattleStatus from '@/components/BattleStatus.vue'
import Pet from '@/components/Pet.vue'
import SkillButton from '@/components/SkillButton.vue'
import type { Element, Category } from '@test-battle/const'

defineProps<{
  background?: string
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
  <div
    class="relative w-screen h-screen flex flex-col"
    :style="
      background
        ? { backgroundImage: `url(${background})`, backgroundSize: 'cover' }
        : { backgroundColor: 'rgb(31 41 55)' }
    "
  >
    <!-- 顶部状态栏 -->
    <div class="flex justify-between p-5">
      <BattleStatus :player="leftPlayer" side="left" />
      <BattleStatus :player="rightPlayer" side="right" />
    </div>

    <!-- 中部立绘区域 -->
    <div class="flex-grow flex justify-around items-center">
      <Pet :num="leftPlayer.currentPet.speciesNum" class="w-[300px] h-[300px]" />
      <Pet :num="rightPlayer.currentPet.speciesNum" :reverse="true" class="w-[300px] h-[300px]" />
    </div>

    <!-- 底部技能按钮 -->
    <div class="flex justify-around p-5 bg-black bg-opacity-50">
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
</template>
