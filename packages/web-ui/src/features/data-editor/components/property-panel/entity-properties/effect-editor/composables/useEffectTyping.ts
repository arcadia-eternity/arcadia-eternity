import { computed, type Ref } from 'vue'
import {
  getEffectDslManifest,
  getEffectDslNodeTyping,
  type EffectDslNodeKind,
  type StringEnumOption,
} from '@arcadia-eternity/schema'
import type { EffectDslFieldTypingRule, EffectDslStateConstraint } from '@arcadia-eternity/schema'
import { BASE_SELECTOR_KEYS, BASE_EXTRACTOR_KEYS, COMPARE_OPERATORS } from '@arcadia-eternity/schema'
import type { CompileState } from '@arcadia-eternity/battle'

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
  const all = Object.keys(manifest.evaluator).filter(k => manifest.evaluator[k] !== undefined)
  if (!fieldTyping) return all

  const allowed = new Set<string>()
  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'scalar') {
      allowed.add('compare').add('same').add('notSame')
    }
    if (constraint.kind === 'id' || constraint.kind === 'owner') {
      allowed.add('exist').add('notExist')
    }
    if (constraint.kind === 'object') {
      allowed.add('compare').add('same').add('notSame')
    }
  }
  if (allowed.size === 0) return all
  return all.filter(k => allowed.has(k))
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

export function resolveConditionOptions(fieldTyping?: EffectDslFieldTypingRule | undefined): string[] {
  const manifest = getEffectDslManifest()
  return Object.keys(manifest.condition).filter(k => manifest.condition[k] !== undefined)
}

export function resolveStringEnumOptions(
  fieldTyping: EffectDslFieldTypingRule | undefined,
): StringEnumOption[] | undefined {
  if (!fieldTyping) return undefined
  for (const constraint of fieldTyping.allow) {
    if (constraint.kind === 'stringEnum') {
      return [...constraint.values]
    }
  }
  return undefined
}

/**
 * Returns a human-readable hint explaining WHY a field has its typing constraint,
 * based on the engine's runtime behavior.
 */
