import type { EntityConfig } from './types'
import { effectDSLSchema } from '@arcadia-eternity/schema'

export const effects: EntityConfig = {
  key: 'effects',
  label: '效果',
  icon: '✨',
  dataFile: 'effect_skill.yaml',
  schema: effectDSLSchema,
  createDraft: () => ({
    id: '',
    trigger: [],
    priority: 0,
    apply: { type: 'TODO' },
    tags: [],
  }),
  summaryColumns: [
    { id: 'id', label: 'ID', path: 'id', width: 240 },
    { id: 'trigger', label: '触发器', path: 'trigger', width: 160 },
    { id: 'priority', label: '优先级', path: 'priority', width: 80 },
    { id: 'tags', label: '标签', path: 'tags', width: 120 },
  ],
  fieldHints: {
    trigger:  { display: 'entityTags', entityKind: 'effects' },
    apply:    { editable: false },
    condition: { editable: false },
    tags:     { display: 'entityTags', entityKind: 'effects', idKey: 'tag' },
  },
  i18n: { hasNames: false },
}

export const baseEntities = {
  effects,
} as Record<string, EntityConfig>
