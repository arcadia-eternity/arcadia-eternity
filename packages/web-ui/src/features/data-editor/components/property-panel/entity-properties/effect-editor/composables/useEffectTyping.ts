import { computed, type Ref } from 'vue'
import { getEffectDslManifest, getEffectDslNodeTyping, type EffectDslNodeKind } from '@arcadia-eternity/schema'
import type { EffectDslFieldTypingRule, EffectDslStateConstraint } from '@arcadia-eternity/schema'
import { BASE_SELECTOR_KEYS, BASE_EXTRACTOR_KEYS, COMPARE_OPERATORS } from '@arcadia-eternity/schema'

export type SelectorOption = {
  value: string
  label: string
  group: 'pet' | 'team' | 'mark' | 'skill' | 'context' | 'battle' | 'other'
}

export type ValueTypeOption = {
  value: string
  label: string
  icon: string
  description?: string
}

export type ExtractorOption = {
  value: string
  label: string
}

const TARGET_TO_SELECTORS: Record<string, SelectorOption[]> = {
  pet: [
    { value: 'self', label: '自身', group: 'pet' },
    { value: 'opponent', label: '对手', group: 'pet' },
    { value: 'target', label: '目标', group: 'pet' },
  ],
  team: [
    { value: 'selfTeam', label: '己方队伍', group: 'team' },
    { value: 'opponentTeam', label: '对方队伍', group: 'team' },
  ],
  mark: [
    { value: 'mark', label: '标记', group: 'mark' },
    { value: 'selfMarks', label: '自身标记', group: 'mark' },
    { value: 'opponentMarks', label: '对手标记', group: 'mark' },
    { value: 'dataMarks', label: '数据标记', group: 'mark' },
  ],
  baseMark: [
    { value: 'selfMarks', label: '自身标记', group: 'mark' },
    { value: 'opponentMarks', label: '对手标记', group: 'mark' },
    { value: 'mark', label: '标记', group: 'mark' },
  ],
  baseSkill: [
    { value: 'skill', label: '技能', group: 'skill' },
    { value: 'selfSkills', label: '自身技能', group: 'skill' },
    { value: 'opponentSkills', label: '对手技能', group: 'skill' },
    { value: 'selfAvailableSkills', label: '自身可用技能', group: 'skill' },
    { value: 'opponentAvailableSkills', label: '对手可用技能', group: 'skill' },
  ],
  skill: [
    { value: 'skill', label: '技能', group: 'skill' },
    { value: 'selfSkills', label: '自身技能', group: 'skill' },
    { value: 'opponentSkills', label: '对手技能', group: 'skill' },
  ],
  player: [
    { value: 'selfPlayer', label: '己方', group: 'pet' },
    { value: 'opponentPlayer', label: '对方', group: 'pet' },
  ],
}

const OWNER_TO_SELECTORS: Record<string, SelectorOption> = {
  useSkillContext: { value: 'useSkillContext', label: '技能上下文', group: 'context' },
  damageContext: { value: 'damageContext', label: '伤害上下文', group: 'context' },
  healContext: { value: 'healContext', label: '治疗上下文', group: 'context' },
  rageContext: { value: 'rageContext', label: '怒气上下文', group: 'context' },
  addMarkContext: { value: 'addMarkContext', label: '添加标记上下文', group: 'context' },
  switchPetContext: { value: 'switchPetContext', label: '换宠上下文', group: 'context' },
  turnContext: { value: 'turnContext', label: '回合上下文', group: 'context' },
  stackContext: { value: 'stackContext', label: '堆叠上下文', group: 'context' },
  consumeStackContext: { value: 'consumeStackContext', label: '消耗堆叠上下文', group: 'context' },
  effectContext: { value: 'effectContext', label: '效果上下文', group: 'context' },
}

const BATTLE_SELECTORS: SelectorOption[] = [
  { value: 'battle', label: '战斗', group: 'battle' },
  { value: 'currentPhase', label: '当前阶段', group: 'battle' },
  { value: 'allPhases', label: '所有阶段', group: 'battle' },
]

const ALL_SELECTOR_OPTIONS: SelectorOption[] = BASE_SELECTOR_KEYS.map(key => {
  const known = Object.values(OWNER_TO_SELECTORS).find(s => s.value === key)
  if (known) return known
  const inPet = TARGET_TO_SELECTORS.pet.find(s => s.value === key)
  if (inPet) return inPet
  const inBattle = BATTLE_SELECTORS.find(s => s.value === key)
  if (inBattle) return inBattle
  const allKnown = [...Object.values(TARGET_TO_SELECTORS).flat(), ...BATTLE_SELECTORS]
  const found = allKnown.find(s => s.value === key)
  return found ?? { value: key, label: key, group: 'other' as const }
})

export function resolveSelectorOptions(fieldTyping: EffectDslFieldTypingRule | undefined): SelectorOption[] {
  if (!fieldTyping) return ALL_SELECTOR_OPTIONS

  const options = new Map<string, SelectorOption>()

  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'id' && constraint.targets) {
      for (const target of constraint.targets) {
        const mapped = TARGET_TO_SELECTORS[target]
        if (mapped) {
          for (const opt of mapped) {
            options.set(opt.value, opt)
          }
        }
      }
    }
    if (constraint.kind === 'owner' && constraint.owners) {
      for (const owner of constraint.owners) {
        const opt = OWNER_TO_SELECTORS[owner]
        if (opt) options.set(opt.value, opt)
      }
    }
    if (constraint.kind === 'scalar') {
      for (const opt of ALL_SELECTOR_OPTIONS) {
        options.set(opt.value, opt)
      }
      return ALL_SELECTOR_OPTIONS
    }
  }

  if (options.size === 0) return ALL_SELECTOR_OPTIONS
  return [...options.values()]
}

