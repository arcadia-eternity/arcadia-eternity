import { computed } from 'vue'
import {
  getEffectDslManifest,
  getEffectDslNodeTyping,
  BASE_SELECTOR_KEYS,
  type EffectDslNodeKind,
  type EffectDslNodeTypingRule,
  type EffectDslFieldTypingRule,
  type EffectDslStateConstraint,
  type StringEnumOption,
  type BaseSelectorKey,
  type ConditionDSL,
} from '@arcadia-eternity/schema'
import type { CompileState } from '@arcadia-eternity/battle'

export type SelectorOption = {
  value: BaseSelectorKey
  label: string
  group: 'pet' | 'team' | 'mark' | 'skill' | 'context' | 'battle' | 'other'
}

export type ValueTypeOption = {
  value: string
  label: string
  icon: string
  description?: string
}

const manifest = getEffectDslManifest()

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

export function resolveSelectorOptions(fieldTyping?: EffectDslFieldTypingRule): SelectorOption[] {
  if (!fieldTyping) return ALL_SELECTOR_OPTIONS

  const options = new Map<string, SelectorOption>()

  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'id' && constraint.targets) {
      for (const target of constraint.targets) {
        const mapped = TARGET_TO_SELECTORS[target]
        if (mapped) {
          for (const opt of mapped) options.set(opt.value, opt)
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
      return ALL_SELECTOR_OPTIONS
    }
  }

  return options.size > 0 ? [...options.values()] : ALL_SELECTOR_OPTIONS
}

export function resolveValueTypeOptions(fieldTyping?: EffectDslFieldTypingRule): ValueTypeOption[] {
  if (!fieldTyping) return VALUE_TYPE_OPTIONS

  const allowed = new Set<string>()

  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'scalar') {
      if (constraint.valueTypes && constraint.valueTypes.length > 0) {
        for (const vt of constraint.valueTypes) {
          if (vt === 'number') {
            allowed.add('raw:number')
            allowed.add('dynamic')
            allowed.add('selectorValue')
          }
          if (vt === 'string') {
            allowed.add('raw:string')
            allowed.add('entity:baseMark')
            allowed.add('entity:baseSkill')
            allowed.add('entity:species')
            allowed.add('entity:effect')
            allowed.add('dynamic')
            allowed.add('selectorValue')
          }
          if (vt === 'boolean') {
            allowed.add('raw:boolean')
            allowed.add('dynamic')
            allowed.add('selectorValue')
          }
        }
      } else {
        allowed.add('raw:number')
        allowed.add('raw:string')
        allowed.add('raw:boolean')
        allowed.add('dynamic')
        allowed.add('selectorValue')
      }
    }
    if (constraint.kind === 'id') {
      if (constraint.targets && constraint.targets.length > 0) {
        if (constraint.targets.includes('baseMark')) allowed.add('entity:baseMark')
        if (constraint.targets.includes('baseSkill')) allowed.add('entity:baseSkill')
        if (constraint.targets.includes('skill')) allowed.add('entity:baseSkill')
        if (constraint.targets.includes('mark')) allowed.add('entity:baseMark')
        if (constraint.targets.includes('pet')) allowed.add('entity:species')
        if (constraint.targets.includes('effectDef')) {
          allowed.add('entity:effect')
          allowed.add('operator')
        }
      } else {
        allowed.add('entity:baseMark')
        allowed.add('entity:baseSkill')
        allowed.add('entity:species')
        allowed.add('entity:effect')
      }
      allowed.add('dynamic')
      allowed.add('selectorValue')
    }
    if (constraint.kind === 'owner') {
      allowed.add('dynamic')
      allowed.add('selectorValue')
    }
    if (constraint.kind === 'object') {
      for (const cls of constraint.classes ?? []) {
        if (cls === 'dsl:operator') allowed.add('operator')
        if (cls === 'json:array') allowed.add('array')
        if (cls === 'json:stringArray') allowed.add('raw:string')
      }
      allowed.add('dynamic')
      allowed.add('selectorValue')
    }
    if (constraint.kind === 'propertyRef') {
      allowed.add('raw:string')
      allowed.add('dynamic')
      allowed.add('selectorValue')
    }
    if (constraint.kind === 'stringEnum') {
      allowed.add('raw:string')
      allowed.add('dynamic')
      allowed.add('selectorValue')
    }
  }

  return allowed.size > 0 ? VALUE_TYPE_OPTIONS.filter(opt => allowed.has(opt.value)) : VALUE_TYPE_OPTIONS
}

export function resolveEvaluatorOptions(fieldTyping?: EffectDslFieldTypingRule): string[] {
  const all = Object.keys(manifest.evaluator).filter(k => manifest.evaluator[k] !== undefined)
  if (!fieldTyping) return all

  const allowed = new Set<string>()
  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'scalar') {
      allowed.add('compare').add('same').add('notSame')
      const types = constraint.valueTypes
      if (!types || types.length === 0 || types.includes('string')) {
        allowed.add('contain')
      }
    }
    if (constraint.kind === 'id' || constraint.kind === 'owner') {
      allowed.add('exist').add('same').add('notSame').add('anyOf')
    }
    if (constraint.kind === 'object') {
      allowed.add('compare').add('same').add('notSame')
    }
    if (constraint.kind === 'stringEnum') {
      allowed.add('compare').add('same').add('notSame').add('contain').add('anyOf')
    }
  }
  return allowed.size > 0 ? all.filter(k => allowed.has(k)) : all
}

export function resolveConditionOptions(_fieldTyping?: EffectDslFieldTypingRule): ConditionDSL['type'][] {
  return Object.keys(manifest.condition).filter(k => manifest.condition[k] !== undefined) as ConditionDSL['type'][]
}

export function resolveStringEnumOptions(fieldTyping?: EffectDslFieldTypingRule): StringEnumOption[] | undefined {
  if (!fieldTyping) return undefined
  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'stringEnum') {
      return [...constraint.values]
    }
  }
  return undefined
}

export function compileStatesToFieldTyping(states: readonly CompileState[]): EffectDslFieldTypingRule {
  const allow: EffectDslStateConstraint[] = []
  for (const state of states) {
    switch (state.kind) {
      case 'id':
        allow.push({ kind: 'id', targets: [state.target] })
        break
      case 'owner':
        allow.push({ kind: 'owner', owners: [state.owner] })
        break
      case 'scalar':
        allow.push({ kind: 'scalar', valueTypes: [state.valueType] })
        if (state.stringEnumOptions && state.stringEnumOptions.length > 0) {
          allow.push({ kind: 'stringEnum', values: state.stringEnumOptions })
        }
        break
      case 'object':
        allow.push({ kind: 'object', classes: [state.objectClass] })
        break
      case 'propertyRef':
        allow.push({ kind: 'propertyRef' })
        break
    }
  }
  return { allow }
}

/**
 * Centralized typing resolution for the effect DSL editor.
 * Provides manifest access, node/field typing lookups, selector/value/evaluator
 * option resolution, and computed type lists for UI pickers.
 */
export function useNodeTyping() {
  function getNodeTyping(kind: EffectDslNodeKind, type: string): EffectDslNodeTypingRule | undefined {
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
    return fields[field]
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
    resolveSelectorOptions,
    resolveValueTypeOptions,
    resolveEvaluatorOptions,
    resolveConditionOptions,
    resolveStringEnumOptions,
    compileStatesToFieldTyping,
    operatorTypes,
    conditionTypes,
    evaluatorTypes,
  }
}
