<script setup lang="ts">
import BattleLogEntry from './BattleLogEntry.vue'
import { ref } from 'vue'
import { formatBattleMessage } from '../viewModels/battleLogViewModel'
import type { BattleMessage, petId, playerId, skillId, StatTypeOnBattle } from '@test-battle/const'
import { BattleMessageType, AttackTargetOpinion } from '@test-battle/const'

// 技能使用消息
const skillMessage = ref(
  formatBattleMessage({
    sequenceId: 1,
    type: BattleMessageType.SkillUse,
    data: {
      user: 'pet-123' as petId,
      target: AttackTargetOpinion.opponent,
      skill: 'skill-456' as skillId,
      rageCost: 30,
    },
  }),
)

// 状态变化消息
const statusMessage = ref(
  formatBattleMessage({
    sequenceId: 2,
    type: BattleMessageType.StatChange,
    data: {
      pet: 'pet-123' as petId,
      stat: 'ATK' as StatTypeOnBattle,
      stage: 2,
      reason: '技能效果',
    },
  }),
)

// 换宠消息
const switchMessage = ref(
  formatBattleMessage({
    sequenceId: 3,
    type: BattleMessageType.PetSwitch,
    data: {
      player: 'player-1' as playerId,
      fromPet: 'pet-123' as petId,
      toPet: 'pet-456' as petId,
      currentHp: 80,
    },
  }),
)

// 普通信息消息
const infoMessage = ref(
  formatBattleMessage({
    sequenceId: 4,
    type: BattleMessageType.Info,
    data: {
      message: '[战斗] 皮卡丘使用了十万伏特！',
    },
  }),
)
</script>

<template>
  <Story title="BattleLogEntry">
    <Variant title="技能使用消息">
      <div class="bg-black/80 rounded-lg p-4">
        <BattleLogEntry :message="skillMessage" />
      </div>
    </Variant>

    <Variant title="状态变化消息">
      <div class="bg-black/80 rounded-lg p-4">
        <BattleLogEntry :message="statusMessage" />
      </div>
    </Variant>

    <Variant title="换宠消息">
      <div class="bg-black/80 rounded-lg p-4">
        <BattleLogEntry :message="switchMessage" />
      </div>
    </Variant>

    <Variant title="普通信息消息">
      <div class="bg-black/80 rounded-lg p-4">
        <BattleLogEntry :message="infoMessage" />
      </div>
    </Variant>
  </Story>
</template>
