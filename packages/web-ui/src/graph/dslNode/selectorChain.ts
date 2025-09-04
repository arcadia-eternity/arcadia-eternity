import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type {
  SelectorChain,
  EvaluatorDSL,
  RawNumberValue,
  SelectPropDSL,
  ExtractorDSL,
  SelectPathDSL,
  SelectStepDSL,
  SelectorDSL,
  ChainSelector,
} from '@arcadia-eternity/schema'
import { BaseGetVariableNode } from './BaseGetVariableNode'
import { CompareEvaluatorNode } from './evaluator'

/* ---------- SelectorChain 链式节点基类 ---------- */
export abstract class SelectorStepNode extends BaseGetVariableNode {
  // 节点类型，对应 SelectorChain.type
  title: string = ''
  static steptype: selectorValueChain['type']

  constructor() {
    super('SelectorChain')
    // 统一节点样式
    this.color = '#cc99ff' // 紫色系
    this.size = [180, 60]
    // 链式输入输出端口
    this.addWidget('button', 'debug', 'debug', () => {
      console.log(this.buildStep())
    })
    this.addInput('prev', 'selector')
    this.addOutput('next', 'selector')
  }

  // 构建链式步骤的 DSL 结构
  abstract buildStep(): SelectorChain

  onSerialize(info: any) {}

  onConfigure(info: any) {}

  onExecute() {
    if (!this.getInputData(0)) {
      return
    }
    const prevDSL = this.getInputData(0) as ChainSelector
    const currentStep = this.buildStep()

    const newDsl = {
      base: prevDSL.base,
      chain: prevDSL.chain ? [...prevDSL.chain, currentStep] : [currentStep],
    }
    this.setOutputData(0, newDsl as any)
  }
}

/* ---------- 改造后的 SelectStep 节点 ---------- */
export class SelectStepNode extends SelectorStepNode {
  static stepType = 'select' as const
  title = '选择步骤'

  constructor() {
    super()
    this.color = '#99ccff'
    this.size = [200, 60]

    // 提取器输入端口
    this.addInput('extractor', 'extractor')
  }

  buildStep(): SelectStepDSL {
    const extractor = this.getInputData(1) as ExtractorDSL | undefined
    return {
      type: 'select',
      arg: extractor,
    }
  }
}

/* ---------- 改造后的 SelectPath 节点 ---------- */
export class SelectPathNode extends SelectorStepNode {
  static stepType = 'selectPath' as const
  title = '路径选择'

  constructor() {
    super()
    this.color = '#99ffcc'
    this.size = [220, 60]

    // 路径输入支持动态或静态
    this.addInput('path', 'string|extractor')
    this.addWidget(
      'text',
      '路径',
      '',
      v => {
        this.properties.staticPath = v
      },
      { associatedInput: 'path' },
    )
  }

  buildStep(): SelectPathDSL {
    const path = this.getInputOrProperty('path')
    return {
      type: 'selectPath',
      arg: path.toString(),
    }
  }

  getInputOrProperty(name: string): string | number {
    const input = this.getInputData(1)
    return input !== undefined ? input : this.properties[name] || ''
  }
}

/* ---------- 改造后的 SelectProp 节点 ---------- */
export class SelectPropNode extends SelectorStepNode {
  static stepType = 'selectProp' as const
  title = '属性选择'

  constructor() {
    super()
    this.color = '#ffcc99'
    this.size = [200, 60]

    // 属性输入支持动态或静态
    this.addInput('prop', 'string|extractor')
    this.addWidget(
      'combo',
      '属性',
      'hp',
      v => {
        this.properties.staticProp = v
      },
      {
        values: ['hp', 'atk', 'def'],
        associatedInput: 'prop',
      },
    )
  }

  buildStep(): SelectPropDSL {
    const prop = this.getInputOrProperty('prop')
    return {
      type: 'selectProp',
      arg: prop.toString(),
    }
  }
}

/* ---------- 改造后的 Where 条件节点 ---------- */
export class WhereNode extends SelectorStepNode {
  static stepType = 'where' as const
  title = '条件筛选'

  constructor() {
    super()
    this.color = '#ff9999'
    this.size = [240, 80]

    // 评估器输入
    this.addInput('evaluator', 'evaluator')
    this.addWidget('button', '创建条件', 'new', () => {
      this.createConditionEvaluator()
    })
  }

  private createConditionEvaluator() {
    const evaluator = new CompareEvaluatorNode()
    evaluator.connect(0, this, 0)
    this.graph.add(evaluator)
  }

  buildStep(): SelectorChain {
    const condition = this.getInputData(1) as EvaluatorDSL | undefined
    return condition
      ? {
          type: 'where',
          arg: condition,
        }
      : { type: 'where', arg: { type: 'compare', operator: '>', value: 0 } }
  }
}

