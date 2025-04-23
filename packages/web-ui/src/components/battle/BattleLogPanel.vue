<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import BattleLogEntry from './BattleLogEntry.vue'
import {
  BattleMessageType,
  type BattleMessage,
  type BattleMessageData,
  type MarkMessage,
  type PetMessage,
  type PlayerMessage,
  type SkillMessage,
} from '@arcadia-eternity/const'
import i18next from 'i18next'
import { logMessagesKey, petMapKey, skillMapKey, playerMapKey, markMapKey } from '@/symbol/battlelog'

const messages = inject(logMessagesKey, [])
const petMap = inject(petMapKey, new Map())
const skillMap = inject(skillMapKey, new Map())
const playerMap = inject(playerMapKey, new Map())
const markMap = inject(markMapKey, new Map())

const MESSAGE_ICONS: Record<BattleMessageType, string> = {
  [BattleMessageType.Damage]: '💥',
  [BattleMessageType.Heal]: '💚',
  [BattleMessageType.SkillUse]: '🎯',
  [BattleMessageType.PetDefeated]: '💀',
  [BattleMessageType.MarkApply]: '🔖',
  [BattleMessageType.MarkDestory]: '❌',
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
  [BattleMessageType.TurnEnd]: '',
  [BattleMessageType.SkillUseEnd]: '',
}

// 伤害类型映射
const DAMAGE_TYPE_MAP: Record<string, string> = {
  Physical: '物理',
  Special: '特殊',
  Effect: '效果',
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

type FormattedBattleMessage = BattleMessage & {
  icon: string
  content: string
  timestamp: string
}

// 获取精灵名称
function getPetName(petId: string, petMap: Map<string, PetMessage>): string {
  return petMap.get(petId)?.name || petId
}

// 获取技能名称
function getSkillName(skillId: string): string {
  return i18next.t(`${skillId}.name`, { ns: 'skill' }) || skillId
}

// 获取印记名称
function getMarkName(markId: string): string {
  return i18next.t(`${markId}.name`, { ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] }) || markId
}

// 状态变化箭头
function getStatArrows(stage: number): string {
  return stage > 0 ? '↑' : '↓'
}

