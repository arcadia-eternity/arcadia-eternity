import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type ParsedNode,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'

export type YamlRecordKind = 'map' | 'alias' | 'other'

export type YamlAnchoredRow = {
  index: number
  id: string
  kind: YamlRecordKind
  anchor?: string
  hasMerge: boolean
  directKeys: string[]
  mergeBase: Record<string, unknown>
  value: Record<string, unknown>
}

export type YamlAnchoredDataset = {
  doc: Document.Parsed
  sequence: YAMLSeq<unknown>
  rows: YamlAnchoredRow[]
}

const MAX_ALIAS_COUNT = 1000

function cloneRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return Value.Clone(value) as Record<string, unknown>
}

function readRecordId(record: Record<string, unknown>): string {
  return String(record.id ?? '').trim()
}

function getPairKeyName(keyNode: unknown): string | null {
  if (!isScalar(keyNode)) return null
  const value = keyNode.value
  if (typeof value === 'string') return value
  if (typeof value === 'symbol' && value.description) return value.description
  return null
}

function isMergeKey(keyNode: unknown): boolean {
  return getPairKeyName(keyNode) === '<<'
}

function toMapRecord(node: unknown, doc: Document.Parsed): Record<string, unknown> {
  if (!isMap(node)) return {}
  return cloneRecord(node.toJS(doc, { maxAliasCount: MAX_ALIAS_COUNT }))
}

function collectMergeSources(valueNode: unknown, doc: Document.Parsed): Record<string, unknown>[] {
  if (valueNode == null) return []

  if (isAlias(valueNode)) {
    const target = valueNode.resolve(doc)
    return target && isMap(target) ? [toMapRecord(target, doc)] : []
  }

  if (isMap(valueNode)) {
    return [toMapRecord(valueNode, doc)]
  }

  if (!isSeq(valueNode)) {
    return []
  }

  const output: Record<string, unknown>[] = []
  for (const item of valueNode.items) {
    if (isAlias(item)) {
      const target = item.resolve(doc)
      if (target && isMap(target)) {
        output.push(toMapRecord(target, doc))
      }
      continue
    }
    if (isMap(item)) {
      output.push(toMapRecord(item, doc))
    }
  }
  return output
}

function nodeToJsValue(node: unknown, doc: Document.Parsed): unknown {
  if (node && typeof node === 'object') {
    const candidate = node as { toJS?: (doc: Document.Parsed, options?: { maxAliasCount?: number }) => unknown }
    if (typeof candidate.toJS === 'function') {
      return candidate.toJS(doc, { maxAliasCount: MAX_ALIAS_COUNT })
    }
  }
  return Value.Clone(node)
}

function resolveMergeBase(mapNode: YAMLMap<unknown, unknown>, doc: Document.Parsed): Record<string, unknown> {
  const mergeSources: Record<string, unknown>[] = []

  for (const pair of mapNode.items) {
    if (!isMergeKey(pair.key)) continue
    mergeSources.push(...collectMergeSources(pair.value, doc))
  }

  if (mergeSources.length === 0) return {}

  const base: Record<string, unknown> = {}
  for (const source of mergeSources) {
    for (const [key, value] of Object.entries(source)) {
      if (!(key in base)) {
        base[key] = Value.Clone(value)
      }
    }
  }
  return base
}

function readDirectMapValues(mapNode: YAMLMap<unknown, unknown>, doc: Document.Parsed): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const pair of mapNode.items) {
    if (isMergeKey(pair.key)) continue
    const key = getPairKeyName(pair.key)
    if (!key) continue
    const rawValue = pair.value == null ? null : nodeToJsValue(pair.value, doc)
    output[key] = Value.Clone(rawValue)
  }
  return output
}

function createEmptySequence(doc: Document.Parsed): YAMLSeq<unknown> {
  const created = doc.createNode([])
  if (!isSeq(created)) {
    throw new Error('无法初始化 YAML 数组根节点')
  }
  doc.contents = created as unknown as ParsedNode
  return created as YAMLSeq<unknown>
}

function ensureSequenceDocument(doc: Document.Parsed): YAMLSeq<unknown> {
  if (!doc.contents) {
    return createEmptySequence(doc)
  }
  if (!isSeq(doc.contents)) {
    throw new Error('YAML 根节点必须是数组（sequence）')
  }
  return doc.contents as YAMLSeq<unknown>
}

