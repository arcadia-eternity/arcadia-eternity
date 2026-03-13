// battle/src/v2/data/parsers/effect-parser.ts
// Parse raw YAML effect data → engine EffectDef.

import type { EffectDef } from '@arcadia-eternity/engine'
import { conditionDSLSchema, operatorDSLSchema } from '@arcadia-eternity/schema'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  createEffectCompileTypingValidator,
  type EffectCompileTypingEnvironment,
} from './effect-compile-validator.js'
import { seer2EffectCompileTypingEnvironment } from './effect-compile-environment.js'
import { assertRegisteredEffectTrigger } from './trigger-registry.js'

const effectCompileSchema = Type.Object({
  id: Type.String(),
  trigger: Type.Union([Type.String(), Type.Array(Type.String())]),
  priority: Type.Number(),
  apply: Type.Union([operatorDSLSchema, Type.Array(operatorDSLSchema)]),
  condition: Type.Optional(conditionDSLSchema),
  consumesStacks: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String(), { default: [] })),
})

const defaultCompileTypingValidator = createEffectCompileTypingValidator(
  seer2EffectCompileTypingEnvironment,
)

type EffectCompileTypingValidator = (raw: Record<string, unknown>) => void
type TriggerAssertion = (trigger: string, path: string) => void

export type EffectParserEnvironment = {
  compileTypingEnvironment?: EffectCompileTypingEnvironment
  validateCompileTyping?: EffectCompileTypingValidator
  assertTriggerRegistered?: TriggerAssertion
}

/**
 * Convert a raw YAML effect object to an engine EffectDef.
 * - `trigger` (string | string[]) → `triggers` (string[])
 * - `apply` and `condition` are passed through as opaque DSL JSON.
 */
export function createEffectParser(
  environment: EffectParserEnvironment = {},
): (raw: Record<string, unknown>) => EffectDef {
  const validateCompileTyping = environment.validateCompileTyping
    ?? (
      environment.compileTypingEnvironment
        ? createEffectCompileTypingValidator(environment.compileTypingEnvironment)
        : defaultCompileTypingValidator
    )
  const assertTrigger = environment.assertTriggerRegistered ?? assertRegisteredEffectTrigger

  return (raw: Record<string, unknown>): EffectDef => {
    if (!Value.Check(effectCompileSchema, raw)) {
      const first = [...Value.Errors(effectCompileSchema, raw)][0]
      const path = first?.path ?? '/'
      const message = first?.message ?? 'invalid effect DSL'
      throw new Error(`Effect strict compile failed at ${path}: ${message}`)
    }
    validateCompileTyping(raw)

    const id = raw.id as string
    if (!id) throw new Error('Effect missing "id"')

    const rawTrigger = raw.trigger
    const triggers: string[] = Array.isArray(rawTrigger) ? rawTrigger : [rawTrigger as string]
    for (let i = 0; i < triggers.length; i++) {
      const path = Array.isArray(rawTrigger) ? `/trigger/${i}` : '/trigger'
      assertTrigger(triggers[i], path)
    }

    const priority = raw.priority as number

    const apply = raw.apply
    if (apply === undefined) throw new Error(`Effect '${id}' missing "apply"`)

    return {
      id,
      triggers,
      priority,
      apply,
      condition: raw.condition,
      consumesStacks: raw.consumesStacks as number | undefined,
      tags: (raw.tags as string[]) ?? [],
    }
  }
}

const defaultParseEffect = createEffectParser()

export function parseEffect(raw: Record<string, unknown>): EffectDef {
  return defaultParseEffect(raw)
}
