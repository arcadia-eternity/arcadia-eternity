// engine/src/schema-checker.ts
// SchemaTypeChecker — validates property paths against TypeBox schemas.
//
// Game layers register their entity/context schemas, and the checker
// can validate that a given property path is valid for a given type.
// This is used by the effectBuilder to provide type-safe DSL.

import type { TSchema, TObject, TArray } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PropertyInfo {
  name: string
  type: string
  optional: boolean
  schema: TSchema
}

// ---------------------------------------------------------------------------
// SchemaTypeChecker
// ---------------------------------------------------------------------------

export class SchemaTypeChecker {
  private schemas = new Map<string, TSchema>()

  /**
   * Register a named schema.
   */
  register(name: string, schema: TSchema): void {
    this.schemas.set(name, schema)
  }

  /**
   * Unregister a schema.
   */
  unregister(name: string): void {
    this.schemas.delete(name)
  }

  /**
   * Get a registered schema by name.
   */
  getSchema(name: string): TSchema | undefined {
    return this.schemas.get(name)
  }

  /**
   * Get all registered schema names.
   */
  getRegisteredNames(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Validate that a dot-separated property path is valid for a given type.
   *
   * Example: validatePath('Pet', 'baseStats.hp') → true
   */
  validatePath(typeName: string, path: string): boolean {
    const schema = this.schemas.get(typeName)
    if (!schema) return false

    const parts = path.split('.')
    let current: TSchema = schema

    for (const part of parts) {
      const resolved = this.resolveProperty(current, part)
      if (!resolved) return false
      current = resolved
    }

    return true
  }

  /**
   * Get the expected type string for a property path.
   */
  getExpectedType(typeName: string, path: string): string | undefined {
    const schema = this.schemas.get(typeName)
    if (!schema) return undefined

    const parts = path.split('.')
    let current: TSchema = schema

    for (const part of parts) {
      const resolved = this.resolveProperty(current, part)
      if (!resolved) return undefined
      current = resolved
    }

    return this.getTypeString(current)
  }

  /**
   * Get available properties for a type (top-level only).
   */
  getAvailableProperties(typeName: string): PropertyInfo[] {
    const schema = this.schemas.get(typeName)
    if (!schema) return []
    return this.extractProperties(schema)
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private resolveProperty(schema: TSchema, propertyName: string): TSchema | undefined {
    // Handle TObject
    if (KindGuard.IsObject(schema)) {
      const obj = schema as TObject
      const prop = obj.properties[propertyName]
      if (prop) return prop
    }

    // Handle TArray — allow numeric index or 'items'
    if (KindGuard.IsArray(schema)) {
      const arr = schema as TArray
      if (propertyName === 'items' || /^\d+$/.test(propertyName)) {
        return arr.items
      }
    }

    // Handle TIntersect — search all allOf members
    if (KindGuard.IsIntersect(schema)) {
      for (const member of schema.allOf) {
        const resolved = this.resolveProperty(member, propertyName)
        if (resolved) return resolved
      }
    }

    // Handle TUnion — check if property exists in all members
    if (KindGuard.IsUnion(schema)) {
      for (const member of schema.anyOf) {
        const resolved = this.resolveProperty(member, propertyName)
        if (resolved) return resolved
      }
    }

    return undefined
  }

  private extractProperties(schema: TSchema): PropertyInfo[] {
    const props: PropertyInfo[] = []

    if (KindGuard.IsObject(schema)) {
      const obj = schema as TObject
      const required = new Set(obj.required ?? [])
      for (const [name, propSchema] of Object.entries(obj.properties)) {
        props.push({
          name,
          type: this.getTypeString(propSchema),
          optional: !required.has(name),
          schema: propSchema,
        })
      }
    }

    if (KindGuard.IsIntersect(schema)) {
      for (const member of schema.allOf) {
        props.push(...this.extractProperties(member))
      }
    }

    return props
  }

  private getTypeString(schema: TSchema): string {
    if (KindGuard.IsString(schema)) return 'string'
    if (KindGuard.IsNumber(schema)) return 'number'
    if (KindGuard.IsBoolean(schema)) return 'boolean'
    if (KindGuard.IsArray(schema)) return 'array'
    if (KindGuard.IsObject(schema)) return 'object'
    if (KindGuard.IsLiteral(schema)) return `literal(${schema.const})`
    if (KindGuard.IsUnion(schema)) return 'union'
    if (KindGuard.IsIntersect(schema)) return 'intersect'
    return 'unknown'
  }
}
