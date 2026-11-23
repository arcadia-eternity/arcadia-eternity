import { BattleMessageType, type BattleMessage } from '@arcadia-eternity/const'

/** The audit result can identify hidden skills, rules and their numeric operands. */
export function publicBattleMessage(message: BattleMessage): BattleMessage {
  switch (message.type) {
    case BattleMessageType.Damage: {
      const data = { ...message.data }
      delete data.result
      return { ...message, data }
    }
    case BattleMessageType.DamageFail: {
      const data = { ...message.data }
      delete data.result
      return { ...message, data }
    }
    default:
      return message
  }
}
