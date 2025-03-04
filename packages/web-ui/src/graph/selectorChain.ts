import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type {
  SelectorChain,
  EvaluatorDSL,
  RawNumberValue,
  SelectPropDSL,
  ExtractorDSL,
  SelectPathDSL,
  SelectStepDSL,
} from '../../../effectDSL'
import { Extractor } from '../../../effectBuilder'

/* ---------- SelectorChain 链式节点基类 ---------- */
export abstract class SelectorStepNode extends LGraphNode {
  // 节点类型，对应 SelectorChain.type
  static stepType: SelectorChain['type']

  constructor() {
    super('SelectorChain')
    // 统一节点样式
    this.color = '#cc99ff' // 紫色系
    this.size = [180, 60]
    // 链式输入输出端口
    this.addInput('prev', 'selector_chain')
    this.addOutput('next', 'selector_chain')
  }

  // 构建链式步骤的 DSL 结构
  abstract buildStep(): SelectorChain

  onExecute() {
    const prevStep = this.getInputData(0) // 获取前驱步骤
    const currentStep = this.buildStep()

    // 组合链式结构
    const chain = Array.isArray(prevStep)
      ? [...prevStep, currentStep]
      : prevStep
        ? [prevStep, currentStep]
        : [currentStep]

    this.setOutputData(0, chain)
  }
}

export class SelectStepNode extends SelectorStepNode {
  static stepType = 'select' as const
  private extractorType: ExtractorDSL['type'] = 'base'
  private extractorArg: string = ''
  private dynamicExtractor?: ExtractorDSL

  constructor() {
    super()
    this.title = '选择步骤'
    this.color = '#99ccff'
    this.size = [200, 80]

    // 提取类型切换
    this.addWidget(
      'combo',
      '类型',
      'base',
      v => {
        this.extractorType = v
        this.updateUI()
      },
      {
        values: ['base', 'dynamic'],
      },
    )

    // 基础提取器参数
    this.addWidget(
      'combo',
      '提取器',
      'owner',
      v => {
        this.extractorArg = v
      },
      {
        values: Object.keys(Extractor), // 从 Extractor 枚举获取
      },
    )

    // 动态提取器输入
    this.addInput('dynamicArg', 'string')
  }

  private updateUI() {
    const isDynamic = this.extractorType === 'dynamic'
    this.widgets![1].hidden = isDynamic // 基础参数控件
    this.inputs![1].hidden = !isDynamic // 动态参数端口
  }

  buildStep(): SelectStepDSL {
    let arg: ExtractorDSL

    if (this.extractorType === 'dynamic') {
      arg = this.getInputData(1) || {
        type: 'dynamic',
        arg: this.extractorArg,
      }
    } else {
      arg = {
        type: 'base',
        arg: this.extractorArg as keyof typeof Extractor,
      }
    }

    return {
      type: 'select',
      arg,
    }
  }
}

/* ---------- SelectPath 节点 ---------- */
export class SelectPathNode extends SelectorStepNode {
  static override stepType = 'selectPath' as const
  private path: string = ''

  constructor() {
    super()
    this.title = '路径选择'
    this.color = '#99ffcc'
    this.size = [220, 60]

    // 路径输入控件
    this.addWidget(
      'text',
      '路径表达式',
      'marks.poison.targets',
      v => {
        this.path = v
      },
      {
        placeholder: '例如：marks.poison.targets',
      },
    )

    // 动态路径输入
    this.addInput('dynamicPath', 'string')
  }

  buildStep(): SelectPathDSL {
    const arg = this.getInputData(1) || this.path
    return {
      type: 'selectPath',
      arg: String(arg),
    }
  }
}

/* ---------- SelectProp 节点 ---------- */
export class SelectPropNode extends SelectorStepNode {
  static override stepType = 'selectProp' as const
  private propName: string = 'hp'

  constructor() {
    super()
    this.title = '属性选择'
    this.color = '#ffcc99'
    this.size = [200, 60]

    // 属性名输入
    this.addWidget(
      'combo',
      '属性',
      'hp',
      v => {
        this.propName = v
      },
      {
        values: ['hp', 'atk', 'def', 'spd'],
        allow_any: true, // 允许自定义输入
      },
    )

    // 动态属性输入
    this.addInput('dynamicProp', 'string')
  }