function formatBattleMessage(
  msg: BattleMessage,
  petMap?: Map<string, PetMessage>,
  skillMap?: Map<string, SkillMessage>,
  playerMap?: Map<string, PlayerMessage>,
  markMap?: Map<string, MarkMessage>,
): FormattedBattleMessage {
  const icon = MESSAGE_ICONS[msg.type] || '📝'
  let content = ''

  switch (msg.type) {
    case BattleMessageType.BattleStart:
      content = '对战开始！'
      break
    case BattleMessageType.TurnStart:
      content = `第 ${msg.data.turn} 回合`
      break
    case BattleMessageType.SkillUse:
      content = `${getPetName(msg.data.user, petMap || new Map())} 使用 ${
        skillMap ? getSkillName(skillMap.get(msg.data.skill)?.baseId || '') : msg.data.skill
      } (消耗${msg.data.rage}怒气) → ${getPetName(msg.data.target, petMap || new Map())}`
      break
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
      content = `${getPetName(data.target, petMap || new Map())} 受到 ${data.damage} 点 ${
        DAMAGE_TYPE_MAP[data.damageType]
      }伤害`
      if (data.isCrit) content += ' (暴击)'
      if (data.effectiveness > 1) content += ' 效果拔群！'
      if (data.effectiveness < 1) content += ' 效果不佳...'
      content += ` (剩余HP: ${data.currentHp}/${data.maxHp})`
      break
    }
    case BattleMessageType.StatChange: {
      const data = msg.data as { pet: string; stat: string; stage: number; reason: string }
      content = `${getPetName(data.pet, petMap || new Map())} ${data.stat} ${getStatArrows(data.stage).repeat(
        Math.abs(data.stage),
      )} (${data.reason})`
      break
    }
    case BattleMessageType.PetSwitch: {
      const data = msg.data as { player: string; fromPet: string; toPet: string; currentHp: number }
      content = `${playerMap?.get(data.player)?.name || data.player} 更换精灵：${getPetName(
        data.fromPet,
        petMap || new Map(),
      )} → ${getPetName(data.toPet, petMap || new Map())} (剩余HP: ${data.currentHp})`
      break
    }
    case BattleMessageType.RageChange: {
      const data = msg.data as { pet: string; before: number; after: number; reason: string }
      content = `${getPetName(data.pet, petMap || new Map())} 怒气 ${data.before} → ${
        data.after
      } (${RAGE_REASON_MAP[data.reason] || data.reason})`
      break
    }
    case BattleMessageType.SkillMiss: {
      const data = msg.data as { user: string; skill: string; reason: string }
      content = `${getPetName(data.user, petMap || new Map())} 的 ${
        skillMap ? getSkillName(skillMap.get(data.skill)?.baseId || '') : data.skill
      } 未命中！ (${MISS_REASON_MAP[data.reason] || data.reason})`
      break
    }
    case BattleMessageType.PetDefeated: {
      const data = msg.data as { pet: string; killer?: string }
      content = `${getPetName(data.pet, petMap || new Map())} 倒下！`
      if (data.killer) content += ` (击败者: ${getPetName(data.killer, petMap || new Map())})`
      break
    }
    case BattleMessageType.MarkApply: {
      const data = msg.data as { target: string; mark: { baseId: string } }
      content = `${getPetName(data.target, petMap || new Map())} 被施加 【${
        markMap ? getMarkName(markMap.get(data.mark.baseId)?.baseId || '') : data.mark.baseId
      }】 印记`
      break
    }
    case BattleMessageType.BattleEnd:
      content = `🎉 对战结束！胜利者：${msg.data.winner}`
      break
    case BattleMessageType.ForcedSwitch:
      content = `${msg.data.player.map(p => playerMap?.get(p)?.name).join(',')} 必须更换倒下的精灵！`
      break
    case BattleMessageType.FaintSwitch:
      content = `🎁 ${playerMap?.get(msg.data.player)?.name} 击倒对手，获得换宠机会！`
      break
    case BattleMessageType.PetRevive: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.PetRevive]
      const revivedPet = petMap?.get(data.pet)
      content = `${getPetName(data.pet, petMap || new Map())} 被 ${getPetName(data.revivedBy, petMap || new Map())} 复活 (当前HP: ${revivedPet?.currentHp})`
      break
    }
    case BattleMessageType.HpChange: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.HpChange]
      const change = data.after - data.before
      content = `${getPetName(data.pet, petMap || new Map())} HP ${change > 0 ? '+' : ''}${change} (当前: ${data.after}/${data.maxHp}) [${i18next.t(`battle:hpChangeReason.${data.reason}`, { defaultValue: data.reason })}]`
      break
    }
    case BattleMessageType.SkillUseFail: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.SkillUseFail]
      content = `${getPetName(data.user, petMap || new Map())} 无法使用技能：${i18next.t(`battle:skillFailReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.SkillUseEnd: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.SkillUseEnd]
      content = `${getPetName(data.user, petMap || new Map())} 结束技能使用`
      break
    }
    case BattleMessageType.Heal: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.Heal]
      const targetPet = petMap?.get(data.target)
      content = `${getPetName(data.target, petMap || new Map())} 恢复 ${data.amount} HP (当前: ${targetPet?.currentHp})`
      break
    }
    case BattleMessageType.HealFail: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.HealFail]
      content = `${getPetName(data.target, petMap || new Map())} 治疗失败：${i18next.t(`battle:healFailReason.${data.reason}`, { defaultValue: data.reason })}`
      break
    }
    case BattleMessageType.MarkDestory: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkDestory]
      content = `${getPetName(data.target, petMap || new Map())} 的【${getMarkName(data.mark)}】印记被销毁`
      break
    }
    case BattleMessageType.MarkUpdate: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.MarkUpdate]
      content = `${getPetName(data.target, petMap || new Map())} 的【${getMarkName(data.mark.baseId)}】更新为 ${data.mark.stack} 层`
      break
    }
    case BattleMessageType.EffectApply: {
      const data = msg.data as BattleMessageData[typeof BattleMessageType.EffectApply]
      const sourceName =
        getSkillName(skillMap?.get(data.source)?.baseId || data.source) !== data.source
          ? getSkillName(skillMap?.get(data.source)?.baseId || data.source)
          : getMarkName(markMap?.get(data.source)?.baseId || data.source)
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
    default:
      content = ''
  }

  return {
    ...msg,
    icon,
    content,
    timestamp: new Date(Date.now()).toLocaleTimeString(),
  }
}

// 格式化消息数据 - 直接复用 formatBattleMessage 函数
const formattedMessages = computed(() => {
  return messages.map(msg => formatBattleMessage(msg, petMap, skillMap, playerMap, markMap))
})

// 获取格式化后的单个消息 - 直接复用 formatBattleMessage
const getFormattedMessage = (msg: BattleMessage) => {
  return formatBattleMessage(msg, petMap, skillMap, playerMap, markMap)
}

const logContainerRef = ref<HTMLElement | null>(null)

const clearMessages = () => {
  // 由父组件提供清理方法
}
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
  <div class="bg-black/80 rounded-lg p-4 h-full flex flex-col">
    <div
      ref="logContainerRef"
      class="h-full flex-1 overflow-y-auto pr-2 scroll-smooth scrollbar-thin scrollbar-track-white/5 scrollbar-thumb-white/20 scrollbar-thumb-rounded"
    >
      <BattleLogEntry v-for="(msg, index) in formattedMessages" :key="index" :message="msg" />
    </div>
  </div>
</template>
