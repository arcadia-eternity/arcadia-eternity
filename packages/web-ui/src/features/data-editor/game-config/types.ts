import type { TSchema } from '@sinclair/typebox'
import type { RichFieldHints } from '../components/property-panel/rich-editors/types'

export type I18nConfig = {
  namespaces?: string | string[]
  nameKey?: string
  hasNames?: boolean
}

export type TypeBoxSummaryColumn = {
  id: string
  label: string
  path: string
  width?: number
}

/** Runtime entity type identifier — derived from config keys, not hardcoded */
export type EntityKind = string

/** Per-entity-type display and behaviour configuration */
export interface EntityConfig {
  /** Unique key (e.g. 'species', 'skills') */
  key: EntityKind
  /** Display label (can be i18n key or literal) */
  label: string
  /** Emoji or text icon shown in sidebar / search */
  icon: string
  /** Default YAML data file name (e.g. 'species.yaml') */
  dataFile: string
  /** TypeBox schema for this entity */
  schema: TSchema
  /** Factory to create a new draft record */
  createDraft: () => Record<string, unknown>
  /** Columns shown in the DataTable summary view */
  summaryColumns: TypeBoxSummaryColumn[]
  /** Rich editor hints for fields in the property panel */
  fieldHints: Record<string, RichFieldHints>
  /** i18n configuration for entity name translation */
  i18n?: I18nConfig
}

/** Category display metadata (e.g. Physical='物攻') */
export interface CategoryMeta {
  value: string | number
  label: string
  color: string
  bg: string
}

/** Root game configuration — provided once at app level */
export interface GameConfig {
  /** Entity types registered in this game */
  entities: Record<EntityKind, EntityConfig>
  /** Categories shown in identity headers and skill properties */
  categories?: CategoryMeta[]
  /** Trigger condition labels for effects/marks (e.g. onUse='使用时') */
  triggers?: Record<string, string>
}
