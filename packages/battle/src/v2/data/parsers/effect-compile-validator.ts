import {
  BASE_SELECTOR_KEYS,
  conditionDSLSchema,
  evaluatorDSLSchema,
  operatorDSLSchema,
  extractDslTypingMetadata,
  type EffectDslFieldTypingRule,
  type EffectDslStateConstraint,
  type EntityKind,
  type ExtractorValueType,
} from '@arcadia-eternity/schema'
import type { TSchema } from '@sinclair/typebox'
import { battleExtractorRegistry } from '../../systems/extractor-registry.js'
import { BaseMarkSchema } from '../../schemas/mark.schema.js'
import { BaseSkillSchema } from '../../schemas/skill.schema.js'

type CompileOwner =
  | EntityKind
  | 'baseMark'
  | 'baseSkill'
  | 'effectDef'
  | 'effectContext'
  | 'unknown'

type CompileScalarType = 'number' | 'string' | 'boolean' | 'unknown'
type CompileObjectClass =
  | `path:${CompileOwner}:${string}`
  | 'dsl:operator'
  | 'dsl:condition'
  | 'dsl:evaluator'
  | 'dsl:selector'
  | 'dsl:effectDef'
  | 'json:array'
  | 'json:stringArray'
  | 'json:record'

type CompileValueState =
  | { kind: 'scalar'; valueType: CompileScalarType }
  | { kind: 'object'; objectClass: CompileObjectClass; owner?: CompileOwner; path?: string }

type CompileState =
  | { kind: 'owner'; owner: CompileOwner }
  | { kind: 'id'; target: CompileOwner }
  | CompileValueState
  | { kind: 'propertyRef' }

const baseSelectorKeySet = new Set<string>(BASE_SELECTOR_KEYS)
const conditionTypeSet = collectNodeTypes(conditionDSLSchema)
const evaluatorTypeSet = collectNodeTypes(evaluatorDSLSchema)
const operatorTypeSet = collectNodeTypes(operatorDSLSchema)
type CompileNodeTypingRule = {
  selectorFields?: Record<string, EffectDslFieldTypingRule>
  valueFields?: Record<string, EffectDslFieldTypingRule>
}
const conditionTypingRules = extractDslTypingMetadata<CompileNodeTypingRule>(conditionDSLSchema) as Partial<Record<string, CompileNodeTypingRule>>
const evaluatorTypingRules = extractDslTypingMetadata<CompileNodeTypingRule>(evaluatorDSLSchema) as Partial<Record<string, CompileNodeTypingRule>>
const operatorTypingRules = extractDslTypingMetadata<CompileNodeTypingRule>(operatorDSLSchema) as Partial<Record<string, CompileNodeTypingRule>>

type RelationMeta = {
  target: CompileOwner
  cardinality: 'one' | 'many'
}

const attributeKeysByOwner = new Map<CompileOwner, Set<string>>()
const attributeTypesByOwner = new Map<CompileOwner, Map<string, CompileValueState>>()
const relationByOwner = new Map<CompileOwner, Map<string, RelationMeta>>()
const fieldPathsByOwner = new Map<CompileOwner, Set<string>>()
const fieldTypesByOwner = new Map<CompileOwner, Map<string, CompileValueState>>()

function pathObjectClass(owner: CompileOwner, path: string): CompileObjectClass {
  return `path:${owner}:${path}`
}

function pathObjectState(owner: CompileOwner, path: string): CompileValueState {
  return {
    kind: 'object',
    objectClass: pathObjectClass(owner, path),
    owner,
    path,
  }
}

for (const attr of battleExtractorRegistry.attributes) {
  for (const owner of attr.owners) {
    addSet(attributeKeysByOwner, owner as CompileOwner, attr.key)
    addTypedKey(
      attributeTypesByOwner,
      owner as CompileOwner,
      attr.key,
      stateFromExtractorValueType(attr.valueType, owner as CompileOwner, attr.key),
    )
  }
}
for (const rel of battleExtractorRegistry.relations) {
  for (const owner of rel.owners) {
    let ownerMap = relationByOwner.get(owner as CompileOwner)
    if (!ownerMap) {
      ownerMap = new Map<string, RelationMeta>()
      relationByOwner.set(owner as CompileOwner, ownerMap)
    }
    ownerMap.set(rel.key, {
      target: rel.target as CompileOwner,
      cardinality: rel.cardinality,
    })
  }
}
for (const field of battleExtractorRegistry.fields) {
  for (const owner of field.owners) {
    addSet(fieldPathsByOwner, owner as CompileOwner, field.path)
    addTypedKey(
      fieldTypesByOwner,
      owner as CompileOwner,
      field.path,
      stateFromExtractorValueType(field.valueType, owner as CompileOwner, field.path),
    )
  }
}

for (const field of collectSchemaFields('baseMark', BaseMarkSchema)) {
  addSet(fieldPathsByOwner, 'baseMark', field.path)
  addTypedKey(fieldTypesByOwner, 'baseMark', field.path, field.valueType)
}
for (const field of collectSchemaFields('baseSkill', BaseSkillSchema)) {
  addSet(fieldPathsByOwner, 'baseSkill', field.path)
  addTypedKey(fieldTypesByOwner, 'baseSkill', field.path, field.valueType)
}

