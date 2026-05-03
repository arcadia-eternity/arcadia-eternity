import { Type } from '@sinclair/typebox'
import type { EntityConfig } from './types'

export const effects: EntityConfig = {
  key: 'effects',
  label: '效果',
  icon: '✨',
  dataFile: 'effect_skill.yaml',
  schema: Type.Object({ id: Type.String(), trigger: Type.Optional(Type.Array(Type.String())) }),
  createDraft: () => ({
    id: '',
    trigger: [],
  }),
  summaryColumns: [
    { id: 'id', label: 'ID', path: 'id', width: 220 },
    { id: 'trigger', label: '触发数', path: 'trigger', width: 120 },
  ],
  fieldHints: {},
  i18n: { hasNames: false },
}

export const baseEntities = {
  effects,
} as Record<string, EntityConfig>
