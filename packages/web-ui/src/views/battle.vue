<script setup lang="ts">
import { computed, ref } from 'vue'
import BattleStatus from '@/components/BattleStatus.vue'
import Pet from '@/components/Pet.vue'
import SkillButton from '@/components/SkillButton.vue'
import Mark from '@/components/Mark.vue'
import BattleLogPanel from '@/components/BattleLogPanel.vue'
import type { MarkMessage, PlayerMessage, SkillMessage } from '@test-battle/const'
import { useGameDataStore } from '@/stores/gameData'

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}

const panelState = ref<PanelState>(PanelState.SKILLS)

interface BattleProps {
  background?: string
  leftPlayer: PlayerMessage
  rightPlayer: PlayerMessage
  skills: SkillMessage[]
  globalMarks: MarkMessage[]
  turns?: number
}

const props = defineProps<BattleProps>()

const gameDataStore = useGameDataStore()

// 技能点击处理
const handleSkillClick = (skillId: string) => {
  console.log('Skill clicked:', skillId)
  // 实际业务逻辑处理
}

// 逃跑处理
const handleEscape = () => {
  console.log('逃跑按钮点击')
  // TODO: 实现逃跑逻辑
}

// 宠物选择处理
const handlePetSelect = (petId: string) => {
  console.log('宠物选择:', petId)
  panelState.value = PanelState.SKILLS
  // TODO: 实现换宠逻辑
}

const leftPetSpeciesNum = computed(() => gameDataStore.getSpecies(props.leftPlayer.activePet.speciesID)?.num ?? 0)
const rightPetSpeciesNum = computed(() => gameDataStore.getSpecies(props.rightPlayer.activePet.speciesID)?.num ?? 0)

// 暴露给模板的数据和方法
defineExpose({
  handleSkillClick,
  handleEscape,
  handlePetSelect,
})
</script>

<template>
  <div class="relative w-screen h-screen flex justify-center items-center bg-gray-900">
    <div
      class="relative w-full max-w-[1600px] h-full max-h-[900px] flex flex-col bg-center bg-no-repeat aspect-video"
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
      <!-- 顶部状态栏 -->
      <div class="flex justify-between p-5">
        <BattleStatus :player="props.leftPlayer" side="left" />
        <BattleStatus :player="props.rightPlayer" side="right" />
      </div>

      <!-- 回合信息和全局印记 -->
      <div class="flex flex-col items-center gap-2 py-2">
        <div class="text-white text-xl font-bold">回合 {{ props.turns || 1 }}</div>
        <div class="flex gap-2">
          <Mark v-for="mark in props.globalMarks" :key="mark.id" :mark="mark" />
        </div>
      </div>

      <!-- 中部立绘区域 -->
      <div class="flex-grow flex justify-around items-center">
        <div class="relative">
          <div
            class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-[120px] h-[20px] rounded-full bg-black bg-opacity-30 blur-md"
          ></div>
          <Pet :num="leftPetSpeciesNum" class="w-[200px] h-[200px]" />
        </div>
        <div class="relative">
          <div
            class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-[120px] h-[20px] rounded-full bg-black bg-opacity-30 blur-md"
          ></div>
          <Pet :num="rightPetSpeciesNum" :reverse="true" class="w-[200px] h-[200px]" />
        </div>
      </div>

      <!-- 底部区域 -->
      <div class="flex h-1/5">
        <!-- 战斗日志 -->
        <div class="w-1/6 p-2">
          <BattleLogPanel />
        </div>

        <!-- 主操作区域 -->
        <div class="flex flex-col w-2/3">
          <!-- 技能按钮 -->
          <div class="flex-1 flex justify-around p-3" v-if="panelState === PanelState.SKILLS">
            <SkillButton v-for="(skill, index) in props.skills" :skill="skill" @click="handleSkillClick(skill.id)" />
          </div>

          <!-- 宠物选择面板 -->
          <div class="flex-1 grid grid-cols-6 gap-2" v-else>
            <PetButton
              v-for="pet in props.leftPlayer.team"
              :key="pet.id"
              :id="pet.id"
              :name="pet.name"
              :level="pet.level"
              :health="pet.currentHp"
              :max-health="pet.maxHp"
              :element="pet.element"
              :skills="pet.skills"
              position="bottom"
              :is-active="pet.id === props.leftPlayer.activePet.id"
              @click="handlePetSelect"
            />
          </div>
        </div>

        <!-- 操作按钮栏 -->
        <div class="grid grid-cols-2 gap-2 p-2 w-1/6">
          <button
            class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
            @click="handleEscape"
          >
            逃跑
          </button>
          <button
            class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
            @click="panelState = PanelState.PETS"
          >
            换宠
          </button>
          <button
            class="px-4 py-2 bg-gray-500 hover:bg-gray-600 border-2 border-sky-400 rounded-lg text-sky-400 font-bold"
            @click="panelState = PanelState.SKILLS"
          >
            战斗
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clip-diamond {
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
}
</style>
