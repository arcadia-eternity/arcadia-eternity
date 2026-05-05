import type { TSchema } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import i18next from 'i18next'
import type { RichFieldHints } from '../components/property-panel/rich-editors/types'
import type { EntityKind, EntityConfig, I18nConfig } from '../game-config/types'

export type EditableDataKind = string

export type { I18nConfig, RichFieldHints }

export type TypeBoxSummaryColumn = {
  id: string
  label: string
  path: string
  width?: number
}

export function translateEntityName(id: string, entityCfg: EntityConfig): string {
  const cfg = entityCfg.i18n
  if (!cfg || cfg.hasNames === false) return id
  try {
    const key = (cfg.nameKey ?? '{id}.name').replace('{id}', id)
    const ns = cfg.namespaces
    if (!ns) return id
    return i18next.t(key, { ns, defaultValue: id })
  } catch {
    return id
  }
}

export function getValueByPath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean)
  let current: unknown = source

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

export function resolveSchemaByPath(schema: TSchema, path: string): TSchema | null {
  const segments = path.split('.').filter(Boolean)
  let current: TSchema | null = schema

  for (const segment of segments) {
    if (!current) return null

    if (KindGuard.IsUnion(current)) {
      const members = current.anyOf as TSchema[]
      const next = members.find((member: TSchema) => {
        if (!KindGuard.IsObject(member)) return false
        const memberProperties = member.properties as Record<string, TSchema | undefined>
        return Object.prototype.hasOwnProperty.call(memberProperties, segment)
      })
      current = (next as TSchema | undefined) ?? members[0] ?? null
      continue
    }

    if (KindGuard.IsObject(current)) {
      const properties = current.properties as Record<string, TSchema | undefined>
      const next = properties[segment]
      current = (next as TSchema | undefined) ?? null
      continue
    }

    if (KindGuard.IsArray(current)) {
      current = current.items as TSchema
      continue
    }

    if (KindGuard.IsTuple(current)) {
      const numericIndex = Number(segment)
      if (!Number.isInteger(numericIndex) || numericIndex < 0) return null
      current = (current.items?.[numericIndex] as TSchema | undefined) ?? null
      continue
    }

    return null
  }

  return current
}

export function formatSummaryValue(value: unknown): string {
  if (value === undefined) return '∅'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length > 0 ? value : '""'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length}项`
  if (typeof value === 'object') return '对象'
  return String(value)
}
