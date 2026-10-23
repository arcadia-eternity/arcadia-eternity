import { Type, type Static } from '@sinclair/typebox'
import type { ActionRuntime, CapabilityNeed, CapabilityRegistry } from './capabilities'
import type { ParameterLinker } from './capability-parameters'

export const predicateInvocationSchema = Type.Object(
  {
    nodeId: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    params: Type.Unknown({ default: {} }),
  },
  { additionalProperties: false },
)

export const conditionSchema = Type.Recursive(
  Self =>
    Type.Union([
      predicateInvocationSchema,
      Type.Object(
        {
          nodeId: Type.String({ minLength: 1 }),
          kind: Type.Union([Type.Literal('all'), Type.Literal('any')]),
          conditions: Type.Array(Self, { minItems: 1, maxItems: 64 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { nodeId: Type.String({ minLength: 1 }), kind: Type.Literal('not'), condition: Self },
        { additionalProperties: false },
      ),
    ]),
  { $id: 'ae:condition' },
)
export type ConditionData = Static<typeof conditionSchema>
export const conditionLimits = Object.freeze({ depth: 8, nodes: 64 })

/** Visit every branch before compilation, including branches that may short-circuit at runtime. */
export function validateConditionTree(root: ConditionData, visit: (nodeId: string) => void): void {
  let count = 0
  const walk = (node: ConditionData, depth: number): void => {
    visit(node.nodeId)
    if (++count > conditionLimits.nodes || depth > conditionLimits.depth)
      throw new Error('LIMIT_EXCEEDED: condition tree')
    if ('id' in node) return
    if (node.kind === 'not') walk(node.condition, depth + 1)
    else node.conditions.forEach(child => walk(child, depth + 1))
  }
  walk(root, 1)
}
interface CompiledCondition {
  readonly data: ConditionData
  readonly test: (runtime: () => ActionRuntime) => boolean
}
export function compileConditionTree(
  node: ConditionData,
  registry: CapabilityRegistry,
  available: readonly CapabilityNeed[],
  linker: ParameterLinker,
  visit: (nodeId: string) => void,
): CompiledCondition {
  visit(node.nodeId)
  if ('id' in node) {
    const predicate = registry.compilePredicate(node.id, node.params, available, linker)
    return { data: { ...node, params: predicate.params }, test: runtime => predicate.test(runtime()) }
  }
  if (node.kind === 'not') {
    const child = compileConditionTree(node.condition, registry, available, linker, visit)
    return { data: { ...node, condition: child.data }, test: runtime => !child.test(runtime) }
  }
  const children = node.conditions.map(child => compileConditionTree(child, registry, available, linker, visit))
  return {
    data: { ...node, conditions: children.map(child => child.data) },
    test: runtime =>
      node.kind === 'all' ? children.every(child => child.test(runtime)) : children.some(child => child.test(runtime)),
  }
}
