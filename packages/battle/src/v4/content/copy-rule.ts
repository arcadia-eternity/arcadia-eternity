import type { CapabilityRegistry } from './capabilities'
import { compileRule, type RuleCompileResult } from './compiler'
import { parameterAddress } from './parameters'
import { freezeContent } from './immutable'

type CompiledRule = Extract<RuleCompileResult, { ok: true }>
export type RuleCopyResult =
  | Extract<RuleCompileResult, { ok: false }>
  | (CompiledRule & {
      readonly copiedFrom: string
      readonly parameterRemap: readonly { readonly from: string; readonly to: string }[]
    })

/** Copy one validated definition. Local node IDs stay stable under the new effect namespace.
 * Capability IDs, mark identities, instance readers and literal values are external to this scope.
 * No live Config state, modifiers, or snapshot identities are copied.
 */
export function copyRule(
  input: unknown,
  newId: string,
  registry: CapabilityRegistry,
  options: Parameters<typeof compileRule>[2],
): RuleCopyResult {
  const source = compileRule(input, registry, options)
  if (!source.ok) return source
  if (source.rule.id === newId)
    return freezeContent({
      ok: false,
      diagnostics: [
        {
          code: 'DUPLICATE_ID',
          contentId: options.contentId,
          ruleId: newId,
          field: 'id',
          message: 'DUPLICATE_ID: a copied rule requires a new effect identity',
        },
      ],
    })
  const copy = compileRule({ ...source.rule, id: newId }, registry, options)
  if (!copy.ok) return copy
  const parameterRemap = Object.entries(source.rule.parameters).map(([id, parameter]) => ({
    from: parameterAddress(source.rule.id, parameter.nodeId, id),
    to: parameterAddress(newId, parameter.nodeId, id),
  }))
  return Object.freeze({ ...copy, copiedFrom: source.rule.id, parameterRemap: freezeContent(parameterRemap) })
}