  buildStep(): SelectPropDSL {
    const arg = this.getInputData(1) || this.propName
    return {
      type: 'selectProp',
      arg: String(arg),
    }
  }
}

/* ---------- 条件筛选类节点 ---------- */

// Where 条件节点
export class WhereNode extends SelectorStepNode {
  static stepType = 'where' as const
  private condition: EvaluatorDSL = {
    type: 'compare',
    operator: '>',
    target: 'hp',
    value: { type: 'raw:number', value: 50 },
  }

  constructor() {
    super()
    this.title = '条件筛选'
    this.addInput('condition', 'evaluator') // 连接条件节点
    this.addWidget('combo', '属性', 'hp', v => (this.condition.target = v), {
      values: ['hp', 'atk', 'def'],
    })
    this.addWidget('combo', '比较符', '>', v => (this.condition.operator = v), {
      values: ['>', '<', '==', '!='],
    })
    this.addWidget('number', '值', 50, v => {
      ;(this.condition.value as RawNumberValue).value = v
    })
  }

  buildStep(): SelectorChain {
    // 优先使用外部连接的条件
    const externalCond = this.getInputData(1)
    return {
      type: 'where',
      arg: externalCond || this.condition,
    }
  }
}

// 属性条件节点
export class WhereAttrNode extends SelectorStepNode {
  static stepType = 'whereAttr' as const

  constructor() {
    super()
    this.title = '属性条件'
    this.addInput('extractor', 'extractor')
    this.addInput('condition', 'evaluator')
  }

  buildStep(): SelectorChain {
    return {
      type: 'whereAttr',
      extractor: this.getInputData(1),
      condition: this.getInputData(2),
    }
  }
}

/* ---------- 逻辑组合节点 ---------- */

// 与操作节点
export class AndNode extends SelectorStepNode {
  static stepType = 'and' as const

  constructor() {
    super()
    this.title = '与组合'
    this.addInput('selector', 'selector')
  }

  buildStep(): SelectorChain {
    return {
      type: 'and',
      arg: this.getInputData(1),
    }
  }
}

// 或操作节点
export class OrNode extends SelectorStepNode {
  static stepType = 'or' as const
  duplicate = false

  constructor() {
    super()
    this.title = '或组合'
    this.addInput('selector', 'selector')
    this.addWidget('toggle', '允许重复', false, v => (this.duplicate = v))
  }

  buildStep(): SelectorChain {
    return {
      type: 'or',
      arg: this.getInputData(1),
      duplicate: this.duplicate,
    }
  }
}

/* ---------- 数学运算节点 ---------- */

// 加法节点
export class AddNode extends SelectorStepNode {
  static stepType = 'add' as const
  private valueType: 'number' | 'selector' = 'number'
  private numberValue = 0

  constructor() {
    super()
    this.title = '数值加法'
    this.addInput('value', 'number|selector')
    this.addWidget(
      'combo',
      '类型',
      'number',
      v => {
        this.valueType = v
        this.updateUI()
      },
      { values: ['number', 'selector'] },
    )
    this.addWidget('number', '加数', 0, v => (this.numberValue = v))
  }

  private updateUI() {
    const widget = this.widgets?.find(w => w.name === '加数')
    if (widget) {
      widget.disabled = this.valueType !== 'number'
    }
  }

  buildStep(): SelectorChain {
    const arg = this.valueType === 'number' ? this.numberValue : this.getInputData(1)

    return { type: 'add', arg }
  }
}

// 乘法节点（类似加法实现）
export class MultiplyNode extends SelectorStepNode {
  static stepType = 'multiply' as const
  private valueType: 'number' | 'selector' = 'number'
  private numberValue = 0
  constructor() {
    super()
    this.title = '数值乘法'
    this.addInput('value', 'number|selector')
    this.addWidget(
      'combo',
      '类型',
      'number',
      v => {
        this.valueType = v
        this.updateUI()
      },
      { values: ['number', 'selector'] },
    )
    this.addWidget('number', '乘数', 0, v => (this.numberValue = v))
  }
  private updateUI() {
    const widget = this.widgets?.find(w => w.name === '乘数')
    if (widget) {
      widget.disabled = this.valueType !== 'number'
    }
  }
  buildStep(): SelectorChain {
    const arg = this.valueType === 'number' ? this.numberValue : this.getInputData(1)
    return { type: 'multiply', arg }
  }
}

