import { Category, Element, IgnoreStageStrategy } from '@arcadia-eternity/const'
import {
  MarkSchema,
  SkillSchema,
  SpeciesSchema,
  type MarkSchemaType,
  type SkillSchemaType,
  type SpeciesSchemaType,
} from '@arcadia-eternity/schema'
import type { TSchema } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'

export type EditableDataKind = 'species' | 'skills' | 'marks'

export type TypeBoxSummaryColumn = {
  id: string
  label: string
  path: string
  width?: number
}

type TypeBoxSchemaSpec<Row extends Record<string, unknown>> = {
  title: string
  defaultDataFile: string
  rowSchema: TSchema
  createDraft: () => Row
  summaryColumns: TypeBoxSummaryColumn[]
}

const SPECIES_SPEC: TypeBoxSchemaSpec<SpeciesSchemaType> = {
  title: 'Species 编辑器',
  defaultDataFile: 'species.yaml',
  rowSchema: SpeciesSchema,
  createDraft: () => ({
    id: '',
    num: 0,
    element: Element.Normal,
    baseStats: {
      hp: 100,
      atk: 100,
      spa: 100,
      def: 100,
      spd: 100,
      spe: 100,
    },
    genderRatio: [50, 50],
    heightRange: [10, 20],
    weightRange: [10, 20],
    learnable_skills: [],
    ability: [],
    emblem: [],
  }),
  summaryColumns: [
    { id: 'id', label: 'ID', path: 'id', width: 180 },
    { id: 'num', label: '图鉴', path: 'num', width: 90 },
    { id: 'element', label: '属性', path: 'element', width: 110 },
    { id: 'hp', label: 'HP', path: 'baseStats.hp', width: 80 },
    { id: 'atk', label: 'ATK', path: 'baseStats.atk', width: 80 },
    { id: 'def', label: 'DEF', path: 'baseStats.def', width: 80 },
    { id: 'spa', label: 'SPA', path: 'baseStats.spa', width: 80 },
    { id: 'spd', label: 'SPD', path: 'baseStats.spd', width: 80 },
    { id: 'spe', label: 'SPE', path: 'baseStats.spe', width: 80 },
  ],
}

const SKILL_SPEC: TypeBoxSchemaSpec<SkillSchemaType> = {
  title: 'Skill 编辑器',
  defaultDataFile: 'skill.yaml',
  rowSchema: SkillSchema,
  createDraft: () => ({
    id: '',
    element: Element.Normal,
    category: Category.Physical,
    power: 0,
    rage: 0,
    accuracy: 100,
    sureHit: false,
    sureCrit: false,
    ignoreShield: false,
    ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
    tags: [],
  }),
  summaryColumns: [
    { id: 'id', label: 'ID', path: 'id', width: 220 },
    { id: 'element', label: '属性', path: 'element', width: 110 },
    { id: 'category', label: '分类', path: 'category', width: 120 },
    { id: 'power', label: '威力', path: 'power', width: 90 },
    { id: 'rage', label: '怒气', path: 'rage', width: 90 },
    { id: 'accuracy', label: '命中', path: 'accuracy', width: 90 },
    { id: 'priority', label: '优先级', path: 'priority', width: 100 },
  ],
}

const MARK_SPEC: TypeBoxSchemaSpec<MarkSchemaType> = {
  title: 'Mark 编辑器',
  defaultDataFile: 'mark.yaml',
  rowSchema: MarkSchema,
  createDraft: () => ({
    id: '',
    tags: [],
  }),
  summaryColumns: [
    { id: 'id', label: 'ID', path: 'id', width: 220 },
    { id: 'duration', label: '持续', path: 'config.duration', width: 90 },
    { id: 'maxStacks', label: '层数', path: 'config.maxStacks', width: 90 },
    { id: 'stackable', label: '可叠', path: 'config.stackable', width: 90 },
    { id: 'isShield', label: '护盾', path: 'config.isShield', width: 90 },
  ],
}

const SPEC_BY_KIND: Record<EditableDataKind, TypeBoxSchemaSpec<Record<string, unknown>>> = {
  species: SPECIES_SPEC as TypeBoxSchemaSpec<Record<string, unknown>>,
  skills: SKILL_SPEC as TypeBoxSchemaSpec<Record<string, unknown>>,
  marks: MARK_SPEC as TypeBoxSchemaSpec<Record<string, unknown>>,
}

export function getTypeBoxSchemaSpec(kind: EditableDataKind): TypeBoxSchemaSpec<Record<string, unknown>> {
  return SPEC_BY_KIND[kind]
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
