import type { ConditionDSL, EvaluatorDSL, OperatorDSL } from './effectDsl'
import {
  conditionDSLSchema,
  evaluatorDSLSchema,
  operatorDSLSchema,
  extractDslTypingMetadata,
} from './effectSchema'

export type EffectDslScalarType = 'number' | 'string' | 'boolean' | 'unknown'
export type EffectDslObjectClass<TOwner extends string = string> =
  | `path:${TOwner}:${string}`
  | 'dsl:operator'
  | 'dsl:condition'
  | 'dsl:evaluator'
  | 'dsl:selector'
  | 'dsl:effectDef'
  | 'json:array'
  | 'json:stringArray'
  | 'json:record'

export type EffectDslStateConstraint<TOwner extends string = string> =
  | { kind: 'id'; targets?: readonly TOwner[] }
  | { kind: 'owner'; owners?: readonly TOwner[] }
  | { kind: 'scalar'; valueTypes?: readonly EffectDslScalarType[] }
  | { kind: 'object'; classes?: readonly EffectDslObjectClass<TOwner>[] }
  | { kind: 'propertyRef' }

export type EffectDslFieldTypingRule<TOwner extends string = string> = {
  allow: readonly EffectDslStateConstraint<TOwner>[]
}

export type EffectDslNodeTypingRule<TOwner extends string = string> = {
  selectorFields?: Readonly<Record<string, EffectDslFieldTypingRule<TOwner>>>
  valueFields?: Readonly<Record<string, EffectDslFieldTypingRule<TOwner>>>
}

type ConditionType = ConditionDSL extends { type: infer T extends string } ? T : never
type EvaluatorType = EvaluatorDSL extends { type: infer T extends string } ? T : never
type OperatorType = OperatorDSL extends { type: infer T extends string } ? T : never

export type EffectDslTypingContract<TOwner extends string = string> = {
  condition: Partial<Record<ConditionType, EffectDslNodeTypingRule<TOwner>>>
  evaluator: Partial<Record<EvaluatorType, EffectDslNodeTypingRule<TOwner>>>
  operator: Partial<Record<OperatorType, EffectDslNodeTypingRule<TOwner>>>
}

export function defineEffectDslTypingContract<TOwner extends string>(
  contract: EffectDslTypingContract<TOwner>,
): EffectDslTypingContract<TOwner> {
  return contract
}

export const effectDslTypingContract = defineEffectDslTypingContract({
  condition: extractDslTypingMetadata<EffectDslNodeTypingRule>(conditionDSLSchema) as EffectDslTypingContract['condition'],
  evaluator: extractDslTypingMetadata<EffectDslNodeTypingRule>(evaluatorDSLSchema) as EffectDslTypingContract['evaluator'],
  operator: extractDslTypingMetadata<EffectDslNodeTypingRule>(operatorDSLSchema) as EffectDslTypingContract['operator'],
})
