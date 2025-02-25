<script setup lang="ts">
import { computed } from 'vue'
import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  ELEMENT_MAP,
  type BattleMessage,
  type petId,
} from '@test-battle/const'
import { useBattleStore } from '@/stores/battle'

const props = defineProps<{
  message: BattleMessage
}>()

const store = useBattleStore()

// 获取精灵名称
const getPetName = (petId: string) => {
  return store.getPetById(petId as petId)?.name || petId
}

// 获取技能名称
const getSkillName = (skillId: string) => {
  return (
    store.state?.players
      .flatMap(p => p.team)
      .flatMap(p => p!.skills)
      .find(s => s!.id === skillId)?.name || skillId
  )
}

const getRageReason = (reason: string) => {
  const reasons: Record<string, string> = {
    'skill-cost': '技能消耗',
    'round-recover': '回合恢复',
    'damage-recover': '伤害恢复',
    'passive-effect': '被动效果',
  }
  return reasons[reason] || reason
}

const translateMissReason = (reason: string) => {
  const reasons: Record<string, string> = {
    'accuracy-check': '命中判定失败',
    dodge: '对方闪避',
    immune: '技能免疫',
  }
  return reasons[reason] || reason
}

// 伤害类型映射
const damageTypeMap: Record<string, string> = {
  physical: '物理',
  special: '特殊',
  effect: '效果',
}

// 状态变化箭头
const statArrows = (stage: number) => {
  return stage > 0 ? '↑' : '↓'
}

// 消息图标映射
const messageIcons = computed(() => ({
  [BattleMessageType.Damage]: '💥',
  [BattleMessageType.Heal]: '💚',
  [BattleMessageType.SkillUse]: '🎯',
  [BattleMessageType.Crit]: '🔥',
  [BattleMessageType.PetDefeated]: '💀',
  [BattleMessageType.MarkApply]: '🔖',
  [BattleMessageType.MarkTrigger]: '✨',
  [BattleMessageType.PetSwitch]: '🔄',
  [BattleMessageType.RageChange]: '⚡',
  [BattleMessageType.StatChange]: '📈',
  [BattleMessageType.BattleEnd]: '🏆',
  [BattleMessageType.BattleStart]: '⚔️',
  [BattleMessageType.Info]: 'ℹ️',
  [BattleMessageType.TurnAction]: '📢',
}))

const translateEndReason = (reason: string): string => {
  return reason === 'all_pet_fainted' ? '全部精灵失去战斗能力' : '玩家投降'
}
</script>

