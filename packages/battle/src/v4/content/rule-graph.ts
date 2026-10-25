import { Type, type TSchema } from '@sinclair/typebox'
import { Value as SchemaValue } from '@sinclair/typebox/value'
import type * as A from './authoring/contracts'
import type { CapabilityNeed, CapabilityRegistry } from './capabilities'
import type { EffectSourceKind } from './triggers'
import {
  normalizeRuleCapabilityParams,
  RuleSlotError,
  type RuleCapabilityMetadata,
  type RuleValueCategory,
  type RuleValueNode,
  type RuleInputReference,
} from './rule-values'
import { meterRuleAction } from './authoring/runtime'

export const ruleGraphLimits = Object.freeze({ nodes: 128, depth: 16 })
interface BuiltValue {
  readonly category: RuleValueCategory
  readonly value: unknown
}
export function compileRuleGraph(options: {
  readonly nodes: readonly RuleValueNode[]
  readonly registry: CapabilityRegistry
  readonly sourceKind: EffectSourceKind
  readonly available: readonly CapabilityNeed[]
  readonly claim: (id: string) => void
  readonly numberReference: (
    reference: Exclude<RuleInputReference, { node: string }>,
    schema: TSchema,
  ) => A.Value<number, A.Presence>
}) {
  const { registry } = options
  const nodes = new Map<string, { readonly value: RuleValueNode; readonly index: number }>()
  const built = new Map<string, BuiltValue>(),
    normalized = new Map<string, RuleValueNode>(),
    pending = new Set<string>()
  if (options.nodes.length > ruleGraphLimits.nodes)
    throw new RuleSlotError(undefined, '/values', 'LIMIT_EXCEEDED: value node count')
  options.nodes.forEach((value, index) => {
    try {
      options.claim(value.nodeId)
    } catch (error) {
      throw new RuleSlotError(
        value.nodeId,
        `/values/${index}/nodeId`,
        error instanceof Error ? error.message : 'Duplicate node',
      )
    }
    nodes.set(value.nodeId, { value, index })
  })
  // Compute dependency heights independently of compilation cache and document declaration order.
  const heights = new Map<string, number>(),
    visiting = new Set<string>()
  const height = (id: string): number => {
    const entry = nodes.get(id)!,
      location = `/values/${entry.index}`
    if (visiting.has(id)) throw new RuleSlotError(id, location, 'INVALID_PARAMETERS: cyclic value graph')
    const known = heights.get(id)
    if (known !== undefined) return known
    visiting.add(id)
    let result = 1
    for (const [slot, reference] of Object.entries(entry.value.inputs ?? {})) {
      if (!('node' in reference)) continue
      if (!nodes.has(reference.node))
        throw new RuleSlotError(id, `${location}/inputs/${slot}/node`, `MISSING_REFERENCE: ${reference.node}`)
      result = Math.max(result, 1 + height(reference.node))
    }
    visiting.delete(id)
    if (result > ruleGraphLimits.depth) throw new RuleSlotError(id, location, 'LIMIT_EXCEEDED: value graph depth')
    heights.set(id, result)
    return result
  }
  for (const id of nodes.keys()) height(id)
  const checkContext = (contract: RuleCapabilityMetadata, nodeId: string, field: string) => {
    if (!contract.sourceKinds.includes(options.sourceKind))
      throw new RuleSlotError(
        nodeId,
        `${field}/id`,
        `CAPABILITY_MISMATCH: ${contract.id} does not support ${options.sourceKind}`,
      )
    for (const need of contract.needs)
      if (!options.available.includes(need))
        throw new RuleSlotError(nodeId, `${field}/id`, `CAPABILITY_MISMATCH: ${contract.id} requires ${need}`)
  }
  const inputs = (
    contract: RuleCapabilityMetadata,
    refs: Readonly<Record<string, RuleInputReference>> | undefined,
    nodeId: string,
    field: string,
    depth: number,
  ) => {
    const supplied = refs ?? {},
      result: Record<string, unknown> = Object.create(null)
    for (const name of Object.keys(supplied))
      if (!Object.hasOwn(contract.inputs, name))
        throw new RuleSlotError(nodeId, `${field}/inputs/${name}`, `CAPABILITY_MISMATCH: unknown input slot ${name}`)
    for (const [name, expected] of Object.entries(contract.inputs)) {
      const ref = supplied[name],
        location = `${field}/inputs/${name}`
      if (!ref) throw new RuleSlotError(nodeId, location, `MISSING_REFERENCE: input ${name}`)
      const schema = contract.inputSchemas[name] ?? Type.Number()
      let value: unknown
      if ('node' in ref) {
        if (!nodes.has(ref.node)) throw new RuleSlotError(nodeId, `${location}/node`, `MISSING_REFERENCE: ${ref.node}`)
        const input = compile(ref.node, depth + 1)
        if (input.category !== expected)
          throw new RuleSlotError(
            nodeId,
            location,
            `CAPABILITY_MISMATCH: ${name} expects ${expected}, received ${input.category}`,
          )
        value = input.value
      } else {
        if (expected !== 'number')
          throw new RuleSlotError(
            nodeId,
            location,
            `CAPABILITY_MISMATCH: parameter needs a numeric value slot, received ${expected}`,
          )
        try {
          value = options.numberReference(ref, schema)
        } catch (error) {
          throw new RuleSlotError(
            nodeId,
            location,
            error instanceof Error ? error.message : 'Invalid parameter reference',
          )
        }
      }
      if (expected === 'number')
        value = (value as A.Value<number, A.Presence>).map(number => {
          if (!SchemaValue.Check(schema, number)) throw new Error(`Invalid effective rule input: ${nodeId}/${name}`)
          return number
        })
      result[name] = value
    }
    return result
  }
  function compile(id: string, depth: number): BuiltValue {
    const entry = nodes.get(id)!
    const location = `/values/${entry.index}`,
      node = entry.value
    if (depth > ruleGraphLimits.depth) throw new RuleSlotError(id, location, 'LIMIT_EXCEEDED: value graph depth')
    if (pending.has(id)) throw new RuleSlotError(id, location, 'INVALID_PARAMETERS: cyclic value graph')
    const existing = built.get(id)
    if (existing) return existing
    pending.add(id)
    try {
      let contract
      try {
        contract = registry.getRuleValue(node.id)
      } catch (error) {
        throw new RuleSlotError(id, `${location}/id`, error instanceof Error ? error.message : 'Unknown value')
      }
      checkContext(contract, id, location)
      const params = normalizeRuleCapabilityParams(contract, node.params, id, `${location}/params`)
      const arguments_ = inputs(contract, node.inputs, id, location, depth)
      let value: unknown
      try {
        value = contract.build(id, params, arguments_)
      } catch (error) {
        throw new RuleSlotError(
          id,
          `${location}/params`,
          error instanceof Error ? error.message : 'Invalid value definition',
        )
      }
      const result = { category: contract.output, value }
      built.set(id, result)
      normalized.set(id, { ...node, params })
      return result
    } finally {
      pending.delete(id)
    }
  }
  // Validate all nodes, including otherwise unused branches.
  for (const node of options.nodes) compile(node.nodeId, 1)
  return {
    nodes: options.nodes.map(node => normalized.get(node.nodeId)!),
    compileOperation(
      action: {
        readonly stepId: string
        readonly id: string
        readonly params: unknown
        readonly inputs?: Readonly<Record<string, RuleInputReference>>
      },
      index: number,
    ): { readonly action: A.Action; readonly params: unknown } | undefined {
      let contract
      try {
        contract = registry.getRuleOperation(action.id)
      } catch (error) {
        throw new RuleSlotError(
          action.stepId,
          `/actions/${index}/id`,
          error instanceof Error ? error.message : 'Unknown operation',
        )
      }
      if (!contract) {
        if (action.inputs !== undefined)
          throw new RuleSlotError(
            action.stepId,
            `/actions/${index}/inputs`,
            'CAPABILITY_MISMATCH: legacy action has no value slots',
          )
        return undefined
      }
      const location = `/actions/${index}`
      checkContext(contract, action.stepId, location)
      const params = normalizeRuleCapabilityParams(contract, action.params, action.stepId, `${location}/params`)
      const arguments_ = inputs(contract, action.inputs, action.stepId, location, 0)
      try {
        return { params, action: meterRuleAction(contract.build(action.stepId, params, arguments_)) }
      } catch (error) {
        throw new RuleSlotError(
          action.stepId,
          `${location}/params`,
          error instanceof Error ? error.message : 'Invalid operation',
        )
      }
    },
  }
}
