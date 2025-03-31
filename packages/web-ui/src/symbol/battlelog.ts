import type { BattleMessage, PetMessage, SkillMessage, PlayerMessage, MarkMessage } from '@test-battle/const'
import type { InjectionKey } from 'vue'

export const logMessagesKey: InjectionKey<BattleMessage[]> = Symbol('logMessages')
export const petMapKey: InjectionKey<Map<string, PetMessage>> = Symbol('petMap')
export const skillMapKey: InjectionKey<Map<string, SkillMessage>> = Symbol('skillMap')
export const playerMapKey: InjectionKey<Map<string, PlayerMessage>> = Symbol('playerMap')
export const markMapKey: InjectionKey<Map<string, MarkMessage>> = Symbol('markMap')
export const clearLogKey: InjectionKey<() => void> = Symbol('clearLog')
