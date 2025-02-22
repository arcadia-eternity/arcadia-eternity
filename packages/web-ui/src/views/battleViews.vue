<script setup lang="ts">
import { useBattleStore } from '@/stores/battle'
import { battleClient } from '@/utils/battleClient'
import BattleLog from '@/components/BattleLog.vue'
import { onMounted, onUnmounted } from 'vue'

const store = useBattleStore()

onMounted(() => store.init())
onUnmounted(() => battleClient.disconnect())
</script>

<template>
  <div class="battle-container">
    <!-- 对手区域 -->
    <div class="opponent-side">
      <PetStatus :pet="store.state?.players[1].activePet" is-opponent />
    </div>

    <!-- 战场区域 -->
    <div class="battle-field">
      <div class="round-counter">第 {{ store.state?.currentTurn }} 回合</div>
      <div class="marks">
        <div v-for="mark in store.state?.marks" :key="mark.id" class="mark">{{ mark.name }} ×{{ mark.stack }}</div>
      </div>
    </div>

    <!-- 玩家区域 -->
    <div class="player-side">
      <PetStatus :pet="store.state?.players[0].activePet" />
    </div>

    <!-- 操作面板 -->
    <ActionPanel :actions="store.availableActions" :rage="store.state?.players[0].rage" />

    <!-- 战斗日志 -->
    <BattleLog :messages="store.log" />
  </div>
</template>

<style scoped>
.battle-container {
  display: grid;
  grid-template-areas:
    'opponent opponent'
    'field field'
    'player player'
    'actions log';
  background: url('/assets/bg-space.jpg') no-repeat center/cover;
  min-height: 100vh;
  padding: 20px;
}

.opponent-side {
  grid-area: opponent;
}
.battle-field {
  grid-area: field;
}
.player-side {
  grid-area: player;
}
</style>