for (const path of ['id', 'triggers', 'priority', 'condition', 'apply', 'consumesStacks', 'tags']) {
  addSet(fieldPathsByOwner, 'effectDef', path)
}
addTypedKey(fieldTypesByOwner, 'effectDef', 'id', { kind: 'scalar', valueType: 'string' })
addTypedKey(fieldTypesByOwner, 'effectDef', 'triggers', pathObjectState('effectDef', 'triggers'))
addTypedKey(fieldTypesByOwner, 'effectDef', 'priority', { kind: 'scalar', valueType: 'number' })
addTypedKey(fieldTypesByOwner, 'effectDef', 'condition', pathObjectState('effectDef', 'condition'))
addTypedKey(fieldTypesByOwner, 'effectDef', 'apply', pathObjectState('effectDef', 'apply'))
addTypedKey(fieldTypesByOwner, 'effectDef', 'consumesStacks', { kind: 'scalar', valueType: 'number' })
addTypedKey(fieldTypesByOwner, 'effectDef', 'tags', pathObjectState('effectDef', 'tags'))
for (const path of [
  'trigger',
  'sourceEntityId',
  'triggerSourceEntityId',
  'effectEntityId',
  'effectId',
  'available',
  'effect',
  'context',
  'useSkillContext',
  'damageContext',
  'healContext',
  'rageContext',
  'addMarkContext',
  'switchPetContext',
  'turnContext',
  'stackContext',
  'consumeStackContext',
  'transformContext',
  'removeMarkContext',
]) {
  addSet(fieldPathsByOwner, 'effectContext', path)
}
for (const key of ['trigger', 'sourceEntityId', 'triggerSourceEntityId', 'effectEntityId', 'effectId']) {
  addTypedKey(fieldTypesByOwner, 'effectContext', key, { kind: 'scalar', valueType: 'string' })
}
addTypedKey(fieldTypesByOwner, 'effectContext', 'available', { kind: 'scalar', valueType: 'boolean' })
for (const key of [
  'effect',
  'context',
  'useSkillContext',
  'damageContext',
  'healContext',
  'rageContext',
  'addMarkContext',
  'switchPetContext',
  'turnContext',
  'stackContext',
  'consumeStackContext',
  'transformContext',
  'removeMarkContext',
]) {
  addTypedKey(fieldTypesByOwner, 'effectContext', key, pathObjectState('effectContext', key))
}
{
  let effectContextRelations = relationByOwner.get('effectContext')
  if (!effectContextRelations) {
    effectContextRelations = new Map<string, RelationMeta>()
    relationByOwner.set('effectContext', effectContextRelations)
  }
  effectContextRelations.set('effect', { target: 'effectDef', cardinality: 'one' })
}
for (const [path, valueType] of fieldTypesByOwner.get('effectDef') ?? []) {
  const nestedPath = `effect.${path}`
  addSet(fieldPathsByOwner, 'effectContext', nestedPath)
  if (valueType.kind === 'object') {
    addTypedKey(fieldTypesByOwner, 'effectContext', nestedPath, pathObjectState('effectContext', nestedPath))
  } else {
    addTypedKey(fieldTypesByOwner, 'effectContext', nestedPath, valueType)
  }
}

function addSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  let set = map.get(key)
  if (!set) {
    set = new Set<string>()
    map.set(key, set)
  }
  set.add(value)
}

function addTypedKey<K>(
  map: Map<K, Map<string, CompileValueState>>,
  key: K,
  path: string,
  valueType: CompileValueState,
): void {
  let ownerMap = map.get(key)
  if (!ownerMap) {
    ownerMap = new Map<string, CompileValueState>()
    map.set(key, ownerMap)
  }
  ownerMap.set(path, valueType)
}

