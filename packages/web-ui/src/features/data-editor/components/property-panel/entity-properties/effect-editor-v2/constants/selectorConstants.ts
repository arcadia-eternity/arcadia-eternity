import {
  type SelectorChainStepMeta,
  type SelectorChainArgKind,
  SELECTOR_CHAIN_STEP_META,
  NO_PARAM_CHAIN_TYPES,
  TEXT_INPUT_CHAIN_TYPES,
  VALUE_SLOT_CHAIN_TYPES,
  SELECTOR_SLOT_CHAIN_TYPES,
  getChainStepMeta,
  BASE_EXTRACTOR_KEYS,
} from '@arcadia-eternity/schema'
import type { SelectorChain, ExtractorDSL } from '@arcadia-eternity/schema'

export type { SelectorChainStepMeta as ChainStepMeta, SelectorChainArgKind }
export {
  SELECTOR_CHAIN_STEP_META as CHAIN_STEP_TYPES,
  getChainStepMeta,
  NO_PARAM_CHAIN_TYPES as NO_PARAM_TYPES,
  TEXT_INPUT_CHAIN_TYPES as TEXT_INPUT_TYPES,
  VALUE_SLOT_CHAIN_TYPES as VALUE_SLOT_TYPES,
  SELECTOR_SLOT_CHAIN_TYPES as RECURSIVE_TYPES,
}

export type ExtractorType = Exclude<ExtractorDSL, string>['type']

export const EXTRACTOR_TYPES = [
  { value: 'base' as ExtractorType, label: '基础' },
  { value: 'attribute' as ExtractorType, label: '属性' },
  { value: 'relation' as ExtractorType, label: '关联' },
  { value: 'field' as ExtractorType, label: '字段' },
  { value: 'dynamic' as ExtractorType, label: '动态' },
] as const

export const BASE_EXTRACTOR_OPTIONS = BASE_EXTRACTOR_KEYS.map(k => ({ value: k, label: k }))

export const COMMON_EXTRACTOR_KEYS = [
  { value: 'hp', label: 'hp (生命值)' },
  { value: 'maxHp', label: 'maxHp (最大生命值)' },
  { value: 'attack', label: 'attack (攻击)' },
  { value: 'defense', label: 'defense (防御)' },
  { value: 'spAttack', label: 'spAttack (特攻)' },
  { value: 'spDefense', label: 'spDefense (特防)' },
  { value: 'speed', label: 'speed (速度)' },
  { value: 'level', label: 'level (等级)' },
  { value: 'type', label: 'type (类型/元素)' },
  { value: 'element', label: 'element (元素)' },
  { value: 'gender', label: 'gender (性别)' },
  { value: 'stage', label: 'stage (阶段/等级)' },
  { value: 'value', label: 'value (值)' },
  { value: 'count', label: 'count (计数)' },
  { value: 'id', label: 'id (ID)' },
  { value: 'name', label: 'name (名称)' },
  { value: 'owner', label: 'owner (所有者)' },
  { value: 'config', label: 'config (配置)' },
  { value: 'stacks', label: 'stacks (堆叠数)' },
  { value: 'duration', label: 'duration (持续时间)' },
  { value: 'power', label: 'power (威力)' },
  { value: 'priority', label: 'priority (优先级)' },
  { value: 'tags', label: 'tags (标签)' },
  { value: 'marks', label: 'marks (标记列表)' },
  { value: 'skills', label: 'skills (技能列表)' },
  { value: 'activePet', label: 'activePet (当前宠物)' },
  { value: 'rage', label: 'rage (怒气)' },
  { value: 'baseId', label: 'baseId (基础ID)' },
] as const

export const COMMON_FIELD_PATHS = [
  { value: 'hp', label: 'hp' },
  { value: 'maxHp', label: 'maxHp' },
  { value: 'attack', label: 'attack' },
  { value: 'defense', label: 'defense' },
  { value: 'stats', label: 'stats' },
  { value: 'config.value', label: 'config.value' },
  { value: 'config.stacks', label: 'config.stacks' },
  { value: 'config.duration', label: 'config.duration' },
  { value: 'config.power', label: 'config.power' },
  { value: 'stage.value', label: 'stage.value' },
  { value: 'modifiers.flat', label: 'modifiers.flat' },
  { value: 'modifiers.percent', label: 'modifiers.percent' },
] as const
