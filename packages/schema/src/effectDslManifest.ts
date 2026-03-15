import {
  conditionDSLSchema,
  evaluatorDSLSchema,
  operatorDSLSchema,
  extractDslNodeTypes,
  extractDslTypingMetadata,
} from './effectSchema'
import type { EffectDslNodeTypingRule } from './effectTypingContract'

export type EffectDslNodeKind = 'condition' | 'evaluator' | 'operator'

export type EffectDslManifestSection = Readonly<Record<string, EffectDslNodeTypingRule | undefined>>

export type EffectDslManifest = {
  condition: EffectDslManifestSection
  evaluator: EffectDslManifestSection
  operator: EffectDslManifestSection
}

function buildManifestSection(schema: unknown): EffectDslManifestSection {
  const uniqueTypes = extractDslNodeTypes(schema)
  const typing = extractDslTypingMetadata<EffectDslNodeTypingRule>(schema)
  const out: Record<string, EffectDslNodeTypingRule | undefined> = {}
  for (const type of uniqueTypes) {
    out[type] = typing[type]
  }
  return out
}

export function buildEffectDslManifest(): EffectDslManifest {
  return {
    condition: buildManifestSection(conditionDSLSchema),
    evaluator: buildManifestSection(evaluatorDSLSchema),
    operator: buildManifestSection(operatorDSLSchema),
  }
}

const effectDslManifest = buildEffectDslManifest()

export function getEffectDslManifest(): EffectDslManifest {
  return effectDslManifest
}

export function getEffectDslNodeTyping(
  kind: EffectDslNodeKind,
  type: string,
): EffectDslNodeTypingRule | undefined {
  if (!type) return undefined
  return effectDslManifest[kind][type]
}