function stateFromExtractorValueType(
  valueType: ExtractorValueType,
  owner: CompileOwner,
  path: string,
): CompileValueState {
  switch (valueType) {
    case 'number':
      return { kind: 'scalar', valueType: 'number' }
    case 'string':
    case 'id':
      return { kind: 'scalar', valueType: 'string' }
    case 'boolean':
      return { kind: 'scalar', valueType: 'boolean' }
    case 'id[]':
    case 'object':
      return pathObjectState(owner, path)
    default:
      return { kind: 'scalar', valueType: 'unknown' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type JsonSchemaNode = {
  type?: unknown
  const?: unknown
  properties?: Record<string, unknown>
  items?: unknown
  anyOf?: unknown[]
  oneOf?: unknown[]
  allOf?: unknown[]
}

function asNode(value: unknown): JsonSchemaNode | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonSchemaNode) : undefined
}

function collectNodeTypes(schema: unknown, out = new Set<string>()): Set<string> {
  const node = asNode(schema)
  if (!node) return out
  const typeNode = asNode(node.properties?.type)
  if (typeof typeNode?.const === 'string') out.add(typeNode.const)
  const variants = [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]
  for (const variant of variants) collectNodeTypes(variant, out)
  return out
}

type SchemaFieldMeta = {
  path: string
  valueType: CompileValueState
}

function inferValueStateFromSchema(owner: CompileOwner, path: string, schema: unknown): CompileValueState {
  const node = asNode(schema)
  const type = typeof node?.type === 'string' ? node.type : undefined
  if (type === 'number' || type === 'integer') return { kind: 'scalar', valueType: 'number' }
  if (type === 'string') return { kind: 'scalar', valueType: 'string' }
  if (type === 'boolean') return { kind: 'scalar', valueType: 'boolean' }
  if (type === 'array' || type === 'object') return pathObjectState(owner, path)
  const variants = [...(node?.anyOf ?? []), ...(node?.oneOf ?? [])]
  if (variants.length > 0) {
    const inferred = variants.map(variant => inferValueStateFromSchema(owner, path, variant))
    const first = inferred[0]
    if (first) {
      if (
        inferred.every(v => v.kind === 'scalar' && first.kind === 'scalar' && v.valueType === first.valueType)
      ) {
        return first
      }
      if (
        inferred.every(v => v.kind === 'object' && first.kind === 'object' && v.objectClass === first.objectClass)
      ) {
        return first
      }
    }
  }
  return { kind: 'scalar', valueType: 'unknown' }
}

function collectSchemaFields(
  owner: CompileOwner,
  schema: TSchema | unknown,
  prefix = '',
  depth = 0,
): SchemaFieldMeta[] {
  if (depth > 5) return []
  const node = asNode(schema)
  if (!node) return []
  const out: SchemaFieldMeta[] = []
  const properties = node.properties ?? {}
  for (const [key, child] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push({
      path,
      valueType: inferValueStateFromSchema(owner, path, child),
    })
    const childNode = asNode(child)
    if (childNode?.type === 'object' && childNode.properties) {
      out.push(...collectSchemaFields(owner, childNode, path, depth + 1))
    }
    if (childNode?.type === 'array') {
      const itemNode = asNode(childNode.items)
      if (itemNode?.type === 'object' && itemNode.properties) {
        out.push(...collectSchemaFields(owner, itemNode, `${path}[]`, depth + 1))
      }
    }
    const variants = [...(childNode?.anyOf ?? []), ...(childNode?.oneOf ?? [])]
    for (const variant of variants) {
      const variantNode = asNode(variant)
      if (variantNode?.type === 'object' && variantNode.properties) {
        out.push(...collectSchemaFields(owner, variantNode, path, depth + 1))
      }
    }
  }
  return out
}

function hasField(owner: CompileOwner, path: string): boolean {
  return fieldPathsByOwner.get(owner)?.has(path) === true
}

function hasAttribute(owner: CompileOwner, key: string): boolean {
  return attributeKeysByOwner.get(owner)?.has(key) === true
}

function getAttributeState(owner: CompileOwner, key: string): CompileValueState | undefined {
  return attributeTypesByOwner.get(owner)?.get(key)
}

function getRelation(owner: CompileOwner, key: string): RelationMeta | undefined {
  return relationByOwner.get(owner)?.get(key)
}

function getFieldState(owner: CompileOwner, path: string): CompileValueState | undefined {
  return fieldTypesByOwner.get(owner)?.get(path)
}

function inferIdTarget(owner: CompileOwner, key: string): CompileOwner | undefined {
  switch (owner) {
    case 'pet':
      if (key === 'id') return 'pet'
      if (key === 'ownerId') return 'player'
      if (key === 'lastSkillId') return 'skill'
      return undefined
    case 'skill':
      if (key === 'id') return 'skill'
      if (key === 'ownerId') return 'pet'
      if (key === 'baseSkillId') return 'baseSkill'
      return undefined
    case 'mark':
      if (key === 'id') return 'mark'
      if (key === 'ownerId') return 'pet'
      if (key === 'baseMarkId') return 'baseMark'
      if (key === 'creatorId') return 'pet'
      return undefined
    case 'player':
      if (key === 'id') return 'player'
      if (key === 'activePetId') return 'pet'
      return undefined
    case 'useSkillContext':
      if (key === 'petId') return 'pet'
      if (key === 'skillId') return 'skill'
      if (key === 'originPlayerId') return 'player'
      if (key === 'actualTargetId') return 'pet'
      return undefined
    case 'damageContext':
      if (key === 'sourceId') return 'pet'
      if (key === 'targetId') return 'pet'
      return undefined
    case 'healContext':
      if (key === 'sourceId') return 'pet'
      if (key === 'targetId') return 'pet'
      return undefined
    case 'addMarkContext':
      if (key === 'targetId') return 'pet'
      if (key === 'baseMarkId') return 'baseMark'
      if (key === 'creatorId') return 'pet'
      return undefined
    case 'switchPetContext':
      if (key === 'originPlayerId') return 'player'
      if (key === 'switchInPetId') return 'pet'
      if (key === 'switchOutPetId') return 'pet'
      return undefined
    case 'stackContext':
      if (key === 'existingMarkId') return 'mark'
      if (key === 'incomingMarkId') return 'mark'
      return undefined
    case 'consumeStackContext':
      if (key === 'markId') return 'mark'
      return undefined
    case 'effectContext':
      if (key === 'effectId') return 'effectDef'
      return undefined
    case 'baseMark':
      if (key === 'id') return 'baseMark'
      return undefined
    case 'baseSkill':
      if (key === 'id') return 'baseSkill'
      return undefined
    case 'effectDef':
      if (key === 'id') return 'effectDef'
      return undefined
    default:
      return undefined
  }
}

function stateFromPath(owner: CompileOwner, key: string): CompileState[] {
  const idTarget = inferIdTarget(owner, key)
  if (idTarget) return [{ kind: 'id', target: idTarget }]
  const attrState = getAttributeState(owner, key)
  if (attrState) return [attrState]
  const fieldState = getFieldState(owner, key)
  if (fieldState) return [fieldState]
  return [{ kind: 'scalar', valueType: 'unknown' }]
}

function resolvePathFromOwner(owner: CompileOwner, path: string, at: string): CompileState[] {
  if (owner === 'unknown') {
    throw new Error(`selector typing failed at ${at}: cannot validate path '${path}' on unknown owner`)
  }

  if (path.includes('.')) {
    if (!hasField(owner, path)) {
      throw new Error(`selector typing failed at ${at}: path '${path}' is not declared on owner '${owner}'`)
    }
    return stateFromPath(owner, path)
  }

  const relation = getRelation(owner, path)
  if (relation) return [{ kind: 'id', target: relation.target }]
  if (hasAttribute(owner, path)) return stateFromPath(owner, path)
  if (hasField(owner, path)) return stateFromPath(owner, path)

  throw new Error(`selector typing failed at ${at}: path '${path}' is not declared on owner '${owner}'`)
}

function resolvePathFromId(target: CompileOwner, path: string, at: string): CompileState[] {
  if (target === 'unknown') {
    throw new Error(`selector typing failed at ${at}: cannot validate path '${path}' on unknown entity id`)
  }

  if (path === 'id') return [{ kind: 'id', target }]

  if (path === 'baseId') {
    if (target === 'skill' || target === 'baseSkill') return [{ kind: 'id', target: 'baseSkill' }]
    if (target === 'mark' || target === 'baseMark') return [{ kind: 'id', target: 'baseMark' }]
    throw new Error(`selector typing failed at ${at}: extractor 'baseId' is invalid for '${target}' id`)
  }

  if (path === 'owner') {
    if (target === 'pet' || target === 'skill' || target === 'mark') return [{ kind: 'id', target: 'player' }]
    throw new Error(`selector typing failed at ${at}: extractor 'owner' is invalid for '${target}' id`)
  }

  if (path === 'marks') {
    if (target === 'pet' || target === 'skill' || target === 'player' || target === 'battle') {
      return [{ kind: 'id', target: 'mark' }]
    }
    throw new Error(`selector typing failed at ${at}: extractor 'marks' is invalid for '${target}' id`)
  }

  if (path === 'skills') {
    if (target === 'pet') return [{ kind: 'id', target: 'skill' }]
    throw new Error(`selector typing failed at ${at}: extractor 'skills' is invalid for '${target}' id`)
  }

  if (path === 'activePet') {
    if (target === 'player') return [{ kind: 'id', target: 'pet' }]
    throw new Error(`selector typing failed at ${at}: extractor 'activePet' is invalid for '${target}' id`)
  }

  if (path === 'currentTurn') {
    if (target === 'battle') return [{ kind: 'scalar', valueType: 'number' }]
    throw new Error(`selector typing failed at ${at}: extractor 'currentTurn' is invalid for '${target}' id`)
  }

  if (path === 'rage') {
    if (target === 'player') return [{ kind: 'scalar', valueType: 'number' }]
    throw new Error(`selector typing failed at ${at}: extractor 'rage' is invalid for '${target}' id`)
  }

  if (path === 'currentHp' || path === 'maxHp' || path === 'level' || path === 'gender' || path === 'stats') {
    if (target === 'pet') {
      if (path === 'gender') return [{ kind: 'scalar', valueType: 'string' }]
      if (path === 'stats') return [pathObjectState('pet', 'stats')]
      return [{ kind: 'scalar', valueType: 'number' }]
    }
    throw new Error(`selector typing failed at ${at}: extractor '${path}' is invalid for '${target}' id`)
  }

  if (path === 'stack' || path === 'duration') {
    if (target === 'mark') return [{ kind: 'scalar', valueType: 'number' }]
    throw new Error(`selector typing failed at ${at}: extractor '${path}' is invalid for '${target}' id`)
  }

  if (path === 'power' || path === 'priority' || path === 'rageCost') {
    if (target === 'skill') return [{ kind: 'scalar', valueType: 'number' }]
    throw new Error(`selector typing failed at ${at}: extractor '${path}' is invalid for '${target}' id`)
  }

  if (path.includes('.')) {
    if (!hasField(target, path)) {
      throw new Error(`selector typing failed at ${at}: path '${path}' is not declared on '${target}' id`)
    }
    return stateFromPath(target, path)
  }

  const relation = getRelation(target, path)
  if (relation) return [{ kind: 'id', target: relation.target }]
  if (hasAttribute(target, path)) return stateFromPath(target, path)
  if (hasField(target, path)) return stateFromPath(target, path)

  throw new Error(`selector typing failed at ${at}: extractor/path '${path}' is not declared on '${target}' id`)
}

function resolvePathFromState(state: CompileState, path: string, at: string): CompileState[] {
  if (state.kind === 'owner') return resolvePathFromOwner(state.owner, path, at)
  if (state.kind === 'id') return resolvePathFromId(state.target, path, at)
  if (state.kind === 'object' && state.owner && state.path) {
    const nestedPath = `${state.path}.${path}`
    if (!hasField(state.owner, nestedPath)) {
      throw new Error(`selector typing failed at ${at}: path '${path}' is not declared on object class '${state.objectClass}'`)
    }
    return stateFromPath(state.owner, nestedPath)
  }
  throw new Error(`selector typing failed at ${at}: cannot apply path '${path}' on ${formatState(state)}`)
}

function dedupeStates(states: CompileState[]): CompileState[] {
  const out: CompileState[] = []
  const seen = new Set<string>()
  for (const state of states) {
    const key = state.kind === 'owner'
      ? `owner:${state.owner}`
      : state.kind === 'id'
        ? `id:${state.target}`
        : state.kind === 'scalar'
          ? `scalar:${state.valueType}`
          : state.kind === 'object'
            ? `object:${state.objectClass}`
          : 'propertyRef'
    if (seen.has(key)) continue
    seen.add(key)
    out.push(state)
  }
  return out
}

function baseSelectorStates(base: string, at: string): CompileState[] {
  switch (base) {
    case 'self':
    case 'opponent':
    case 'target':
    case 'selfTeam':
    case 'opponentTeam':
      return [{ kind: 'id', target: 'pet' }]
    case 'selfPlayer':
    case 'opponentPlayer':
      return [{ kind: 'id', target: 'player' }]
    case 'mark':
    case 'selfMarks':
    case 'opponentMarks':
      return [{ kind: 'id', target: 'mark' }]
    case 'skill':
    case 'selfSkills':
    case 'opponentSkills':
    case 'selfAvailableSkills':
    case 'opponentAvailableSkills':
      return [{ kind: 'id', target: 'skill' }]
    case 'dataMarks':
      return [{ kind: 'id', target: 'baseMark' }]
    case 'useSkillContext':
      return [{ kind: 'owner', owner: 'useSkillContext' }]
    case 'damageContext':
      return [{ kind: 'owner', owner: 'damageContext' }]
    case 'healContext':
      return [{ kind: 'owner', owner: 'healContext' }]
    case 'rageContext':
      return [{ kind: 'owner', owner: 'rageContext' }]
    case 'addMarkContext':
      return [{ kind: 'owner', owner: 'addMarkContext' }]
    case 'switchPetContext':
      return [{ kind: 'owner', owner: 'switchPetContext' }]
    case 'turnContext':
      return [{ kind: 'owner', owner: 'turnContext' }]
    case 'stackContext':
      return [{ kind: 'owner', owner: 'stackContext' }]
    case 'consumeStackContext':
      return [{ kind: 'owner', owner: 'consumeStackContext' }]
    case 'effectContext':
      return [{ kind: 'owner', owner: 'effectContext' }]
    case 'battle':
      return [{ kind: 'id', target: 'battle' }]
    case 'currentPhase':
    case 'allPhases':
      return [{ kind: 'owner', owner: 'unknown' }]
    default:
      throw new Error(`selector typing failed at ${at}: unknown base selector '${base}'`)
  }
}

function isSelectorRecord(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.base === 'string') return true
  if ('condition' in value && 'trueSelector' in value) return true
  if (value.type === 'selectorValue') return true
  return false
}