/* ---------- 改造后的 WhereAttr 节点 ---------- */
export class WhereAttrNode extends SelectorStepNode {
  static stepType = 'whereAttr' as const
  title = '属性条件'

  constructor() {
    super()
    this.color = '#ff6666'
    this.size = [280, 100]

    // 双输入配置
    this.addInput('extractor', 'extractor')
    this.addInput('evaluator', 'evaluator')
  }

  buildStep(): SelectorChain {
    return {
      type: 'whereAttr',
      extractor: this.getInputData(1) || { type: 'base', arg: 'hp' },
      evaluator: this.getInputData(2) || { type: 'compare', operator: '>', value: 0 },
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

  onSerialize(info: any): void {
    // 无需保存参数
  }

  onConfigure(info: any): void {
    // 无需加载参数
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

  onSerialize(info: any): void {
    // 无需保存参数
  }

  onConfigure(info: any): void {
    // 无需加载参数
  }

  buildStep(): SelectorChain {
    return {
      type: 'or',
      arg: this.getInputData(1),
      duplicate: this.duplicate,
    }
  }
}

abstract class MathOperationNode extends SelectorStepNode {
  title: string
  protected stepType: string
  protected operationName: string

  constructor(title: string, stepType: string, operationName: string) {
    super()
    this.title = title
    this.stepType = stepType
    this.operationName = operationName

    // 公共初始化逻辑
    this.addInput('value', 'selector')
    this.addWidget(
      'number',
      operationName, // 使用构造函数参数而非抽象属性
      0,
      v => (this.properties.numberValue = v),
      { property: 'numberValue', associatedInput: 'value' },
    )
  }

  // 保留公共方法
  onSerialize(info: any): void {
    info.properties = this.properties
  }

  onConfigure(info: any): void {
    this.properties = info.properties
  }

  buildStep(): SelectorChain {
    return {
      type: this.stepType as any,
      arg: this.getNumberValue(1, 0),
    }
  }
}

// 加法节点
export class AddNode extends MathOperationNode {
  static stepType = 'add' as const
  constructor() {
    super('数值加法', AddNode.stepType, '加数')
  }
}

// 乘法节点
export class MultiplyNode extends MathOperationNode {
  static stepType = 'multiply' as const
  constructor() {
    super('数值乘法', MultiplyNode.stepType, '乘数')
  }
}

// 除法节点
export class DivideNode extends MathOperationNode {
  static stepType = 'divide' as const
  constructor() {
    super('数值除法', DivideNode.stepType, '除数')
  }
}

/* ---------- 随机操作节点 ---------- */

// 随机选取节点
export class RandomPickNode extends SelectorStepNode {
  static stepType = 'randomPick' as const

  constructor() {
    super()
    this.title = '随机选取'
    this.addInput('value', 'selector')
    this.addWidget('number', '数量', 1, v => (this.properties.count = v), {
      property: 'count',
      associatedInput: 'value',
    })
    this.properties.count = 1
  }

  buildStep(): SelectorChain {
    return { type: 'randomPick', arg: this.getNumberValue(1, 1) }
  }
}

// 概率采样节点
export class RandomSampleNode extends SelectorStepNode {
  static stepType = 'randomSample' as const

  constructor() {
    super()
    this.title = '概率筛选'
    this.addInput('value', 'selector')
    this.addWidget('slider', '概率%', 50, v => (this.properties.percent = v), {
      min: 0,
      max: 100,
      property: 'percent',
      associatedInput: 'value',
    })
    this.properties.percent = 50
  }

  buildStep(): SelectorChain {
    return { type: 'randomSample', arg: this.getNumberValue(1, 50) }
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

  onSerialize(info: any): void {
    // 无需保存参数
  }

  onConfigure(info: any): void {
    // 无需加载参数
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

  onSerialize(info: any): void {
    // 无需保存参数
  }

  onConfigure(info: any): void {
    // 无需加载参数
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
    this.addInput('value', 'selector')
    this.addWidget('number', '上限', 10, v => (this.properties.max = v), {
      property: 'max',
      associatedInput: 'value',
    })
    this.properties.max = 10
  }

  buildStep(): SelectorChain {
    return { type: 'clampMax', arg: this.getNumberValue(1, 10) }
  }
}

export class ClampMinNode extends SelectorStepNode {
  static stepType = 'clampMin' as const
  private min = 10
  constructor() {
    super()
    this.title = '数值下限'
    this.addInput('value', 'selector')
    this.addWidget('number', '下限', 10, v => (this.properties.min = v), {
      property: 'min',
      associatedInput: 'value',
    })
    this.properties.min = 10
  }

  buildStep(): SelectorChain {
    return { type: 'clampMin', arg: this.getNumberValue(1, 10) }
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