export function parseYamlAnchoredDataset(content: string): YamlAnchoredDataset {
  const doc = parseDocument(content, {
    merge: true,
    prettyErrors: true,
  }) as Document.Parsed

  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map(error => error.message).join('; '))
  }

  const sequence = ensureSequenceDocument(doc)
  const resolved = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })

  if (!Array.isArray(resolved)) {
    throw new Error('YAML 数据必须是数组结构')
  }

  const rows: YamlAnchoredRow[] = sequence.items.map((item, index) => {
    const value = cloneRecord(resolved[index])
    const id = readRecordId(value) || `row_${index + 1}`
    const kind: YamlRecordKind = isAlias(item) ? 'alias' : isMap(item) ? 'map' : 'other'

    if (!isMap(item)) {
      return {
        index,
        id,
        kind,
        hasMerge: false,
        directKeys: [],
        mergeBase: {},
        value,
      }
    }

    const directValues = readDirectMapValues(item, doc)
    const mergeBase = resolveMergeBase(item, doc)
    return {
      index,
      id,
      kind,
      anchor: item.anchor,
      hasMerge: Object.keys(mergeBase).length > 0,
      directKeys: Object.keys(directValues),
      mergeBase,
      value,
    }
  })

  return {
    doc,
    sequence,
    rows,
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right) return false
  if (left == null || right == null) return false

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false
    }
    return true
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left as Record<string, unknown>)
    const rightKeys = Object.keys(right as Record<string, unknown>)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!deepEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      )) {
        return false
      }
    }
    return true
  }

  return false
}

function normalizeWithSchema(schema: TSchema, input: Record<string, unknown>): Record<string, unknown> {
  const cloned = Value.Clone(input)
  const converted = Value.Convert(schema, cloned)
  const cleaned = Value.Clean(schema, converted)

  if (Value.Check(schema, cleaned)) {
    return cleaned as Record<string, unknown>
  }

  const errors = [...Value.Errors(schema, cleaned)]
  const details = errors.map(error => `${error.path}: ${error.message}`).join('; ')
  throw new Error(`数据校验失败: ${details}`)
}

function patchMapNode(
  mapNode: YAMLMap<unknown, unknown>,
  doc: Document.Parsed,
  normalized: Record<string, unknown>,
  mergeBase: Record<string, unknown>,
): void {
  const directKeys = new Set<string>()
  for (const pair of mapNode.items) {
    if (isMergeKey(pair.key)) continue
    const key = getPairKeyName(pair.key)
    if (!key) continue
    directKeys.add(key)
  }

  for (const key of directKeys) {
    if (!(key in normalized)) {
      mapNode.delete(key as unknown)
    }
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (key !== 'id' && key in mergeBase && deepEqual(value, mergeBase[key])) {
      mapNode.delete(key as unknown)
      continue
    }
    mapNode.set(key as unknown, doc.createNode(Value.Clone(value)))
  }
}

export function upsertYamlAnchoredRecord(args: {
  dataset: YamlAnchoredDataset
  schema: TSchema
  draft: Record<string, unknown>
  targetIndex?: number
}): { index: number; normalized: Record<string, unknown> } {
  const { dataset, schema, draft, targetIndex } = args
  const normalized = normalizeWithSchema(schema, draft)
  const nextId = readRecordId(normalized)

  if (!nextId) {
    throw new Error('ID 不能为空')
  }

  if (Number.isInteger(targetIndex)) {
    const safeIndex = targetIndex as number
    const currentNode = dataset.sequence.items[safeIndex]
    if (isAlias(currentNode)) {
      throw new Error('当前条目是 YAML 别名，请先解除别名再编辑')
    }

    let mapNode: YAMLMap<unknown, unknown>
    if (isMap(currentNode)) {
      mapNode = currentNode
    } else {
      mapNode = dataset.doc.createNode({}) as YAMLMap<unknown, unknown>
      dataset.sequence.items[safeIndex] = mapNode as unknown
    }

    const mergeBase = resolveMergeBase(mapNode, dataset.doc)
    patchMapNode(mapNode, dataset.doc, normalized, mergeBase)
    return { index: safeIndex, normalized }
  }

  const createdNode = dataset.doc.createNode(normalized)
  dataset.sequence.items.push(createdNode as unknown)
  return { index: dataset.sequence.items.length - 1, normalized }
}

export function deleteYamlAnchoredRecord(dataset: YamlAnchoredDataset, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= dataset.sequence.items.length) return
  dataset.sequence.items.splice(index, 1)
}

export function detachYamlAliasRecord(dataset: YamlAnchoredDataset, index: number, value: Record<string, unknown>): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= dataset.sequence.items.length) return false
  const node = dataset.sequence.items[index]
  if (!isAlias(node)) return false

  const mapNode = dataset.doc.createNode(Value.Clone(value))
  dataset.sequence.items[index] = mapNode as unknown
  return true
}

export function stringifyYamlAnchoredDataset(dataset: YamlAnchoredDataset): string {
  return dataset.doc.toString()
}
