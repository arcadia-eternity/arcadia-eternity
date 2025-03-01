import type { effectId, effectStateId, markId, petId, playerId, skillId } from './const'

export type EffectStateType = string | number | boolean | petId | markId | playerId | skillId | effectId | effectStateId

type TypeMap = {
  string: 'string'
  number: 'number'
  boolean: 'boolean'
  petId: 'petId'
  markId: 'markId'
  playerId: 'playerId'
  skillId: 'skillId'
  effectId: 'effectId'
  effectStateId: 'effectStateId'
}

// 工具类型：将原始类型 T 转换为字符串字面量
type TypeToKey<T> = T extends number
  ? 'number'
  : T extends boolean
    ? 'boolean'
    : T extends petId
      ? 'petId'
      : T extends markId
        ? 'markId'
        : T extends playerId
          ? 'playerId'
          : T extends skillId
            ? 'skillId'
            : T extends effectId
              ? 'effectId'
              : T extends effectStateId
                ? 'effectStateId'
                : T extends string
                  ? 'string'
                  : never

// 使用转换后的字符串字面量索引 TypeMap
export type EffectState<T extends EffectStateType> = {
  id: effectStateId
  type: TypeMap[TypeToKey<T>]
  value: T
}
