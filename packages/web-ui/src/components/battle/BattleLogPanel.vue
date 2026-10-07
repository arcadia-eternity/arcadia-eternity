<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BattleLogEntry from './BattleLogEntry.vue'
import BattleFrame from './BattleFrame.vue'
import BattleGlyph from './BattleGlyph.vue'
import {
  BattleMessageType,
  DamageType,
  type baseMarkId,
  type baseSkillId,
  type BattleMessageData,
  type petId,
  type playerId,
} from '@arcadia-eternity/const'
import i18next from 'i18next'
import { type TimestampedBattleMessage } from '@/symbol/battlelog'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useBattleViewStore } from '@/stores/battleView'
import { useBattleStore } from '@/stores/battle'

const messages = computed(() => battleStore.log)

// 游戏设置store
const gameSettingStore = useGameSettingStore()
// 战斗视图store
const battleViewStore = useBattleViewStore()
// 战斗store
const battleStore = useBattleStore()

const MESSAGE_ICONS: Record<BattleMessageType, string> = {
  [BattleMessageType.Damage]: '💥',
  [BattleMessageType.Heal]: '💚',
  [BattleMessageType.SkillUse]: '🎯',
  [BattleMessageType.PetDefeated]: '💀',
  [BattleMessageType.MarkApply]: '🔖',
  [BattleMessageType.MarkDestroy]: '❌',
  [BattleMessageType.MarkExpire]: '⌛',
  [BattleMessageType.MarkUpdate]: '🔄',
  [BattleMessageType.PetSwitch]: '🔄',
  [BattleMessageType.RageChange]: '🔥',
  [BattleMessageType.StatChange]: '📈',
  [BattleMessageType.BattleEnd]: '🏆',
  [BattleMessageType.BattleStart]: '⚔️',
  [BattleMessageType.Info]: 'ℹ️',
  [BattleMessageType.TurnAction]: '📢',
  [BattleMessageType.TurnStart]: '🔄',
  [BattleMessageType.PetRevive]: '💚',
  [BattleMessageType.SkillMiss]: '❌',
  [BattleMessageType.ForcedSwitch]: '🔄',
  [BattleMessageType.FaintSwitch]: '🎁',
  [BattleMessageType.HpChange]: '❤️',
  [BattleMessageType.SkillUseFail]: '❌',
  [BattleMessageType.DamageFail]: '❌',
  [BattleMessageType.HealFail]: '❌',
  [BattleMessageType.EffectApply]: '✨',
  [BattleMessageType.EffectApplyFail]: '❌',
  [BattleMessageType.InvalidAction]: '🚫',
  [BattleMessageType.Error]: '❌',
  [BattleMessageType.TurnEnd]: '🏁',
  [BattleMessageType.SkillUseEnd]: '🔚',
  [BattleMessageType.Transform]: '🦋',
  [BattleMessageType.TransformEnd]: '🔚',
  [BattleMessageType.TeamSelectionStart]: '👥',
  [BattleMessageType.TeamSelectionComplete]: '✅',
}

// 伤害类型映射
const DAMAGE_TYPE_MAP: Record<string, string> = {
  [DamageType.Physical]: '物理',
  [DamageType.Special]: '特殊',
  [DamageType.Effect]: '效果',
}

// 怒气变化原因
const RAGE_REASON_MAP: Record<string, string> = {
  'skill-cost': '技能消耗',
  'round-recover': '回合恢复',
  'damage-recover': '伤害恢复',
  'passive-effect': '被动效果',
}

// 未命中原因
const MISS_REASON_MAP: Record<string, string> = {
  'accuracy-check': '命中判定失败',
  dodge: '对方闪避',
  immune: '技能免疫',
}

type FormattedBattleMessage = TimestampedBattleMessage & {
  icon: string
  content: string
  timestamp: string
}

// 获取精灵名称
function getPetName(petId: petId): string {
  const pet = battleStore.getPetById(petId)
  return pet?.name || petId
}

// 获取技能名称
function getSkillName(skillId: baseSkillId): string {
  return i18next.t(`${skillId}.name`, { ns: 'skill' }) || skillId
}

// 获取印记名称
function getMarkName(markId: baseMarkId): string {
  return i18next.t(`${markId}.name`, { ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] }) || markId
}

// 状态变化箭头
function getStatArrows(stage: number): string {
  return stage > 0 ? '↑' : '↓'
}

