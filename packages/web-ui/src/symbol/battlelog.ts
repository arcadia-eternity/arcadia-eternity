import type { BattleMessage } from '@arcadia-eternity/const'
import type { InjectionKey } from 'vue'

// 带时间戳的战斗消息类型
export type TimestampedBattleMessage = BattleMessage & {
  receivedAt: number // 消息接收时的时间戳
}

export const logMessagesKey: InjectionKey<TimestampedBattleMessage[]> = Symbol('logMessages')
export const clearLogKey: InjectionKey<() => void> = Symbol('clearLog')
