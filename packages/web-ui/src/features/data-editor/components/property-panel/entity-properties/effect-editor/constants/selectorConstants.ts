import { BASE_EXTRACTOR_KEYS } from '@arcadia-eternity/schema'

// ── Chain step metadata (shared between SelectorBuilder and PipelineCard) ──

export interface ChainStepMeta {
  value: string
  label: string
  group: string
  description: string
}

export const CHAIN_STEP_TYPES: readonly ChainStepMeta[] = [
  {
    value: 'select',
    label: '筛选',
    group: 'extract',
    description: '从每个实体中提取指定属性（如当前生命值、怒气等）。输入为实体列表，输出为属性值列表。',
  },
  {
    value: 'selectPath',
    label: '路径选择',
    group: 'extract',
    description: '通过 JSON 路径从对象中提取嵌套值。输入为对象列表，输出为路径对应的值列表。',
  },
  {
    value: 'selectProp',
    label: '属性选择',
    group: 'extract',
    description: '通过对象属性名从每个实体中提取属性值。输入为对象列表，输出为属性值列表。',
  },
  {
    value: 'selectObservable',
    label: '可观察选择',
    group: 'extract',
    description: '从每个实体中提取可观察的运行时动态值。输入为上下文对象，输出为对应值列表。',
  },
  {
    value: 'selectAttribute$',
    label: '动态属性',
    group: 'extract',
    description: '从每个实体中提取动态属性（基于运行时状态计算）。输入为实体列表，输出为动态属性值列表。',
  },
  {
    value: 'configGet',
    label: '配置获取',
    group: 'extract',
    description: '从每个实体的配置存储中按 key 获取值。输入为含配置的对象，输出为配置值列表。',
  },
  {
    value: 'where',
    label: '条件过滤',
    group: 'filter',
    description: '按条件过滤实体列表。保留满足条件的实体，输出仍为实体列表。',
  },
  {
    value: 'whereAttr',
    label: '属性过滤',
    group: 'filter',
    description: '先提取属性值再按条件过滤实体。适用于需要通过属性值比较来筛选的场景。',
  },
  {
    value: 'flat',
    label: '展平',
    group: 'transform',
    description: '将嵌套数组展平为一维数组。',
  },
  {
    value: 'sum',
    label: '求和',
    group: 'math',
    description: '对数组中的所有数值求和，输出单个数值。',
  },
  {
    value: 'avg',
    label: '平均',
    group: 'math',
    description: '计算数组的平均值，输出单个数值。',
  },
  {
    value: 'add',
    label: '加法',
    group: 'math',
    description: '将数组中的每个数值加上指定值。',
  },
  {
    value: 'multiply',
    label: '乘法',
    group: 'math',
    description: '将数组中的每个数值乘以指定值。',
  },
  {
    value: 'divide',
    label: '除法',
    group: 'math',
    description: '将数组中的每个数值除以指定值。',
  },
  {
    value: 'shuffled',
    label: '乱序',
    group: 'transform',
    description: '随机打乱数组顺序。',
  },
  {
    value: 'asStatLevelMark',
    label: '等级标记',
    group: 'transform',
    description: '将实体标记转换为统计等级标记对象进行计数。',
  },
  {
    value: 'sampleBetween',
    label: '区间采样',
    group: 'transform',
    description: '在数组相邻元素之间进行插值采样。',
  },
  {
    value: 'and',
    label: '交集',
    group: 'set',
    description: '计算当前实体列表与另一个选择器结果的交集，输出共同的实体。',
  },
  {
    value: 'or',
    label: '并集',
    group: 'set',
    description: '计算当前实体列表与另一个选择器结果的并集，输出去重后的实体。',
  },
  {
    value: 'randomPick',
    label: '随机选取',
    group: 'random',
    description: '从数组中随机选取指定数量的元素。',
  },
  {
    value: 'randomSample',
    label: '随机采样',
    group: 'random',
    description: '从数组中随机采样指定比例的元素。',
  },
  {
    value: 'limit',
    label: '限制数量',
    group: 'limit',
    description: '限制数组长度为指定值，超过则截断前 N 个。',
  },
  {
    value: 'clampMax',
    label: '上限',
    group: 'limit',
    description: '将每个值限制在最大上限以内，超过上限的改为上限值。',
  },
  {
    value: 'clampMin',
    label: '下限',
    group: 'limit',
    description: '将每个值限制在最小下限以上，低于下限的改为下限值。',
  },
  {
    value: 'when',
    label: '条件分支',
    group: 'flow',
    description: '根据条件选择不同的值输出，类似 if/else 逻辑。',
  },
] as const

export function getChainStepMeta(type: string): ChainStepMeta | undefined {
  return CHAIN_STEP_TYPES.find(t => t.value === type)
}

// ── Extractor types ──────────────────────────────────────────────────────────

export const EXTRACTOR_TYPES = [
  { value: 'base', label: '基础' },
  { value: 'attribute', label: '属性' },
  { value: 'relation', label: '关联' },
  { value: 'field', label: '字段' },
  { value: 'dynamic', label: '动态' },
] as const

// ── Step type classification sets ────────────────────────────────────────────

export const NO_PARAM_TYPES = new Set(['flat', 'sum', 'avg', 'shuffled', 'asStatLevelMark', 'sampleBetween'])

export const TEXT_INPUT_TYPES = new Set(['selectPath', 'selectProp', 'selectObservable', 'selectAttribute$'])

export const VALUE_SLOT_TYPES = new Set([
  'randomPick',
  'randomSample',
  'limit',
  'clampMax',
  'clampMin',
  'add',
  'multiply',
  'divide',
  'configGet',
])

export const RECURSIVE_TYPES = new Set(['and', 'or'])

// ── Common option lists ──────────────────────────────────────────────────────

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
  { value: 'rageCost', label: 'rageCost (怒气消耗)' },
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
