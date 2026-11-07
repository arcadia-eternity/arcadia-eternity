import type { Json } from '@arcadia-eternity/pack-loader/native'
import type { SharedField } from './types'

export const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
export const object = (value: unknown): value is Record<string, Json> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]))
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
    )
  return false
}
export interface FieldChange {
  path: string[]
  before?: Json
  after?: Json
}
export function changes(before: Record<string, Json>, after: Record<string, Json>, path: string[] = []): FieldChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
    const a = before[key],
      b = after[key],
      next = [...path, key]
    if (equal(a, b)) return []
    return object(a) && object(b) ? changes(a, b, next) : [{ path: next, before: a, after: b }]
  })
}
export function setField(value: Record<string, Json>, path: string[], next: Json | undefined) {
  if (!path.length || path.some(key => ['__proto__', 'prototype', 'constructor'].includes(key)))
    throw new Error('此字段需要在外部编辑器处理。')
  let parent = value
  for (const key of path.slice(0, -1)) {
    if (!object(parent[key])) parent[key] = {}
    parent = parent[key] as Record<string, Json>
  }
  if (next === undefined) delete parent[path.at(-1)!]
  else parent[path.at(-1)!] = clone(next)
}
export const atField = (value: Record<string, Json>, path: string[]) =>
  path.reduce<Json | undefined>((at, key) => (object(at) ? at[key] : undefined), value)
export const sharedAt = (fields: SharedField[], path: (string | number)[]) =>
  fields.some(field =>
    field.path.slice(0, Math.min(path.length, field.path.length)).every((key, i) => String(key) === String(path[i])),
  )
export const sharedFieldsUnder = (fields: SharedField[], prefix: (string | number)[]) =>
  fields.filter(field => sharedAt([field], prefix)).map(field => ({ ...field, path: field.path.slice(prefix.length) }))
