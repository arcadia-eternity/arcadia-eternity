/** Only plain finite JSON data crosses the Content/Core/Host boundary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export function copyData<T>(value: T): T {
  function visit(item: unknown, ancestors: Set<object>): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (typeof item !== 'object' || item === null) throw new Error('Expected finite JSON data')
    if (ancestors.has(item)) throw new Error('Cyclic data is not supported')
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('Host objects are not supported')
    const next = new Set(ancestors).add(item)
    if (Array.isArray(item)) return item.map(v => visit(v, next))
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, visit(v, next)]),
    )
  }
  return visit(value, new Set()) as T
}

/** Canonical full identity; intentionally not a security hash or a content package format (#224). */
export function canonicalData(value: unknown): string {
  const clean = copyData(value)
  function encode(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(encode).join(',')}]`
    if (v !== null && typeof v === 'object')
      return `{${Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => `${JSON.stringify(k)}:${encode(x)}`)
        .join(',')}}`
    return JSON.stringify(v)
  }
  return encode(clean)
}

export function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeData)
    Object.freeze(value)
  }
  return value
}

export function requireNumber(value: number, name: string, min = 0): void {
  if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${name}`)
}
