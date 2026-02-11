import { Value } from '@sinclair/typebox/value'
import { type TSchema, type Static, Type } from '@sinclair/typebox'

/**
 * 解析并验证数据，类似 Zod 的 parse 行为
 * 1. 填充默认值
 * 2. 清理多余字段
 * 3. 验证数据
 */
export function parseWithErrors<T extends TSchema>(schema: T, data: unknown): Static<T> {
  const cloned = structuredClone(data)
  const withDefaults = Value.Default(schema, cloned)
  const cleaned = Value.Clean(schema, withDefaults)
  const converted = Value.Convert(schema, cleaned)
  if (Value.Check(schema, converted)) {
    return converted as Static<T>
  }
  const errors = [...Value.Errors(schema, converted)]
  const message = errors.map(e => `${e.path}: ${e.message}`).join('; ')
  throw new Error(`Validation failed: ${message}`)
}

/**
 * 将 TypeScript native enum 转为 TypeBox Union of Literal
 * 适用于 string enum（如 Element, Category 等）
 * 保留字面量类型信息
 */
export function StringEnum<T extends string>(values: readonly T[]) {
  return Type.Union(
    values.map(v => Type.Literal(v as T)),
  ) as import('@sinclair/typebox').TUnion<import('@sinclair/typebox').TLiteral<T>[]>
}

/**
 * 将 TypeScript native enum (numeric or string) 转为 TypeBox schema
 * 适用于 nativeEnum 场景（如 StackStrategy）
 */
export function NativeEnum<T extends Record<string, string | number>>(enumObj: T) {
  const values = Object.values(enumObj).filter(v => typeof v === 'string') as string[]
  if (values.length === 0) {
    // numeric enum
    const numValues = Object.values(enumObj).filter(v => typeof v === 'number') as number[]
    return Type.Union(numValues.map(v => Type.Literal(v)))
  }
  return Type.Union(values.map(v => Type.Literal(v)))
}