function formatBattleMessage(msg: TimestampedBattleMessage): FormattedBattleMessage {
  const icon = MESSAGE_ICONS[msg.type] || '📝'
  let content = ''

  switch (msg.type) {
    case BattleMessageType.BattleStart:
      content = '对战开始！'
      break
    case BattleMessageType.TurnStart:
      content = `第 ${msg.data.turn} 回合`
      break
    case BattleMessageType.SkillUse: {
      const skillInfo = battleStore.getSkillInfo(msg.data.skill)
      const skillName = skillInfo?.baseId ? getSkillName(skillInfo.baseId) : msg.data.skill

      content = `${getPetName(msg.data.user)} 使用 ${skillName} (消耗${msg.data.rage}怒气) → ${getPetName(msg.data.target as petId)}`
      break
    }
    case BattleMessageType.Damage: {
      const data = msg.data as {
        target: string
        damage: number
        damageType: string
        isCrit: boolean
        effectiveness: number
        currentHp: number
        maxHp: number
      }
      const damageTypeLabel =
        DAMAGE_TYPE_MAP[data.damageType] ??
        DAMAGE_TYPE_MAP[data.damageType.charAt(0).toUpperCase() + data.damageType.slice(1)] ??
        data.damageType ??
        '未知'
      content = `${getPetName(data.target as petId)} 受到 ${data.damage} 点 ${damageTypeLabel}伤害`
      if (data.isCrit) content += ' (暴击)'
      if (data.effectiveness > 1) content += ' 效果拔群！'
      if (data.effectiveness < 1) content += ' 效果不佳...'
      content += ` (剩余HP: ${data.currentHp}/${data.maxHp})`
      break
    }
    case BattleMessageType.StatChange: {
      const data = msg.data as { pet: string; stat: string; stage: number; reason: string }
      content = `${getPetName(data.pet as petId)} ${data.stat} ${getStatArrows(data.stage).repeat(
        Math.abs(data.stage),
      )} (${data.reason})`
      break
    }
    case BattleMessageType.PetSwitch: {
      const data = msg.data as { player: string; fromPet: string; toPet: string; currentHp: number }
      const player = battleStore.getPlayerById(data.player as playerId)
      content = `${player?.name || data.player} 更换精灵：${getPetName(
        data.fromPet as petId,
      )} → ${getPetName(data.toPet as petId)} (剩余HP: ${data.currentHp})`
      break
    }
    case BattleMessageType.RageChange: {
      const data = msg.data as { pet: string; before: number; after: number; reason: string }
      content = `${getPetName(data.pet as petId)} 怒气 ${data.before} → ${
        data.after
      } (${RAGE_REASON_MAP[data.reason] || data.reason})`
      break
    }
    case BattleMessageType.SkillMiss: {
      const data = msg.data as { user: string; skill: string; reason: string }
      const skillInfo = battleStore.getSkillInfo(data.skill)
      content = `${getPetName(data.user as petId)} 的 ${
        skillInfo ? getSkillName(skillInfo.baseId) : data.skill
      } 未命中！ (${MISS_REASON_MAP[data.reason] || data.reason})`
      break
    }
    case BattleMessageType.PetDefeated: {
      const data = msg.data as { pet: string; killer?: string }
      content = `${getPetName(data.pet as petId)} 倒下！`
      if (data.killer) content += ` (击败者: ${getPetName(data.killer as petId)})`
      break
    }
    case BattleMessageType.MarkApply: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkApply]
      content = `${getPetName(data.target as petId)} 被施加 【${getMarkName(data.mark.baseId)}】 印记`
      break
    }
    case BattleMessageType.BattleEnd:
      const winnerPlayer = battleStore.getPlayerById(msg.data.winner as playerId)
      content = `🎉 对战结束！胜利者：${winnerPlayer?.name || msg.data.winner || '无'}`
      break
    case BattleMessageType.ForcedSwitch:
      content = `${msg.data.player.map(p => battleStore.getPlayerById(p as playerId)?.name || p).join(',')} 必须更换倒下的精灵！`
      break
    case BattleMessageType.FaintSwitch:
      const player = battleStore.getPlayerById(msg.data.player as playerId)
      content = `🎁 ${player?.name || msg.data.player} 击倒对手，获得换宠机会！`
      break
    case BattleMessageType.PetRevive: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.PetRevive]
      const revivedPet = battleStore.getPetById(data.pet)
      content = `${getPetName(data.pet)} 被 ${getPetName(data.revivedBy)} 复活 (当前HP: ${revivedPet?.currentHp})`
      break
    }
    case BattleMessageType.HpChange: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.HpChange]
      const change = data.after - data.before
      content = `${getPetName(data.pet)} HP ${change > 0 ? '+' : ''}${change} (当前: ${data.after}/${data.maxHp}) [${i18next.t(`battle:hpChangeReason.${data.reason}`, { defaultValue: data.reason })}]`
      break
    }
    case BattleMessageType.SkillUseFail: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.SkillUseFail]
      content = `${getPetName(data.user)} 无法使用技能：${i18next.t(`battle:skillFailReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.SkillUseEnd: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.SkillUseEnd]
      content = `${getPetName(data.user)} 结束技能使用`
      break
    }
    case BattleMessageType.Heal: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.Heal]
      const targetPet = battleStore.getPetById(data.target)
      content = `${getPetName(data.target)} 恢复 ${data.amount} HP (当前: ${targetPet?.currentHp})`
      break
    }
    case BattleMessageType.HealFail: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.HealFail]
      content = `${getPetName(data.target)} 治疗失败：${i18next.t(`battle:healFailReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.MarkDestroy: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkDestroy]
      const markName = getMarkName(data.baseMarkId)
      content = `${getPetName(data.target as petId)} 的【${markName}】印记被销毁`
      break
    }
    case BattleMessageType.MarkUpdate: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkUpdate]
      content = `${getPetName(data.target as petId)} 的【${getMarkName(data.mark.baseId)}】更新为 ${data.mark.stack} 层`
      break
    }
    case BattleMessageType.EffectApply: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.EffectApply]
      let sourceName: string = data.source

      // First check if it's a skill
      const skillInfo = battleStore.getSkillInfo(data.source)
      const markInfo = battleStore.getMarkInfo(data.source)
      if (skillInfo) {
        sourceName = getSkillName(skillInfo.baseId)
      } else if (markInfo) {
        sourceName = getMarkName(markInfo.baseId)
      } else {
        sourceName = data.source
      }

      content = `${sourceName} 触发效果：${i18next.t(`effect:${data.effect}`, { defaultValue: data.effect })}`
      break
    }
    case BattleMessageType.TurnEnd:
      content = '回合结束'
      break
    case BattleMessageType.TurnAction: {
      content = '等待玩家选择行动'
      break
    }
    case BattleMessageType.InvalidAction: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.InvalidAction]
      content = `无效操作：${i18next.t(`battle:invalidActionReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.Info:
      content = 'ℹ️ ' + (msg.data.message || '')
      break
    case BattleMessageType.Error:
      content = '❌ 错误：' + (msg.data.message || '')
      break
    case BattleMessageType.DamageFail: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.DamageFail]
      content = `${getPetName(data.target)} 伤害失败：${i18next.t(`battle:damageFailReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.MarkExpire: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkExpire]
      const markInfo = battleStore.getMarkInfo(data.mark)
      content = `${getPetName(data.target as petId)} 的【${getMarkName(markInfo?.baseId ?? ('' as baseMarkId))}】印记已过期`
      break
    }
    case BattleMessageType.Transform: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.Transform]
      switch (data.targetType) {
        case 'pet':
          content = `${getPetName(data.target as petId)} 变身为 ${data.target}`
          break
      }
    }
    case BattleMessageType.TransformEnd: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.TransformEnd]
      content = `${data.target} 恢复了原来的样子`
      break
    }
    case BattleMessageType.TeamSelectionStart:
      content = '队伍选择阶段开始'
      break
    case BattleMessageType.TeamSelectionComplete:
      content = '队伍选择完成'
      break
    default:
      content = ''
  }

  return {
    ...msg,
    icon,
    content,
    timestamp: new Date(msg.receivedAt).toLocaleTimeString(),
  }
}

