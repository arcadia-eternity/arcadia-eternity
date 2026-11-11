import YAML from 'yaml'
import { isDeepStrictEqual } from 'node:util'

const mergeKey = (pair: any) =>
  YAML.isScalar(pair.key) && typeof pair.key.value === 'symbol' && pair.key.value.description === '<<'
const prefix = (parent: any, child: any) => parent.every((part: any, index: number) => part === child[index])

/** Source-level sharing, before conversion to plain values loses provenance. */
export function yamlSharing(doc: any, lineCounter: any) {
  if (!doc) return []
  const paths = new Map(),
    referenced = new Set(),
    fields = []
  function index(node: any, path: any) {
    if (!YAML.isNode(node)) return
    paths.set(node, path)
    if (YAML.isAlias(node)) referenced.add(node.resolve(doc))
    if (YAML.isSeq(node)) node.items.forEach((item: any, i: number) => index(item, [...path, i]))
    if (YAML.isMap(node)) for (const pair of node.items as any[]) index(pair.value, [...path, String(pair.key.value)])
  }
  index(doc.contents, [])
  function add(path: any, reason: any, source: any) {
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
  function effective(node: any, seen = new Set(), origin = node) {
    if (YAML.isAlias(node)) {
      const target = node.resolve(doc)
      return effective(target, seen, target)
    }
    if (YAML.isSeq(node) && !seen.has(node)) {
      const result = new Map()
      for (const item of node.items)
        for (const [key, from] of effective(item, new Set([...seen, node]))) if (!result.has(key)) result.set(key, from)
      return result
    }
    if (!YAML.isMap(node) || seen.has(node)) return new Map()
    seen = new Set([...seen, node])
    const result = new Map()
    for (const pair of (node.items as any[]).filter(mergeKey)) {
      const sources = YAML.isSeq(pair.value) ? pair.value.items : [pair.value]
      for (const source of sources)
        for (const [key, from] of effective(source, seen)) if (!result.has(key)) result.set(key, from)
    }
    for (const pair of (node.items as any[]).filter(pair => !mergeKey(pair))) result.set(String(pair.key.value), origin)
    return result
  }
  function walk(node: any, path: any) {
    if (YAML.isAlias(node)) {
      add(path, 'alias', node.resolve(doc))
      return
    }
    if (!YAML.isNode(node)) return
    if (node.anchor && referenced.has(node)) {
      add(path, 'anchor', node)
      return
    }
    if (YAML.isSeq(node)) node.items.forEach((item: any, i: number) => walk(item, [...path, i]))
    if (YAML.isMap(node)) {
      const local = new Set((node.items as any[]).filter(pair => !mergeKey(pair)).map(pair => String(pair.key.value)))
      for (const [key, source] of effective(node)) if (!local.has(key)) add([...path, key], 'merge', source)
      for (const pair of (node.items as any[]).filter(pair => !mergeKey(pair)))
        walk(pair.value, [...path, String(pair.key.value)])
    }
  }
  walk(doc.contents, [])
  return fields
}

export function recordSharing(fields: any, index: any) {
  const root = index === null ? [] : [index]
  return fields
    .filter(field => prefix(root, field.path) || prefix(field.path, root))
    .map(field => ({
      ...field,
      path: field.path.slice(root.length),
    }))
}

export function changedSharedField(fields: any, before: any, after: any) {
  const at = (value: any, path: any) => path.reduce((value: any, key: any) => value?.[key], value)
  return fields.find(field => !isDeepStrictEqual(at(before, field.path), at(after, field.path)))
}

/** Detect accidental alias expansion or anchor loss during structural updates. */
export function sharingSignature(doc: any) {
  const result = []
  YAML.visit(doc, {
    Node(_key, node) {
      if (node.anchor) result.push(['anchor', node.anchor])
      if (YAML.isAlias(node)) result.push(['alias', node.source])
    },
  })
  return result
}
