import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type { Extractor } from '../../../effectBuilder'
import type { ExtractorDSL } from '@test-battle/effect-dsl'

export abstract class BaseExtractorNode extends LGraphNode {
  // 静态属性定义选择器类型，子类需要覆盖
  static selectorType: keyof typeof Extractor
  IsBaseExtractorNode = true

  constructor() {
    super('BaseSelector')
    // 所有基础选择器节点只有一个输出端口
    this.addOutput('extractor', 'extractor')
    // 统一节点样式
    this.size = [120, 40]
    // 基础选择器统一用绿色
    this.color = '#00ff00'
  }

  toExtractorDSL(): ExtractorDSL {
    return {
      type: 'base',
      arg: (this.constructor as any).selectorType,
    }
  }

  onExecute() {
    this.setOutputData(0, (this.constructor as any).selectorType)
  }
}

// HP 提取器
export class HpExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'hp'
  constructor() {
    super()
    this.title = 'HP提取器'
  }
}

// 最大HP提取器
export class MaxHpExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'maxhp'
  constructor() {
    super()
    this.title = '最大HP提取器'
  }
}

// 怒气提取器
export class RageExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'rage'
  constructor() {
    super()
    this.title = '怒气值提取器'
  }
}

// 所有者提取器
export class OwnerExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'owner'
  constructor() {
    super()
    this.title = '所有者提取器'
    this.color = '#FFA500' // 特殊类型用不同颜色
  }
}

// 元素类型提取器
export class ElementTypeExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'type'
  constructor() {
    super()
    this.title = '元素类型提取器'
  }
}

// 标记实例提取器
export class MarksExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'marks'
  constructor() {
    super()
    this.title = '战斗标记提取器'
    this.size = [140, 40] // 长标题需要调整宽度
  }
}

// 战斗属性提取器
export class StatsExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'stats'
  constructor() {
    super()
    this.title = '战斗属性提取器'
  }
}

// 堆叠数提取器
export class StackExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'stack'
  constructor() {
    super()
    this.title = '堆叠数提取器'
  }
}

// 持续时间提取器
export class DurationExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'duration'
  constructor() {
    super()
    this.title = '持续时间提取器'
  }
}

// 技能威力提取器
export class PowerExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'power'
  constructor() {
    super()
    this.title = '技能威力提取器'
    this.color = '#FF69B4' // 特殊重要属性高亮
  }
}

// 技能优先级提取器
export class PriorityExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'priority'
  constructor() {
    super()
    this.title = '技能优先级提取器'
  }
}

// 当前出战宠物提取器
export class ActivePetExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'activePet'
  constructor() {
    super()
    this.title = '出战宠物提取器'
    this.size = [140, 40]
  }
}

// 技能列表提取器
export class SkillsExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'skills'
  constructor() {
    super()
    this.title = '技能列表提取器'
  }
}

// 实例ID提取器
export class IdExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'id'
  constructor() {
    super()
    this.title = '实例ID提取器'
  }
}

// 原型ID提取器
export class BaseIdExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'baseId'
  constructor() {
    super()
    this.title = '原型ID提取器'
  }
}

// 标记标签提取器
export class TagsExtractorNode extends BaseExtractorNode {
  static selectorType: keyof typeof Extractor = 'tags'
  constructor() {
    super()
    this.title = '标记标签提取器'
  }
}

const BASE_EXTRACTOR_MAP = {
  hp: HpExtractorNode,
  maxhp: MaxHpExtractorNode,
  rage: RageExtractorNode,
  owner: OwnerExtractorNode,
  type: ElementTypeExtractorNode,
  marks: MarksExtractorNode,
  stats: StatsExtractorNode,
  stack: StackExtractorNode,
  duration: DurationExtractorNode,
  power: PowerExtractorNode,
  priority: PriorityExtractorNode,
  activePet: ActivePetExtractorNode,
  skills: SkillsExtractorNode,
  id: IdExtractorNode,
  baseId: BaseIdExtractorNode,
  tags: TagsExtractorNode,
}

const BASE_EXTRACTOR_NODES = [
  HpExtractorNode,
  MaxHpExtractorNode,
  RageExtractorNode,
  OwnerExtractorNode,
  ElementTypeExtractorNode,
  MarksExtractorNode,
  StatsExtractorNode,
  StackExtractorNode,
  DurationExtractorNode,
  PowerExtractorNode,
  PriorityExtractorNode,
  ActivePetExtractorNode,
  SkillsExtractorNode,
  IdExtractorNode,
  BaseIdExtractorNode,
  TagsExtractorNode,
]

export function registerBaseExtractorNodes() {
  BASE_EXTRACTOR_NODES.forEach(node => {
    const nodeType = `extractor/base/${node.selectorType}`
    LiteGraph.registerNodeType(nodeType, node)
  })
}

export function createBaseExtractorNode(selectorType: keyof typeof Extractor) {
  return new BASE_EXTRACTOR_MAP[selectorType]()
}