// 除法节点（类似加法实现）
export class DivideNode extends SelectorStepNode {
  static stepType = 'divide' as const
  private valueType: 'number' | 'selector' = 'number'
  private numberValue = 0
  constructor() {
    super()
    this.title = '数值除法'
    this.addInput('value', 'number|selector')
    this.addWidget(
      'combo',
      '类型',
      'number',
      v => {
        this.valueType = v
        this.updateUI()
      },
      { values: ['number', 'selector'] },
    )
    this.addWidget('number', '除数', 0, v => (this.numberValue = v))
  }
  private updateUI() {
    const widget = this.widgets?.find(w => w.name === '除数')
    if (widget) {
      widget.disabled = this.valueType !== 'number'
    }
  }
  buildStep(): SelectorChain {
    const arg = this.valueType === 'number' ? this.numberValue : this.getInputData(1)
    return { type: 'divide', arg }
  }
}

/* ---------- 随机操作节点 ---------- */

// 随机选取节点
export class RandomPickNode extends SelectorStepNode {
  static stepType = 'randomPick' as const
  private count = 1

  constructor() {
    super()
    this.title = '随机选取'
    this.addWidget('number', '数量', 1, v => (this.count = v))
  }

  buildStep(): SelectorChain {
    return { type: 'randomPick', arg: this.count }
  }
}

// 概率采样节点
export class RandomSampleNode extends SelectorStepNode {
  static stepType = 'randomSample' as const
  private percent = 50

  constructor() {
    super()
    this.title = '概率筛选'
    this.addWidget('slider', '概率%', 50, v => (this.percent = v), {
      min: 0,
      max: 100,
    })
  }

  buildStep(): SelectorChain {
    return { type: 'randomSample', arg: this.percent }
  }
}

/* ---------- 其他操作节点 ---------- */

// 乱序节点
export class ShuffledNode extends SelectorStepNode {
  static stepType = 'shuffled' as const

  constructor() {
    super()
    this.title = '乱序排列'
    // 无参数，直接输出
  }

  buildStep(): SelectorChain {
    return { type: 'shuffled' }
  }
}

// 数值求和节点
export class SumNode extends SelectorStepNode {
  static stepType = 'sum' as const

  constructor() {
    super()
    this.title = '数值求和'
  }

  buildStep(): SelectorChain {
    return { type: 'sum' }
  }
}

export class ClampMaxNode extends SelectorStepNode {
  static stepType = 'clampMax' as const
  private max = 10
  constructor() {
    super()
    this.title = '数值上限'
    this.addWidget('number', '上限', 10, v => (this.max = v))
  }
  buildStep(): SelectorChain {
    return { type: 'clampMax', arg: this.max }
  }
}

export class ClampMinNode extends SelectorStepNode {
  static stepType = 'clampMin' as const
  private min = 10
  constructor() {
    super()
    this.title = '数值下限'
    this.addWidget('number', '下限', 10, v => (this.min = v))
  }
  buildStep(): SelectorChain {
    return { type: 'clampMin', arg: this.min }
  }
}

/* ---------- 注册节点 ---------- */
const SELECTOR_CHAIN_NODES = [
  SelectStepNode,
  SelectPathNode,
  SelectPropNode,
  WhereNode,
  WhereAttrNode,
  AndNode,
  OrNode,
  AddNode,
  MultiplyNode,
  DivideNode,
  RandomPickNode,
  RandomSampleNode,
  ShuffledNode,
  SumNode,
  ClampMaxNode,
  ClampMinNode,
]

export function registerSelectorChainNodes() {
  SELECTOR_CHAIN_NODES.forEach(nodeClass => {
    const typeName = `selector/chain/${nodeClass.stepType}`
    LiteGraph.registerNodeType(typeName, nodeClass)
  })
}