export const VALUE_TYPE_OPTIONS: ValueTypeOption[] = [
  { value: 'raw:number', label: '数值', icon: '🔢' },
  { value: 'raw:string', label: '文本', icon: '📝' },
  { value: 'raw:boolean', label: '布尔', icon: '✓' },
  { value: 'entity:baseMark', label: '标记引用', icon: '🏷️' },
  { value: 'entity:baseSkill', label: '技能引用', icon: '⚔️' },
  { value: 'entity:species', label: '物种引用', icon: '🧬' },
  { value: 'entity:effect', label: '效果引用', icon: '✨' },
  { value: 'dynamic', label: '动态值', icon: '🔄', description: '运行时从选择器取值' },
  { value: 'selectorValue', label: '管道值', icon: '⛓️', description: '值 + 选择器管道处理' },
  { value: 'conditional', label: '条件值', icon: '🔀', description: '根据条件选择不同值' },
  { value: 'array', label: '数组', icon: '📋', description: '多个值的列表' },
  { value: 'operator', label: '内嵌操作符', icon: '⚙️', description: '内联操作符返回值' },
]

export function resolveValueTypeOptions(fieldTyping: EffectDslFieldTypingRule | undefined): ValueTypeOption[] {
  if (!fieldTyping) return VALUE_TYPE_OPTIONS

  const allowed = new Set<string>()

  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'scalar' && constraint.valueTypes) {
      for (const vt of constraint.valueTypes) {
        if (vt === 'number') {
          allowed.add('raw:number')
          allowed.add('dynamic')
        }
        if (vt === 'string') {
          allowed.add('raw:string')
          allowed.add('entity:baseMark')
          allowed.add('entity:baseSkill')
          allowed.add('entity:species')
          allowed.add('entity:effect')
          allowed.add('dynamic')
        }
        if (vt === 'boolean') {
          allowed.add('raw:boolean')
          allowed.add('dynamic')
        }
      }
    }
    if (constraint.kind === 'id') {
      if (constraint.targets?.includes('baseMark')) allowed.add('entity:baseMark')
      if (constraint.targets?.includes('baseSkill')) allowed.add('entity:baseSkill')
      if (constraint.targets?.includes('skill')) allowed.add('entity:baseSkill')
      if (constraint.targets?.includes('mark')) allowed.add('entity:baseMark')
      if (constraint.targets?.includes('pet')) allowed.add('entity:species')
      if (constraint.targets?.includes('effectDef')) {
        allowed.add('entity:effect')
        allowed.add('operator')
      }
    }
    if (constraint.kind === 'object') {
      for (const cls of constraint.classes ?? []) {
        if (cls === 'dsl:operator') allowed.add('operator')
        if (cls === 'json:array') allowed.add('array')
        if (cls === 'json:stringArray') allowed.add('raw:string')
      }
    }
    if (constraint.kind === 'propertyRef') {
      allowed.add('raw:string')
      allowed.add('dynamic')
    }
  }

  if (allowed.size === 0) return VALUE_TYPE_OPTIONS
  return VALUE_TYPE_OPTIONS.filter(opt => allowed.has(opt.value))
}

export function resolveEvaluatorOptions(fieldTyping?: EffectDslFieldTypingRule | undefined): string[] {
  const manifest = getEffectDslManifest()
  return Object.keys(manifest.evaluator).filter(k => manifest.evaluator[k] !== undefined)
}

export function resolveConditionOptions(fieldTyping?: EffectDslFieldTypingRule | undefined): string[] {
  const manifest = getEffectDslManifest()
  return Object.keys(manifest.condition).filter(k => manifest.condition[k] !== undefined)
}

export function useEffectTyping() {
  const manifest = getEffectDslManifest()

  function getNodeTyping(kind: EffectDslNodeKind, type: string) {
    return getEffectDslNodeTyping(kind, type)
  }

  function getFieldTyping(
    kind: EffectDslNodeKind,
    type: string,
    field: string,
    fieldCategory: 'selectorFields' | 'valueFields',
  ): EffectDslFieldTypingRule | undefined {
    const nodeTyping = getNodeTyping(kind, type)
    if (!nodeTyping) return undefined
    const fields = nodeTyping[fieldCategory]
    if (!fields) return undefined
    return (fields as Record<string, EffectDslFieldTypingRule>)[field]
  }

  const operatorTypes = computed(() => Object.keys(manifest.operator).filter(k => manifest.operator[k] !== undefined))

  const conditionTypes = computed(() =>
    Object.keys(manifest.condition).filter(k => manifest.condition[k] !== undefined),
  )

  const evaluatorTypes = computed(() =>
    Object.keys(manifest.evaluator).filter(k => manifest.evaluator[k] !== undefined),
  )

  return {
    manifest,
    getNodeTyping,
    getFieldTyping,
    operatorTypes,
    conditionTypes,
    evaluatorTypes,
    resolveSelectorOptions,
    resolveValueTypeOptions,
    resolveEvaluatorOptions,
    resolveConditionOptions,
  }
}
