<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerMessage } from '@arcadia-eternity/const'
import { useGameDataStore } from '@/stores/gameData'
import PetIcon from '../PetIcon.vue'
import BattleFrame from './BattleFrame.vue'
import BattleGlyph from './BattleGlyph.vue'
import type { PreparationTask } from '@/composition/useBattlePreparation'
const props = defineProps<{
  left?: PlayerMessage | null
  right?: PlayerMessage | null
  background?: string | null
  tasks: PreparationTask[]
  progress: number
  error: string | null
  replay?: boolean
}>()
defineEmits<{ retry: []; exit: [] }>()
const data = useGameDataStore()
const teams = computed(() => [props.left, props.right])
const activeTask = computed(() => props.tasks.find(t => t.state === 'loading')?.label ?? '正在准备战场')
</script>
<template>
  <section class="battle-loading" data-testid="battle-loading-overlay" :aria-busy="!error" aria-label="准备对战">
    <div
      class="battle-loading__backdrop"
      :style="background ? { backgroundImage: `url(${background})` } : undefined"
    ></div>
    <div class="battle-loading__content">
      <div class="battle-loading__eyebrow">ARCADIA ETERNITY</div>
      <h1>{{ replay ? '战斗回放' : '准备对战' }}</h1>
      <div class="battle-loading__versus">
        <div v-for="(team, side) in teams" :key="side" class="battle-loading__team">
          <BattleFrame :reverse="side === 1" />
          <span class="battle-loading__side">{{ side === 0 ? '我方阵容' : '对方阵容' }}</span>
          <h2>{{ team?.name || '等待玩家' }}</h2>
          <div class="battle-loading__pets">
            <div v-for="pet in team?.team || []" :key="pet.id" class="battle-loading__pet">
              <PetIcon
                :id="pet.isUnknown ? 0 : (data.getSpecies(pet.speciesID)?.num ?? 0)"
                :is-unknown="!!pet.isUnknown"
                :reverse="side === 1"
              />
            </div>
            <BattleGlyph v-if="!team?.team?.length" name="shield" />
          </div>
        </div>
        <div class="battle-loading__vs" aria-label="对阵">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <path d="M50 3 97 50 50 97 3 50Z" />
            <path d="M50 13 87 50 50 87 13 50Z" /></svg
          ><span>VS</span>
        </div>
      </div>
      <div
        class="battle-loading__progress"
        role="progressbar"
        aria-label="战斗准备进度"
        :aria-valuenow="progress"
        :aria-valuemin="0"
        :aria-valuemax="100"
      >
        <div class="battle-loading__status">
          <span role="status">{{ error ? '准备失败' : activeTask }}</span
          ><span>{{ progress }}%</span>
        </div>
        <div class="battle-loading__track"><div :style="{ transform: `scaleX(${progress / 100})` }"></div></div>
        <ol class="battle-loading__tasks">
          <li v-for="task in tasks" :key="task.id" :data-state="task.state">
            <span class="battle-loading__dot"></span>{{ task.label
            }}<span v-if="task.state === 'degraded'"> · 简化显示</span>
          </li>
        </ol>
      </div>
      <div v-if="error" class="battle-loading__error" role="alert">
        <p>{{ error }}</p>
        <button class="battle-control" @click="$emit('retry')">重试</button
        ><button class="battle-control" @click="$emit('exit')">返回</button>
      </div>
      <p v-else class="battle-loading__tip">战术提示 · 留意怒气消耗与属性相性，把握释放必杀的时机。</p>
    </div>
  </section>
</template>
