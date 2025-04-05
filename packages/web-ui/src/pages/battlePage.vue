<script setup lang="ts">
import { computed, ref, provide } from 'vue'
import { useBattleStore } from '@/stores/battle'
import { logMessagesKey, petMapKey, skillMapKey, playerMapKey, markMapKey } from '@/symbol/battlelog'
import Battle from '@/views/battle.vue'
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import i18next from 'i18next'
import type { SkillMessage } from '@test-battle/const'

const store = useBattleStore()

// 提供战斗日志相关数据给子组件
provide(logMessagesKey, store.log)
provide(markMapKey, store.markMap)
provide(skillMapKey, store.skillMap)
provide(petMapKey, store.petMap)
provide(playerMapKey, store.playerMap)
const isPending = ref(false)

// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.state?.marks ?? [])
const currentTurn = computed(() => store.state?.currentTurn ?? 0)

// 当前玩家可用技能
const availableSkills = computed<SkillMessage[]>(() => {
  return (
    store.currentPlayer?.activePet?.skills
      ?.filter(skill => !skill.isUnknown)
      .map(skill => ({
        ...skill,
        name: i18next.t(`${skill.baseId}.name`, { ns: 'skill' }),
      })) ?? []
  )
})

// 处理技能点击
const handleSkillClick = (skillId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
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
</script>

<template>
  <div class="h-screen bg-[#1a1a2e]">
    <!-- 使用 Battle 组件 -->
    <Battle
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
      <!-- 插入自定义日志面板 -->
      <template #log-panel>
        <BattleLogPanel class="h-[300px] bg-black/90 rounded-lg p-3" />
      </template>
    </Battle>

    <!-- 战斗结束覆盖层 -->
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
