import YAML from 'yaml'
import type { Document, LineCounter, Node, Pair } from 'yaml'
import { isDeepStrictEqual } from 'node:util'

export type NodePath = Array<string | number>

export interface SharedField {
  path: NodePath
  reason: string
  anchor: string
  sourcePath: NodePath
  line?: number
  column?: number
}

const mergeKey = (pair: Pair) =>
  YAML.isScalar(pair.key) && typeof pair.key.value === 'symbol' && pair.key.value.description === '<<'
const prefix = (parent: NodePath, child: NodePath) => parent.every((part, index) => part === child[index])

/** Source-level sharing, before conversion to plain values loses provenance. */
export function yamlSharing(doc: Document | undefined, lineCounter: LineCounter | undefined): SharedField[] {
  if (!doc) return []
  const sourceDoc = doc
  const paths = new Map<Node, NodePath>(),
    referenced = new Set<Node>(),
    fields: SharedField[] = []
  function index(node: Node | null | undefined, path: NodePath) {
    if (!YAML.isNode(node)) return
    paths.set(node, path)
    if (YAML.isAlias(node)) {
      const target = node.resolve(sourceDoc) as Node
      if (target) referenced.add(target)
    }
    if (YAML.isSeq(node)) node.items.forEach((item, i) => index(item as Node, [...path, i]))
    if (YAML.isMap(node)) for (const pair of node.items) index(pair.value as Node, [...path, pairKey(pair)])
  }
  index(doc.contents, [])
  function add(path: NodePath, reason: string, source: Node) {
    const location = lineCounter && source.range ? lineCounter.linePos(source.range[0]) : undefined
    fields.push({
      path,
      reason,
      anchor: source.anchor ?? '',
      sourcePath: paths.get(source) ?? [],
      ...(location ? { line: location.line, column: location.col } : {}),
    })
  }
  // Merge sequences use the first mapping that supplies a key; local keys win.
  function effective(node: Node, seen = new Set<Node>(), origin: Node = node): Map<string, Node> {
    if (YAML.isAlias(node)) {
      const target = node.resolve(sourceDoc) as Node
      return effective(target, seen, target)
    }
    if (YAML.isSeq(node) && !seen.has(node)) {
      const result = new Map<string, Node>()
      for (const item of node.items)
        for (const [key, from] of effective(item as Node, new Set([...seen, node])))
          if (!result.has(key)) result.set(key, from)
      return result
    }
    if (!YAML.isMap(node) || seen.has(node)) return new Map<string, Node>()
    seen = new Set([...seen, node])
    const result = new Map<string, Node>()
    for (const pair of node.items.filter(mergeKey)) {
      const sources = YAML.isSeq(pair.value) ? (pair.value.items as Node[]) : [pair.value as Node]
      for (const source of sources)
        for (const [key, from] of effective(source, seen)) if (!result.has(key)) result.set(key, from)
    }
    for (const pair of node.items.filter(pair => !mergeKey(pair))) result.set(String(pairKey(pair)), origin)
    return result
  }
  function walk(node: Node | null | undefined, path: NodePath) {
    if (YAML.isAlias(node)) {
      add(path, 'alias', node.resolve(sourceDoc) as Node)
      return
    }
    if (!YAML.isNode(node)) return
    if (node.anchor && referenced.has(node)) {
      add(path, 'anchor', node)
      return
    }
    if (YAML.isSeq(node)) node.items.forEach((item, i) => walk(item as Node, [...path, i]))
    if (YAML.isMap(node)) {
      const local = new Set(node.items.filter(pair => !mergeKey(pair)).map(pair => String(pairKey(pair))))
      for (const [key, source] of effective(node)) if (!local.has(key)) add([...path, key], 'merge', source)
      for (const pair of node.items.filter(pair => !mergeKey(pair))) walk(pair.value as Node, [...path, pairKey(pair)])
    }
  }
  walk(doc.contents, [])
  return fields
}

function pairKey(pair: Pair): string {
  const key = pair.key
  if (YAML.isScalar(key)) {
    if (typeof key.value === 'string') return key.value
    if (key.value == null || typeof key.value === 'number' || typeof key.value === 'boolean') return String(key.value)
  }
  return ''
}

export function recordSharing(fields: SharedField[], index: string | number | null): SharedField[] {
  const root: NodePath = index === null ? [] : [index]
  return fields
    .filter(field => prefix(root, field.path) || prefix(field.path, root))
    .map(field => ({
      ...field,
      path: field.path.slice(root.length),
    }))
}

export function changedSharedField(fields: SharedField[], before: unknown, after: unknown): SharedField | undefined {
  const at = (value: unknown, path: NodePath): unknown =>
    path.reduce<unknown>((current, key) => {
      if (current === null || typeof current !== 'object') return undefined
      return (current as Record<string | number, unknown>)[key]
    }, value)
  return fields.find(field => !isDeepStrictEqual(at(before, field.path), at(after, field.path)))
}

/** Detect accidental alias expansion or anchor loss during structural updates. */
export function sharingSignature(doc: Document): Array<[string, string]> {
  const result: Array<[string, string]> = []
  YAML.visit(doc, {
    Node(_key, node) {
      if (node.anchor) result.push(['anchor', node.anchor])
      if (YAML.isAlias(node)) result.push(['alias', node.source])
    },
  })
  return result
}