// 格式化消息数据 - 使用缓存避免重新渲染
const messageCache = new Map<string, FormattedBattleMessage>()
const formattedMessages = computed(() => {
  const messageArray = messages.value // 处理可能的Ref类型
  return messageArray
    .filter((msg: TimestampedBattleMessage) => gameSettingStore.visibleLogTypes.has(msg.type)) // 根据设置过滤消息类型
    .map(msg => {
      const cacheKey = `${msg.sequenceId ?? msg.receivedAt}_${msg.type}`
      if (messageCache.has(cacheKey)) {
        return messageCache.get(cacheKey)!
      }
      const formatted = formatBattleMessage(msg)
      messageCache.set(cacheKey, formatted)
      return formatted
    })
})

const logContainerRef = ref<HTMLElement | null>(null)
watch(
  formattedMessages,
  async () => {
    await nextTick()
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  },
  { deep: true },
)
</script>

<template>
  <section data-testid="battle-log-panel" class="battle-log">
    <BattleFrame />
    <header class="battle-log__header">
      <span><BattleGlyph name="log" />战斗记录</span>
      <span class="battle-log__count">{{ formattedMessages.length }} 条</span>
      <button
        class="battle-log__close"
        @click="battleViewStore.toggleLogPanel()"
        title="隐藏日志面板"
        aria-label="隐藏战斗记录"
      >
        <BattleGlyph name="log" />
      </button>
    </header>
    <div data-testid="battle-log-list" ref="logContainerRef" class="battle-log__list" role="log" aria-label="战斗记录">
      <p v-if="!formattedMessages.length" class="battle-log__empty">等待战斗开始</p>
      <BattleLogEntry v-for="(msg, index) in formattedMessages" :key="msg.receivedAt + index" :message="msg" />
    </div>
  </section>
</template>
<style scoped>
.battle-log {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.battle-log__header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--battle-line);
  flex: none;
}
.battle-log__header > span:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--battle-cyan);
}
.battle-log__count {
  margin-left: auto;
  font-size: 10px;
  color: var(--battle-muted);
}
.battle-log__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--battle-muted);
  cursor: pointer;
}
.battle-log__close:hover,
.battle-log__close:focus-visible {
  color: var(--battle-cyan);
  outline: 1px solid currentColor;
}
.battle-log__list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--battle-line) transparent;
}
.battle-log__empty {
  color: var(--battle-muted);
  font-size: 12px;
  padding: 12px 0;
}
</style>
