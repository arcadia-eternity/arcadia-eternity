import type { GameConfig, EntityConfig, CategoryMeta } from './types'
import { Category, Element, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { SpeciesSchema, SkillSchema, MarkSchema } from '@arcadia-eternity/schema'

const species: EntityConfig = {
  key: 'species',
  label: '物种',
  icon: '🧬',
  dataFile: 'species.yaml',
  schema: SpeciesSchema,
  createDraft: () => ({
    id: '',
    num: 0,
    element: Element.Normal,
    baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
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
  fieldHints: {
    baseStats:        { display: 'statBars', statKeys: ['hp', 'atk', 'spa', 'def', 'spd', 'spe'] },
    learnable_skills: { display: 'entityTable', entityKind: 'skills', idKey: 'skill_id' },
    ability:          { display: 'entityTags', entityKind: 'marks' },
    emblem:           { display: 'entityTags', entityKind: 'marks' },
    element:          { display: 'elementPicker' },
  },
  i18n: { namespaces: 'species' },
}

const skills: EntityConfig = {
  key: 'skills',
  label: '技能',
  icon: '⚔️',
  dataFile: 'skill.yaml',
  schema: SkillSchema,
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
  fieldHints: {
    power:   { display: 'statsGrid', statsKeys: ['power', 'accuracy', 'rage', 'priority'] },
    effect:  { display: 'entityTags', entityKind: 'effects' },
    element: { display: 'elementPicker' },
    tags:    { display: 'entityTags', entityKind: 'skills', idKey: 'tag' },
  },
  i18n: { namespaces: 'skill' },
}

const marks: EntityConfig = {
  key: 'marks',
  label: '标记',
  icon: '🏷️',
  dataFile: 'mark.yaml',
  schema: MarkSchema,
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
  fieldHints: {
    config: { display: 'configGrid' },
    effect: { display: 'entityTags', entityKind: 'effects' },
    tags:   { display: 'entityTags', entityKind: 'marks', idKey: 'tag' },
  },
  i18n: { namespaces: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] },
}

const categories: CategoryMeta[] = [
  { value: Category.Physical, label: '物攻', color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  { value: Category.Special,  label: '特攻', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  { value: Category.Status,   label: '属性', color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  { value: Category.Climax,   label: '终极', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
]

const triggers: Record<string, string> = {
  onUse: '使用时',
  onHit: '命中时',
  onBeHit: '被击中时',
  onKill: '击败时',
  onBeKill: '被击败时',
  onSwitchIn: '上场时',
  onSwitchOut: '下场时',
  onTurnStart: '回合开始',
  onTurnEnd: '回合结束',
  onFaint: '濒死时',
  onBeforeAttack: '攻击前',
  onAfterAttack: '攻击后',
  onBeforeUse: '使用前',
  onBeDamaged: '受伤时',
  onDealDamage: '造成伤害时',
}

export const seer2Config: GameConfig = {
  entities: { species, skills, marks },
  categories,
  triggers,
}
