import type { BattleMessage, PetMessage, SkillMessage, PlayerMessage, MarkMessage } from '@arcadia-eternity/const'
import type { InjectionKey } from 'vue'

// 带时间戳的战斗消息类型
export interface TimestampedBattleMessage extends BattleMessage {
  receivedAt: number // 消息接收时的时间戳
}

export const logMessagesKey: InjectionKey<TimestampedBattleMessage[]> = Symbol('logMessages')
export const petMapKey: InjectionKey<Map<string, PetMessage>> = Symbol('petMap')
export const skillMapKey: InjectionKey<Map<string, SkillMessage>> = Symbol('skillMap')
export const playerMapKey: InjectionKey<Map<string, PlayerMessage>> = Symbol('playerMap')
export const markMapKey: InjectionKey<Map<string, MarkMessage>> = Symbol('markMap')
export const clearLogKey: InjectionKey<() => void> = Symbol('clearLog')
