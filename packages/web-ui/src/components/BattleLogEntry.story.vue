<script setup lang="ts">
import BattleLogEntry from './BattleLogEntry.vue'
import { ref } from 'vue'
import { BattleMessageType } from '@test-battle/const'

// 技能使用消息
const skillMessage = ref({
  type: BattleMessageType.SkillUse,
  icon: '⚡',
  content: '<span class="pet-name">皮卡丘</span> 使用了 <span class="skill-name">十万伏特</span>',
  timestamp: '11:11:11',
})

// 状态变化消息
const statusMessage = ref({
  type: BattleMessageType.StatChange,
  icon: '📈',
  content: '<span class="pet-name">皮卡丘</span> 的攻击 <span class="effective">上升了2级</span>',
  timestamp: '11:11:12',
})

// 换宠消息
const switchMessage = ref({
  type: BattleMessageType.PetSwitch,
  icon: '🔄',
  content:
    '<span class="pet-name">小智</span> 收回了 <span class="pet-name">皮卡丘</span>，放出了 <span class="pet-name">喷火龙</span>',
  timestamp: '11:11:13',
})

// 普通信息消息
const infoMessage = ref({
  type: BattleMessageType.Info,
  icon: 'ℹ️',
  content: '[战斗] 皮卡丘使用了十万伏特！',
  timestamp: '11:11:14',
})
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
