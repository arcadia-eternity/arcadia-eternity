<script setup lang="ts">
import { computed, ref } from 'vue'
import BattleStatus from '@/components/BattleStatus.vue'
import Pet from '@/components/Pet.vue'
import SkillButton from '@/components/SkillButton.vue'
import Mark from '@/components/Mark.vue'
import BattleLogPanel from '@/components/BattleLogPanel.vue'
import {
  Category,
  type MarkMessage,
  type petId,
  type PlayerMessage,
  type skillId,
  type SkillMessage,
} from '@test-battle/const'
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

const emit = defineEmits<{
  skillClick: [id: skillId]
  petSelect: [petId: petId]
  escape: []
}>()
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
      <div class="flex justify-between p-5">
        <BattleStatus :player="props.leftPlayer" side="left" />
        <BattleStatus :player="props.rightPlayer" side="right" />
      </div>

      <div class="flex flex-col items-center gap-2 py-2">
        <div class="text-white text-xl font-bold">回合 {{ props.turns || 1 }}</div>
        <div class="flex gap-2">
          <Mark v-for="mark in props.globalMarks" :key="mark.id" :mark="mark" />
        </div>
      </div>

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

      <div class="flex h-1/5">
        <div class="w-1/6 h-full p-2">
          <BattleLogPanel />
        </div>

        <div class="flex flex-col w-2/3 h-full">
          <div class="flex flex-col p-3 h-full" v-if="panelState === PanelState.SKILLS">
            <div class="grid grid-cols-5 gap-2">
              <!-- 普通技能 -->
              <template
                v-for="(skill, index) in props.skills.filter(s => s.category !== Category.Climax)"
                :key="'normal-' + skill.id"
              >
                <SkillButton
                  :skill="skill"
                  @click="handleSkillClick(skill.id)"
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
                  :style="{ 'grid-column-start': 5 - index }"
                  class="justify-self-end"
                />
              </template>
            </div>
          </div>

          <div class="flex-1 grid grid-cols-6 gap-2 h-full" v-else>
            <PetButton
              v-for="pet in props.leftPlayer.team"
              :key="pet.id"
              class="h-full aspect-square"
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

        <div class="grid grid-cols-2 gap-2 p-2 w-1/6 h-full">
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

<style scoped></style>