export function getOperatorFieldHint(opType: string | undefined, fieldName: string | undefined): string | undefined {
  if (!opType || !fieldName) return undefined

  const specific: Record<string, Record<string, string>> = {
    dealDamage: {
      target: '引擎仅对宠物实体造成伤害',
      value: '期望数值类型（伤害值）',
    },
    heal: {
      target: '引擎仅对宠物实体执行治疗',
      value: '期望数值类型（治疗量）',
    },
    addRage: {
      target: '怒气属于玩家，选择宠物/技能/标记/玩家均可，引擎自动向上查找所属玩家',
      value: '期望数值类型（怒气值）',
    },
    setRage: {
      target: '怒气属于玩家，选择宠物/技能/标记/玩家均可，引擎自动向上查找所属玩家',
      value: '期望数值类型（怒气值）',
    },
    addMark: {
      target: '标记可挂在宠物或战斗实体上',
      mark: '期望标记引用或标记ID',
      duration: '期望数值类型（持续回合数）',
      stack: '期望数值类型（初始堆叠数）',
    },
    addStacks: {
      target: '引擎仅对标记实体增加堆叠',
      value: '期望数值类型（增加的堆叠数）',
    },
    consumeStacks: {
      target: '引擎仅对标记实体消耗堆叠',
      value: '期望数值类型（消耗的堆叠数）',
    },
    modifyStackResult: {
      target: '此字段需要上下文对象（如 addMarkContext），由添加标记事件自动注入',
      newStacks: '期望数值类型（修改后的堆叠数）',
      newDuration: '期望数值类型（修改后的持续回合）',
    },
    addAttributeModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串（如 attack、defense 等）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级，数值越小越先计算）',
    },
    addDynamicAttributeModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      stat: '期望属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillAttributeModifier: {
      target: '引擎仅对技能实体添加属性修正',
      attribute: '期望技能属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicSkillAttributeModifier: {
      target: '引擎仅对技能实体添加动态属性修正',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      attribute: '期望技能属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    setSkill: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望技能引用或技能ID',
    },
    setActualTarget: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      newTarget: '期望宠物实体选择器',
    },
    amplifyPower: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（威力增幅百分比）',
    },
    addPower: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的威力值）',
    },
    addCritRate: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的暴击率）',
    },
    addAccuracy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的命中率）',
    },
    setAccuracy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（设置的命中率）',
    },
    addMultihitResult: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（多段攻击次数）',
    },
    setMultihit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（多段攻击次数）',
    },
    addModified: {
      target: '此字段需要上下文对象（如 damageContext），由伤害事件自动注入',
      delta: '期望数值类型（固定伤害增量）',
      percent: '期望数值类型（伤害百分比修正）',
    },
    addThreshold: {
      target: '需要伤害上下文（damageContext），由伤害事件自动注入',
      min: '期望数值类型（最小伤害阈值）',
      max: '期望数值类型（最大伤害阈值）',
    },
    overrideMarkConfig: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      config: '期望JSON对象（标记配置覆盖）',
    },
    setIgnoreStageStrategy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望字符串（忽略能力等级策略名称）',
    },
    setSureHit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureCrit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureMiss: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureNoCrit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setIgnoreShield: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
    },
    stun: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    preventDamage: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    disableContext: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    setMarkDuration: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（持续回合数）',
    },
    setMarkStack: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（堆叠数）',
    },
    setMarkMaxStack: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（最大堆叠数）',
    },
    setMarkPersistent: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否常驻）',
    },
    setMarkStackable: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否可堆叠）',
    },
    setMarkStackStrategy: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望字符串（堆叠策略名称）',
    },
    setMarkDestroyable: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否可销毁）',
    },
    setMarkIsShield: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否为护盾）',
    },
    setMarkKeepOnSwitchOut: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（下场是否保留）',
    },
    setMarkTransferOnSwitch: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（换宠是否转移）',
    },
    setMarkInheritOnFaint: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（濒死是否继承）',
    },
    setStatLevelMarkLevel: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（能力等级标记等级）',
    },
    transform: {
      target: '变身可作用于任意实体（宠物/技能等）',
      newBase: '期望物种引用或物种ID',
      priority: '期望数值类型（变身优先级）',
    },
    transformWithPreservation: {
      target: '变身可作用于任意实体（宠物/技能等）',
      newBase: '期望物种引用或物种ID',
      priority: '期望数值类型（变身优先级）',
    },
    removeTransformation: {
      target: '变身可作用于任意实体（宠物/技能等）',
    },
    executeActions: {
      target: '期望内嵌操作符对象（DSL operator）',
    },
    addTemporaryEffect: {
      target: '临时效果可挂载到任意实体，引擎不做类型校验',
      effect: '期望效果引用或效果定义对象',
    },
    setConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      key: '期望字符串（配置键名）',
      value: '期望任意类型（配置值）',
    },
    registerConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      initialValue: '期望任意类型（初始值）',
    },
    registerTaggedConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      initialValue: '期望任意类型（初始值）',
      tags: '期望字符串或字符串数组（标签）',
    },
    addConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addTaggedConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      tag: '期望字符串（标签名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseDynamicConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseTypeConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicPhaseTypeConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    statStageBuff: {
      target: '引擎仅对宠物实体执行能力升降',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
      value: '期望数值类型（升降级数）',
    },
    clearStatStage: {
      target: '引擎仅对宠物实体清除能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    reverseStatStage: {
      target: '引擎仅对宠物实体反转能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    transferStatStage: {
      source: '引擎仅对宠物实体转移能力等级',
      target: '引擎仅对宠物实体转移能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    transferMark: {
      target: '引擎仅对宠物实体转移标记',
      mark: '期望标记引用或标记ID',
    },
    destroyMark: {
      target: '引擎仅对标记实体执行销毁',
    },
    executeKill: {
      target: '引擎仅对宠物实体执行处决',
    },
    addClampMaxModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addClampMinModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      minValue: '期望数值类型（下限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addClampModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      minValue: '期望数值类型（下限值）',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampMaxModifier: {
      target: '引擎仅对技能实体添加上限修正',
      attribute: '期望技能属性名称字符串',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampMinModifier: {
      target: '引擎仅对技能实体添加下限修正',
      attribute: '期望技能属性名称字符串',
      minValue: '期望数值类型（下限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampModifier: {
      target: '引擎仅对技能实体添加区间修正',
      attribute: '期望技能属性名称字符串',
      minValue: '期望数值类型（下限值）',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    setValue: {
      target: '属性引用，指向实体的可写属性路径',
    },
    addValue: {
      target: '属性引用，指向实体的可写属性路径',
      value: '期望数值类型（增加值）',
    },
    toggle: {
      target: '属性引用，指向实体的可写属性路径',
    },
  }

  const opHints = specific[opType]
  if (opHints) {
    const hint = opHints[fieldName]
    if (hint) return hint
  }

  return undefined
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
    resolveStringEnumOptions,
    getOperatorFieldHint,
  }
}
