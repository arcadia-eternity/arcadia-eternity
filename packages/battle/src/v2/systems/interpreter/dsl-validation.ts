import { Value } from '@sinclair/typebox/value'
import {
  conditionDSLSchema,
  operatorDSLSchema,
  type ConditionDSL,
  type OperatorDSL,
} from '@arcadia-eternity/schema'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatInvalid(kind: 'condition' | 'operator', value: unknown): string {
  const hint = isObject(value) && typeof value.type === 'string' ? `type=${value.type}` : `value=${String(value)}`
  return `[effect-interpreter] Invalid ${kind} DSL (${hint})`
}

export function parseConditionDsl(
  raw: unknown,
): ConditionDSL {
  const ok = Value.Check(conditionDSLSchema, raw)
  if (!ok) throw new Error(formatInvalid('condition', raw))
  return raw as ConditionDSL
}

export function parseOperatorDslList(
  raw: unknown,
): OperatorDSL[] {
  const items = Array.isArray(raw) ? raw : [raw]
  const parsed: OperatorDSL[] = []
  for (const item of items) {
    const ok = Value.Check(operatorDSLSchema, item)
    if (ok) {
      parsed.push(item as OperatorDSL)
    } else {
      throw new Error(formatInvalid('operator', item))
    }
  }
  return parsed
}
