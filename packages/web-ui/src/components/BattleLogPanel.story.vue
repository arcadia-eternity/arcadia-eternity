<script setup lang="ts">
import BattleLogPanel from './BattleLogPanel.vue'
import { ref } from 'vue'
import type { BattleMessage } from '@test-battle/const'
import {
  BattleMessageType,
  AttackTargetOpinion,
  type StatTypeOnBattle,
  type petId,
  type skillId,
} from '@test-battle/const'

// 空消息列表
const emptyMessages = ref<BattleMessage[]>([])

// 单条消息
const singleMessage = ref<BattleMessage[]>([
  {
    sequenceId: 1,
    type: BattleMessageType.Info,
    data: {
      message: '[战斗] 战斗开始！',
    },
  },
])

// 多条消息
const multipleMessages = ref<BattleMessage[]>([
  {
    sequenceId: 1,
    type: BattleMessageType.Info,
    data: {
      message: '[战斗] 战斗开始！',
    },
  },
  {
    sequenceId: 2,
    type: BattleMessageType.SkillUse,
    data: {
      user: 'pet-123' as petId,
      target: AttackTargetOpinion.opponent,
      skill: 'skill-456' as skillId,
      rageCost: 30,
    },
  },
  {
    sequenceId: 3,
    type: BattleMessageType.StatChange,
    data: {
      pet: 'pet-123' as petId,
      stat: 'atk' as StatTypeOnBattle,
      stage: 2,
      reason: '技能效果',
    },
  },
])

// 长消息列表（测试滚动）
const longMessages = ref<BattleMessage[]>(
  Array.from({ length: 20 }, (_, i) => ({
    sequenceId: i + 1,
    type: BattleMessageType.Info,
    data: {
      message: `[战斗] 这是第${i + 1}条测试消息，用于测试滚动条功能`,
    },
  })),
)
</script>

<template>
  <Story title="BattleLogPanel">
    <Variant title="空消息">
      <BattleLogPanel :messages="emptyMessages" />
    </Variant>

    <Variant title="单条消息">
      <BattleLogPanel :messages="singleMessage" />
    </Variant>

    <Variant title="多条消息">
      <BattleLogPanel :messages="multipleMessages" />
    </Variant>

    <Variant title="长消息列表（测试滚动）">
      <BattleLogPanel :messages="longMessages" />
    </Variant>
  </Story>
</template>