function isConditionNode(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && conditionTypeSet.has(value.type)
}

function isEvaluatorNode(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && evaluatorTypeSet.has(value.type)
}

function isOperatorNode(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && operatorTypeSet.has(value.type)
}

function isEffectDefLike(value: Record<string, unknown>): boolean {
  const hasApply = 'apply' in value
  const hasTrigger = 'trigger' in value || 'triggers' in value
  return hasApply && hasTrigger
}

function validateSelectorNode(selector: unknown, at: string): CompileState[] {
  if (typeof selector === 'string') {
    if (!baseSelectorKeySet.has(selector)) {
      throw new Error(`selector typing failed at ${at}: unknown selector '${selector}'`)
    }
    return baseSelectorStates(selector, at)
  }

  if (!isRecord(selector)) {
    throw new Error(`selector typing failed at ${at}: selector must be string or object`)
  }

  if (selector.type === 'selectorValue') {
    const value = selector.value
    const initialStates = inferStatesFromValue(value, `${at}/value`)
    const chain = Array.isArray(selector.chain) ? selector.chain : []
    if (chain.length === 0) return initialStates
    return validateChain(chain, initialStates, `${at}/chain`)
  }

  if (typeof selector.base === 'string') {
    if (!baseSelectorKeySet.has(selector.base)) {
      throw new Error(`selector typing failed at ${at}/base: unknown base selector '${selector.base}'`)
    }
    let states = baseSelectorStates(selector.base, `${at}/base`)
    const chain = Array.isArray(selector.chain) ? selector.chain : []
    if (chain.length > 0) {
      states = validateChain(chain, states, `${at}/chain`)
    }
    return states
  }

  if ('condition' in selector && 'trueSelector' in selector) {
    validateConditionNode(selector.condition, `${at}/condition`)
    const trueStates = validateSelectorNode(selector.trueSelector, `${at}/trueSelector`)
    const falseStates = 'falseSelector' in selector
      ? validateSelectorNode(selector.falseSelector, `${at}/falseSelector`)
      : []
    return dedupeStates([...trueStates, ...falseStates])
  }

  throw new Error(`selector typing failed at ${at}: invalid selector object`)
}

