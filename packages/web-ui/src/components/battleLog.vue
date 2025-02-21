<template>
  <div class="battle-log">
    <div v-for="(msg, index) in messages" :key="index" class="log-entry" :class="getLogEntryClass(msg.type)">
      {{ formatMessage(msg) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { type BattleMessage, BattleMessageType } from '@test-battle/const'

const props = defineProps<{
  messages: BattleMessage[]
}>()

const formatMessage = (msg: BattleMessage) => {
  switch (msg.type) {
    case BattleMessageType.BattleStart:
      return '⚔️ 战斗开始！'

    case BattleMessageType.RoundStart:
      return `🔄 第 ${msg.data.round} 回合开始`

    case BattleMessageType.RageChange:
      return `⚡ ${getPetName(msg.data.pet)} 怒气 ${msg.data.before} → ${msg.data.after} (${rageReason(msg.data.reason)})`

    case BattleMessageType.SkillUse:
      return `🎯 ${getPetName(msg.data.user)} 使用 ${msg.data.skill} (消耗${msg.data.rageCost}怒气) → ${getPetName(msg.data.target)}`

    case BattleMessageType.SkillMiss:
      return `❌ ${getPetName(msg.data.user)} 的 ${msg.data.skill} 未命中！ (${missReason(msg.data.reason)})`

    case BattleMessageType.Damage: {
      let text = `💥 ${getPetName(msg.data.target)} 受到 ${msg.data.damage}点伤害`
      if (msg.data.isCrit) text += ' (暴击)'
      if (msg.data.effectiveness > 1) text += ' 效果拔群！'
      if (msg.data.effectiveness < 1) text += ' 效果不佳...'
      return text
    }

    case BattleMessageType.Heal:
      return `💚 ${getPetName(msg.data.target)} 恢复 ${msg.data.amount}点HP`

    case BattleMessageType.PetSwitch:
      return `🔄 ${getPlayerName(msg.data.player)} 更换精灵：${getPetName(msg.data.fromPet)} → ${getPetName(msg.data.toPet)}`

    case BattleMessageType.PetDefeated:
      return `☠️ ${getPetName(msg.data.pet)} 失去战斗能力！`

    case BattleMessageType.StatChange: {
      const arrow = msg.data.stage > 0 ? '↑' : '↓'
      return `📈 ${getPetName(msg.data.pet)} ${statName(msg.data.stat)} ${arrow.repeat(Math.abs(msg.data.stage))}`
    }

    case BattleMessageType.MarkApply:
      return `🔖 ${getPetName(msg.data.target)} 被施加【${msg.data.markType}】印记`

    case BattleMessageType.MarkTrigger:
      return `✨ ${msg.data.markType} 印记触发：${msg.data.effect}`

    case BattleMessageType.BattleEnd:
      return `🎉 战斗结束！胜利者：${getPlayerName(msg.data.winner)}`

    case BattleMessageType.Crit:
      return `🔥 ${getPetName(msg.data.attacker)} 的暴击！`

    case BattleMessageType.TypeEffectiveness:
      return `⚖️ 属性克制：${msg.data.attackerType} → ${msg.data.defenderType} (×${msg.data.multiplier})`

    case BattleMessageType.ForcedSwitch:
      return `⚠️ ${msg.data.player.join('、')} 需要更换精灵！`

    case BattleMessageType.InvalidAction:
      return `❓ 无效操作：${actionReason(msg.data.reason)}`

    default:
      return `[${msg.type}] ${JSON.stringify(msg.data)}`
  }
}

// 样式类型映射
const getLogEntryClass = (type: string) => {
  const typeMap: Record<string, string> = {
    [BattleMessageType.Damage]: 'damage',
    [BattleMessageType.Heal]: 'heal',
    [BattleMessageType.Crit]: 'crit',
    [BattleMessageType.PetDefeated]: 'faint',
    [BattleMessageType.StatChange]: 'stat-change',
    [BattleMessageType.MarkApply]: 'mark-apply',
  }
  return typeMap[type] || 'info'
}

// 辅助方法（需根据实际数据源实现）
const getPetName = (id: string) => id // 应替换为实际名称查询
const getPlayerName = (id: string) => id
const rageReason = (reason: string) => ({ turn: '回合增长', damage: '受伤获得' })[reason] || reason
const missReason = (reason: string) => ({ accuracy: '命中不足', dodge: '被闪避' })[reason] || reason
const statName = (stat: string) => ({ atk: '攻击', def: '防御', spd: '速度' })[stat] || stat
const actionReason = (reason: string) => ({ no_rage: '怒气不足' })[reason] || reason
</script>

<style scoped>
.battle-log {
  height: 300px;
  overflow-y: auto;
  padding: 12px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 8px;
}

.log-entry {
  padding: 8px;
  margin: 4px 0;
  border-left: 3px solid #666;
  font-size: 0.9em;
}

.damage {
  color: #ff4444;
  border-color: #ff4444;
}
.heal {
  color: #44ff44;
  border-color: #44ff44;
}
.crit {
  color: #ffaa00;
  border-color: #ffaa00;
}
.faint {
  color: #666;
  border-color: #666;
}
.stat-change {
  color: #44aaff;
  border-color: #44aaff;
}
.mark-apply {
  color: #ff44ff;
  border-color: #ff44ff;
}
</style>