<template>
  <div class="log-entry" :class="[message.type.toLowerCase()]">
    <div class="log-icon">{{ messageIcons[message.type] || '📝' }}</div>

    <div class="log-content">
      <!-- 战斗开始 -->
      <div v-if="message.type === BattleMessageType.BattleStart" class="battle-start">对战开始！</div>

      <!-- 回合开始 -->
      <div v-if="message.type === BattleMessageType.RoundStart" class="round-start">
        第 {{ message.data.round }} 回合
      </div>

      <!-- 技能使用 -->
      <div v-if="message.type === BattleMessageType.SkillUse" class="skill-use">
        <span class="pet-name">{{ getPetName(message.data.user) }}</span>
        使用
        <span class="skill-name">{{ getSkillName(message.data.skill) }}</span>
        <span class="rage-cost">(消耗{{ message.data.rageCost }}怒气)</span>
        →
        <span class="target-name">{{ getPetName(message.data.target) }}</span>
      </div>

      <!-- 伤害信息 -->
      <div v-if="message.type === BattleMessageType.Damage" class="damage">
        <span class="target">{{ getPetName(message.data.target) }}</span>
        受到
        <span class="damage-value">{{ message.data.damage }}</span>
        点
        <span class="damage-type">{{ damageTypeMap[message.data.damageType] }}</span
        >伤害
        <span v-if="message.data.isCrit" class="crit">(暴击)</span>
        <span v-if="message.data.effectiveness > 1" class="effective">效果拔群！</span>
        <span v-if="message.data.effectiveness < 1" class="not-effective">效果不佳...</span>
        <span class="hp-remaining"> (剩余HP: {{ message.data.currentHp }}/{{ message.data.maxHp }}) </span>
      </div>

      <!-- 状态变化 -->
      <div v-if="message.type === BattleMessageType.StatChange" class="stat-change">
        <span class="pet-name">{{ getPetName(message.data.pet) }}</span>
        <span class="stat-name">{{ message.data.stat }}</span>
        <span class="stat-arrow">{{ statArrows(message.data.stage).repeat(Math.abs(message.data.stage)) }}</span>
        <span class="reason">({{ message.data.reason }})</span>
      </div>

      <!-- 精灵切换 -->
      <div v-if="message.type === BattleMessageType.PetSwitch" class="pet-switch">
        <span class="player-name">{{ store.getPlayerById(message.data.player)?.name }}</span>
        更换精灵：
        <span class="from-pet">{{ getPetName(message.data.fromPet) }}</span> →
        <span class="to-pet">{{ getPetName(message.data.toPet) }}</span>
        <span class="hp-info">(剩余HP: {{ message.data.currentHp }})</span>
      </div>

      <!-- 通用信息 -->
      <div v-if="message.type === BattleMessageType.Info" class="info-message">
        {{ message.data.message }}
      </div>

      <div v-if="message.type === BattleMessageType.RageChange" class="rage-change">
        <span class="pet-name">{{ getPetName(message.data.pet) }}</span>
        怒气
        <span class="rage-before">{{ message.data.before }}</span> →
        <span class="rage-after">{{ message.data.after }}</span>
        <span class="reason">({{ getRageReason(message.data.reason) }})</span>
      </div>

      <!-- 技能未命中 -->
      <div v-if="message.type === BattleMessageType.SkillMiss" class="skill-miss">
        <span class="pet-name">{{ getPetName(message.data.user) }}</span>
        的
        <span class="skill-name">{{ getSkillName(message.data.skill) }}</span>
        未命中！
        <span class="miss-reason">({{ translateMissReason(message.data.reason) }})</span>
      </div>

      <!-- 精灵倒下 -->
      <div v-if="message.type === BattleMessageType.PetDefeated" class="pet-defeated">
        <span class="pet-name">{{ getPetName(message.data.pet) }}</span>
        倒下！
        <span v-if="message.data.killer" class="killer"> (击败者: {{ getPetName(message.data.killer) }}) </span>
      </div>

      <!-- 印记应用 -->
      <div v-if="message.type === BattleMessageType.MarkApply" class="mark-apply">
        <span class="target">{{ getPetName(message.data.target) }}</span>
        被施加
        <span class="mark-type">【{{ message.data.markType }}】</span>
        印记
      </div>

      <!-- 印记触发 -->
      <div v-if="message.type === BattleMessageType.MarkTrigger" class="mark-trigger">
        <span class="mark-type">{{ message.data.markType }}</span>
        印记触发：
        <span class="effect">{{ message.data.effect }}</span>
      </div>

      <!-- 对战结束 -->
      <div v-if="message.type === BattleMessageType.BattleEnd" class="battle-end">
        🎉 对战结束！胜利者：{{ message.data.winner }}
        <div class="end-reason">结束原因：{{ translateEndReason(message.data.reason) }}</div>
      </div>

      <!-- 强制换宠 -->
      <div v-if="message.type === BattleMessageType.ForcedSwitch" class="forced-switch">
        {{ message.data.player.join(',') }} 必须更换倒下的精灵！
      </div>

      <!-- 击倒换宠机会 -->
      <div v-if="message.type === BattleMessageType.FaintSwitch" class="faint-switch">
        🎁 {{ message.data.player }} 击倒对手，获得换宠机会！
      </div>

      <!-- 回合行动选择 -->
      <div v-if="message.type === BattleMessageType.TurnAction" class="turn-action">选择阶段</div>

      <!-- 时间戳 -->
      <div class="timestamp">
        {{ new Date(message.sequenceId ?? 0).toLocaleTimeString() }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-entry {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  transition: all 0.3s ease;
}

.log-icon {
  font-size: 1.2em;
  flex-shrink: 0;
}

.log-content {
  flex-grow: 1;
}

/* 不同类型消息的样式 */
.damage {
  color: #ff6b6b;
}

.heal {
  color: #51cf66;
}

.skill-use {
  color: #fcc419;
}

.pet-switch {
  color: #74c0fc;
}

.stat-change {
  color: #b197fc;
}

.battle-start {
  color: #ffd43b;
  font-weight: bold;
}

.timestamp {
  font-size: 0.8em;
  color: #868e96;
  margin-top: 4px;
}

.pet-name,
.skill-name {
  font-weight: 500;
  color: #a5d8ff;
}

.damage-value {
  font-weight: bold;
}

.crit {
  color: #ff6b6b;
  font-weight: bold;
}

.effective {
  color: #51cf66;
  font-weight: bold;
}

.not-effective {
  color: #868e96;
  font-weight: bold;
}

.hp-remaining {
  color: #adb5bd;
}
</style>
