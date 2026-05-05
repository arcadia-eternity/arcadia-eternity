import type { Component } from 'vue'
import type { TSchema } from '@sinclair/typebox'

/** Display hint — maps a field to a rich editor component */
export type RichDisplayHint =
  | 'statBars'
  | 'entityTable'
  | 'entityTags'
  | 'configGrid'
  | 'statsGrid'
  | 'elementPicker'
  | 'identity'
  | 'default'

/** Configuration passed to a field-level rich editor component */
export interface RichFieldContext {
  /** Dot-path of this field in the record (e.g. "baseStats.hp") */
  path: string
  /** The TypeBox schema node for this field */
  schema: TSchema
  /** Current value of this field in the draft */
  value: unknown
  /** Emit when user edits the value */
  onUpdate: (value: unknown) => void
  /** Extra hints declared in the schema spec */
  hints: RichFieldHints
  /** Shared metadata like counts, entity references */
  metadata: RichEditorMetadata
}

/** Per-field hints declared in the schema spec */
export interface RichFieldHints {
  display?: RichDisplayHint
  editable?: boolean
  compact?: boolean
  entityKind?: string
  itemLabel?: string
  columns?: number
  /** For entityTags: which parent field to read the entity kind from */
  entityKindFrom?: string
  /** For entityTags: which property holds the target ID */
  idKey?: string
  /** For statBars: which keys to show */
  statKeys?: readonly string[]
  /** For statBars: labels for each key */
  statLabels?: Record<string, string>
  /** For configGrid: which config keys to show (defaults to all) */
  configKeys?: readonly string[]
  /** For configGrid: labels for each config key */
  configLabels?: Record<string, string>
  /** For statsGrid: which stat keys to show */
  statsKeys?: readonly string[]
  /** For statsGrid: labels for each stat key */
  statsLabels?: Record<string, string>
}

/** Shared metadata available to all rich editors */
export interface RichEditorMetadata {
  /** Current record ID */
  recordId: string
  /** Current entity type key */
  entityType: string
  /** All game data records for cross-referencing */
  gameData: Record<string, Record<string, unknown>>
  /** Entity record counts */
  recordCounts: Record<string, number>
}

/** A rich editor component's props contract */
export interface RichEditorProps {
  context: RichFieldContext
}

/** Registry entry — maps a display hint to a component */
export interface RichEditorRegistration {
  hint: RichDisplayHint
  component: Component
  /** Higher priority = matched first */
  priority?: number
  /** Optional: additional conditions for matching this editor */
  match?: (ctx: RichFieldContext) => boolean
}