function normalizeExtractorPath(extractor: unknown): string | undefined {
  if (typeof extractor === 'string') return extractor
  if (!isRecord(extractor) || typeof extractor.type !== 'string') return undefined
  if (extractor.type === 'field') return typeof extractor.path === 'string' ? extractor.path : undefined
  if (extractor.type === 'attribute' || extractor.type === 'relation') {
    return typeof extractor.key === 'string' ? extractor.key : undefined
  }
  if (extractor.type === 'base' || extractor.type === 'dynamic') {
    return typeof extractor.arg === 'string' ? extractor.arg : undefined
  }
  return undefined
}

function validateChain(chain: unknown[], initialStates: CompileState[], at: string): CompileState[] {
  let states = dedupeStates(initialStates)
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]
    const stepPath = `${at}/${i}`
    if (!isRecord(step) || typeof step.type !== 'string') {
      throw new Error(`selector typing failed at ${stepPath}: invalid chain step`)
    }

    switch (step.type) {
      case 'select': {
        const extractorPath = normalizeExtractorPath(step.arg)
        if (!extractorPath || extractorPath.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}/arg: select arg must be a known extractor`)
        }
        const next = states.flatMap(state => resolvePathFromState(state, extractorPath, `${stepPath}/arg`))
        states = dedupeStates(next)
        if (states.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}: select '${extractorPath}' produced no statically valid state`)
        }
        break
      }

      case 'selectPath': {
        const path = step.arg
        if (typeof path !== 'string' || path.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}/arg: selectPath arg must be non-empty string`)
        }
        const next = states.flatMap(state => resolvePathFromState(state, path, `${stepPath}/arg`))
        states = dedupeStates(next)
        if (states.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}: selectPath '${path}' produced no statically valid state`)
        }
        break
      }

      case 'and':
      case 'or': {
        validateSelectorNode(step.arg, `${stepPath}/arg`)
        break
      }

      case 'where': {
        validateEvaluatorNode(step.arg, `${stepPath}/arg`)
        break
      }

      case 'whereAttr': {
        const extractorPath = normalizeExtractorPath(step.extractor)
        if (extractorPath && extractorPath.includes('.')) {
          for (const state of states) {
            if (state.kind === 'scalar') {
              throw new Error(`selector typing failed at ${stepPath}/extractor: cannot apply extractor '${extractorPath}' on scalar state`)
            }
            // Validate dotted extractor path existence, but keep permissive state transition.
            resolvePathFromState(state, extractorPath, `${stepPath}/extractor`)
          }
        }
        validateEvaluatorNode(step.evaluator, `${stepPath}/evaluator`)
        break
      }

      case 'when': {
        validateConditionNode(step.condition, `${stepPath}/condition`)
        const trueStates = inferStatesFromValue(step.trueValue, `${stepPath}/trueValue`)
        const falseStates = 'falseValue' in step
          ? inferStatesFromValue(step.falseValue, `${stepPath}/falseValue`)
          : []
        states = dedupeStates([...trueStates, ...falseStates])
        if (states.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}: when produced no statically valid state`)
        }
        break
      }

      case 'selectProp': {
        const key = step.arg
        if (typeof key !== 'string' || key.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}/arg: selectProp arg must be non-empty string`)
        }
        for (const state of states) {
          if (state.kind === 'scalar' || state.kind === 'propertyRef') {
            throw new Error(`selector typing failed at ${stepPath}/arg: selectProp cannot be applied to ${formatState(state)}`)
          }
        }
        states = [{ kind: 'propertyRef' }]
        break
      }

      case 'selectObservable':
      case 'configGet': {
        if ('arg' in step) walkNode(step.arg, `${stepPath}/arg`)
        if ('key' in step) walkNode(step.key, `${stepPath}/key`)
        states = [{ kind: 'scalar', valueType: 'unknown' }]
        break
      }

      case 'selectAttribute$': {
        const key = step.arg
        if (typeof key !== 'string' || key.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}/arg: selectAttribute$ arg must be non-empty string`)
        }
        const next = states.flatMap(state => resolvePathFromState(state, key, `${stepPath}/arg`))
        states = dedupeStates(next)
        if (states.length === 0) {
          throw new Error(`selector typing failed at ${stepPath}: selectAttribute$ '${key}' produced no statically valid state`)
        }
        break
      }

      case 'sum':
      case 'avg':
      case 'add':
      case 'multiply':
      case 'divide':
      case 'sampleBetween':
      case 'clampMax':
      case 'clampMin': {
        if ('arg' in step) walkNode(step.arg, `${stepPath}/arg`)
        states = [{ kind: 'scalar', valueType: 'number' }]
        break
      }

      default: {
        if ('arg' in step) walkNode(step.arg, `${stepPath}/arg`)
        if ('key' in step) walkNode(step.key, `${stepPath}/key`)
        break
      }
    }
  }

  return states
}

function inferStatesFromValue(value: unknown, at: string): CompileState[] {
  if (value === null || value === undefined) return [{ kind: 'scalar', valueType: 'unknown' }]
  if (typeof value === 'string') return [{ kind: 'scalar', valueType: 'string' }]
  if (typeof value === 'number') return [{ kind: 'scalar', valueType: 'number' }]
  if (typeof value === 'boolean') return [{ kind: 'scalar', valueType: 'boolean' }]

  if (Array.isArray(value)) {
    const states = value.flatMap((item, idx) => inferStatesFromValue(item, `${at}/${idx}`))
    if (states.length > 0) return dedupeStates(states)
    return [{ kind: 'object', objectClass: 'json:stringArray' }]
  }
  if (!isRecord(value)) return [{ kind: 'scalar', valueType: 'unknown' }]

  if (value.type === 'raw:number') return [{ kind: 'scalar', valueType: 'number' }]
  if (value.type === 'raw:string') return [{ kind: 'scalar', valueType: 'string' }]
  if (value.type === 'raw:boolean') return [{ kind: 'scalar', valueType: 'boolean' }]

  if (value.type === 'dynamic') {
    return validateSelectorNode(value.selector, `${at}/selector`)
  }
  if (value.type === 'selectorValue') {
    return validateSelectorNode(value, at)
  }
  if (value.type === 'conditional') {
    validateConditionNode(value.condition, `${at}/condition`)
    const trueStates = inferStatesFromValue(value.trueValue, `${at}/trueValue`)
    const falseStates = 'falseValue' in value
      ? inferStatesFromValue(value.falseValue, `${at}/falseValue`)
      : []
    return dedupeStates([...trueStates, ...falseStates])
  }

  if (value.type === 'entity:baseMark') return [{ kind: 'id', target: 'baseMark' }]
  if (value.type === 'entity:baseSkill') return [{ kind: 'id', target: 'baseSkill' }]
  if (value.type === 'entity:species') return [{ kind: 'scalar', valueType: 'string' }]
  if (value.type === 'entity:effect') return [{ kind: 'id', target: 'effectDef' }]
  if (value.type === 'propertyRef') return [{ kind: 'propertyRef' }]
  if (isOperatorNode(value)) {
    validateOperatorNode(value, at)
    return [{ kind: 'object', objectClass: 'dsl:operator' }]
  }
  if (isConditionNode(value)) {
    validateConditionNode(value, at)
    return [{ kind: 'object', objectClass: 'dsl:condition' }]
  }
  if (isEvaluatorNode(value)) {
    validateEvaluatorNode(value, at)
    return [{ kind: 'object', objectClass: 'dsl:evaluator' }]
  }
  if (isSelectorRecord(value)) {
    validateSelectorNode(value, at)
    return [{ kind: 'object', objectClass: 'dsl:selector' }]
  }
  if (isEffectDefLike(value)) {
    walkNode(value, at)
    return [{ kind: 'object', objectClass: 'dsl:effectDef' }]
  }

  // Unknown object-like values are validated recursively, then typed as a generic record.
  walkNode(value, at)
  return [{ kind: 'object', objectClass: 'json:record' }]
}

function formatState(state: CompileState): string {
  if (state.kind === 'id') return `id(${state.target})`
  if (state.kind === 'owner') return `owner(${state.owner})`
  if (state.kind === 'scalar') return `scalar(${state.valueType})`
  if (state.kind === 'object') return `object(${state.objectClass})`
  return 'propertyRef'
}

function formatConstraint(constraint: EffectDslStateConstraint): string {
  if (constraint.kind === 'id') {
    return constraint.targets && constraint.targets.length > 0
      ? `id(${constraint.targets.join('|')})`
      : 'id(*)'
  }
  if (constraint.kind === 'owner') {
    return constraint.owners && constraint.owners.length > 0
      ? `owner(${constraint.owners.join('|')})`
      : 'owner(*)'
  }
  if (constraint.kind === 'scalar') {
    return constraint.valueTypes && constraint.valueTypes.length > 0
      ? `scalar(${constraint.valueTypes.join('|')})`
      : 'scalar(*)'
  }
  if (constraint.kind === 'object') {
    return constraint.classes && constraint.classes.length > 0
      ? `object(${constraint.classes.join('|')})`
      : 'object(*)'
  }
  return 'propertyRef'
}

function stateMatchesConstraint(state: CompileState, constraint: EffectDslStateConstraint): boolean {
  if (state.kind !== constraint.kind) return false
  if (state.kind === 'id' && constraint.kind === 'id') {
    if (!constraint.targets || constraint.targets.length === 0) return true
    return constraint.targets.includes(state.target)
  }
  if (state.kind === 'owner' && constraint.kind === 'owner') {
    if (!constraint.owners || constraint.owners.length === 0) return true
    return constraint.owners.includes(state.owner)
  }
  if (state.kind === 'scalar' && constraint.kind === 'scalar') {
    if (!constraint.valueTypes || constraint.valueTypes.length === 0) return true
    return constraint.valueTypes.includes(state.valueType)
  }
  if (state.kind === 'object' && constraint.kind === 'object') {
    if (!constraint.classes || constraint.classes.length === 0) return true
    return constraint.classes.includes(state.objectClass)
  }
  return true
}

function assertStatesMatchRule(
  states: CompileState[],
  rule: EffectDslFieldTypingRule,
  at: string,
): void {
  if (!rule.allow || rule.allow.length === 0) return
  if (states.length === 0) {
    throw new Error(`selector typing failed at ${at}: no static value inferred`)
  }
  const invalidStates = states.filter(state => !rule.allow.some(constraint => stateMatchesConstraint(state, constraint)))
  if (invalidStates.length > 0) {
    const expected = rule.allow.map(formatConstraint).join(' | ')
    const actual = invalidStates.map(formatState).join(', ')
    throw new Error(`selector typing failed at ${at}: expected ${expected}, got ${actual}`)
  }
}

function applyNodeTypingRules(
  at: string,
  node: Record<string, unknown> & { type: string },
  rules: CompileNodeTypingRule | undefined,
): Set<string> {
  const checked = new Set<string>(['type'])
  if (!rules) return checked

  for (const [field, rule] of Object.entries(rules.selectorFields ?? {})) {
    if (!(field in node)) continue
    const states = validateSelectorNode(node[field], `${at}/${field}`)
    assertStatesMatchRule(states, rule, `${at}/${field}`)
    checked.add(field)
  }

  for (const [field, rule] of Object.entries(rules.valueFields ?? {})) {
    if (!(field in node)) continue
    const states = inferStatesFromValue(node[field], `${at}/${field}`)
    assertStatesMatchRule(states, rule, `${at}/${field}`)
    checked.add(field)
  }

  return checked
}

function validateConditionNode(condition: unknown, at: string): void {
  if (!isConditionNode(condition)) {
    walkNode(condition, at)
    return
  }
  const node = condition as Record<string, unknown> & { type: string }
  const checked = applyNodeTypingRules(at, node, conditionTypingRules[node.type])
  for (const [key, value] of Object.entries(node)) {
    if (checked.has(key)) continue
    walkNode(value, `${at}/${key}`)
  }
}

function validateEvaluatorNode(evaluator: unknown, at: string): void {
  if (!isEvaluatorNode(evaluator)) {
    walkNode(evaluator, at)
    return
  }
  const node = evaluator as Record<string, unknown> & { type: string }
  const checked = applyNodeTypingRules(at, node, evaluatorTypingRules[node.type])
  for (const [key, value] of Object.entries(node)) {
    if (checked.has(key)) continue
    walkNode(value, `${at}/${key}`)
  }
}

function validateOperatorNode(operator: unknown, at: string): void {
  if (!isOperatorNode(operator)) {
    walkNode(operator, at)
    return
  }
  const node = operator as Record<string, unknown> & { type: string }
  const checked = applyNodeTypingRules(at, node, operatorTypingRules[node.type])
  for (const [key, value] of Object.entries(node)) {
    if (checked.has(key)) continue
    walkNode(value, `${at}/${key}`)
  }
}

function walkNode(node: unknown, at: string): void {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkNode(node[i], `${at}/${i}`)
    }
    return
  }

  if (!isRecord(node)) return

  if (node.type === 'conditional' && 'trueValue' in node && !('trueOperator' in node)) {
    validateConditionNode(node.condition, `${at}/condition`)
    walkNode(node.trueValue, `${at}/trueValue`)
    if ('falseValue' in node) walkNode(node.falseValue, `${at}/falseValue`)
    return
  }

  if (isOperatorNode(node)) {
    validateOperatorNode(node, at)
    return
  }

  if (isConditionNode(node)) {
    validateConditionNode(node, at)
    return
  }

  if (isEvaluatorNode(node)) {
    validateEvaluatorNode(node, at)
    return
  }

  if (isSelectorRecord(node)) {
    validateSelectorNode(node, at)
    return
  }

  if (node.type === 'dynamic' && 'selector' in node) {
    validateSelectorNode(node.selector, `${at}/selector`)
    return
  }

  if (node.type === 'selectorValue') {
    validateSelectorNode(node, at)
    return
  }

  if ('target' in node && (typeof node.target === 'string' || isRecord(node.target))) {
    if (typeof node.target === 'string') {
      if (baseSelectorKeySet.has(node.target)) {
        validateSelectorNode(node.target, `${at}/target`)
      }
    } else if (isSelectorRecord(node.target)) {
      validateSelectorNode(node.target, `${at}/target`)
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'target') continue
    walkNode(value, `${at}/${key}`)
  }
}

export function validateEffectCompileTyping(raw: Record<string, unknown>): void {
  if ('condition' in raw) {
    validateConditionNode(raw.condition, '/condition')
  }
  if ('apply' in raw) {
    walkNode(raw.apply, '/apply')
  }
}
