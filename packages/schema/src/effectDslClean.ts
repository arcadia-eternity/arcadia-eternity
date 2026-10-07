import { effectDslTypingContract } from './effectTypingContract'
import type { EffectDslNodeTypingRule } from './effectTypingContract'

/**
 * Recursively strips optional fields whose value is undefined from an effect DSL object.
 * Uses the typing metadata's requiredFields to determine which fields are optional.
 * Fields NOT in requiredFields are optional and will be removed if their value is undefined.
 */
export function stripUndefinedOptionals(node: unknown): unknown {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) {
    return node.map(stripUndefinedOptionals)
  }
  if (typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const type = obj.type as string | undefined
  const typingRule = type ? findTypingRule(type) : undefined
  const requiredFields = typingRule?.requiredFields ?? []

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value === undefined && !requiredFields.includes(key)) {
      continue
    }
    result[key] = stripUndefinedOptionals(value)
  }
  return result
}

function findTypingRule(type: string): EffectDslNodeTypingRule | undefined {
  const contract = effectDslTypingContract
  return (
    (contract.operator as Record<string, EffectDslNodeTypingRule | undefined>)[type] ??
    (contract.condition as Record<string, EffectDslNodeTypingRule | undefined>)[type] ??
    (contract.evaluator as Record<string, EffectDslNodeTypingRule | undefined>)[type]
  )
}
