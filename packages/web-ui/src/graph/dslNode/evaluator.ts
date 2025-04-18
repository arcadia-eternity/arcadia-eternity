// evaluator.ts
import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import { BaseGetVariableNode } from './BaseGetVariableNode'
import type { EvaluatorDSL, Value, CompareOperator } from '@arcadia-eternity/schema'

/* ---------- Evaluator 基类 ---------- */
abstract class BaseEvaluatorNode extends BaseGetVariableNode {
  abstract evaluatorType: EvaluatorDSL['type']

  constructor(title: string) {
    super(title)
    this.addWidget('button', 'debug', 'debug', () => {
      console.log(this.toEvaluatorDSL())
    })
    this.addOutput('evaluator', 'evaluator')
    this.color = '#ffd700' // 统一使用金色系
    this.size = [200, 80]
  }

  // 公共方法
  abstract toEvaluatorDSL(): EvaluatorDSL

  onExecute() {
    this.setOutputData(0, this.toEvaluatorDSL())
  }
}

/* ---------- 比较评估器节点 ---------- */
export class CompareEvaluatorNode extends BaseEvaluatorNode {
  title: string = '比较条件'
  evaluatorType = 'compare' as const

  constructor() {
    super('比较条件')

    // 操作符选择
    this.addWidget(
      'combo',
      '操作符',
      '>',
      (v: CompareOperator) => {
        this.properties.operator = v
      },
      {
        values: ['>', '<', '>=', '<=', '=='],
      },
    )

    // 比较值输入
    this.addInput('value', 'selector')
    this.addWidget(
      'number',
      '比较值',
      0,
      (v: number) => {
        this.properties.value = v
      },
      {
        associatedInput: 'value',
        property: 'compareValue',
      },
    )
    this.properties = {
      operator: '>',
      value: 0,
    }
  }

  toEvaluatorDSL(): EvaluatorDSL {
    return {
      type: 'compare',
      operator: this.properties.operator as CompareOperator,
      value: this.getNumberValue(0, this.properties.compareValue as number),
    }
  }
}

export class SameEvaluatorNode extends BaseEvaluatorNode {
  title: string = '相同条件'
  evaluatorType = 'same' as const

  constructor() {
    super('相同条件')

    // 比较值输入
    this.addInput('value', 'selector')
    this.addWidget(
      'combo',
      '类型',
      'number',
      (v: 'number' | 'string' | 'boolean') => {
        this.properties.compareType = v
      },
      {
        values: ['number', 'string', 'boolean'],
        property: 'compareType',
      },
    )
    this.addWidget(
      'string',
      '比较值',
      0,
      (v: number | string | boolean) => {
        this.properties.value = v
      },
      {
        associatedInput: 'value',
        property: 'compareValue',
      },
    )
    this.properties = {
      compareType: 'number',
      value: 0,
    }
  }

  toEvaluatorDSL(): EvaluatorDSL {
    return {
      type: 'same',
      value: this.getFixedValue(0, this.properties.compareType as string),
    }
  }
}

/* ---------- 概率评估器节点 ---------- */
export class ProbabilityEvaluatorNode extends BaseEvaluatorNode {
  title: string = '概率条件'
  evaluatorType = 'probability' as const

  constructor() {
    super('概率条件')

    // 百分比输入
    this.addInput('percent', 'selector')
    this.addWidget(
      'number',
      '概率%',
      50,
      (v: number) => {
        this.properties.percent = v
      },
      {
        min: 0,
        max: 100,
        associatedInput: 'percent',
        property: 'percent',
      },
    )
    this.properties = {
      percent: 50,
    }
  }

  toEvaluatorDSL(): EvaluatorDSL {
    return {
      type: 'probability',
      percent: this.getNumberValue(0, this.properties.percent as number),
    }
  }
}

abstract class LogicCombinationEvaluatorNode extends BaseEvaluatorNode {
  protected abstract logicType: 'any' | 'all'
  private conditionSlots: number[] = []

  constructor(title: string) {
    super(title)
    this.initInputs()
    this.addControlButtons()
  }

  private initInputs() {
    // 初始两个条件输入
    this.addConditionInput(0)
    this.addConditionInput(1)
  }

  private addControlButtons() {
    // 添加条件按钮
    this.addWidget('button', '＋添加条件', 'add', () => {
      const newSlot = this.conditionSlots.length
      this.addConditionInput(newSlot)
    })

    // 移除条件按钮
    this.addWidget('button', '－移除条件', 'remove', () => {
      if (this.conditionSlots.length > 2) {
        const lastSlot = this.conditionSlots.pop()!
        this.removeInput(lastSlot)
      }
    })
  }

  private addConditionInput(slot: number) {
    const inputName = `condition_${slot}`
    this.addInput(inputName, 'evaluator')
    this.conditionSlots.push(slot)
    this.setSize([this.size[0], 80 + this.conditionSlots.length * 40])
  }

  toEvaluatorDSL(): EvaluatorDSL {
    return {
      type: this.logicType,
      conditions: this.conditionSlots.map(slot => this.getInputData(slot) as EvaluatorDSL).filter(Boolean),
    }
  }

  onConfigure(info: any) {
    // 重建输入端口
    const conditionCount = info.conditionSlots?.length || 2
    this.conditionSlots = []
    for (let i = 0; i < conditionCount; i++) {
      this.addConditionInput(i)
    }
  }

  onSerialize(info: any) {
    info.conditionSlots = this.conditionSlots
  }
}

/* ---------- 任意条件节点 ---------- */
export class AnyEvaluatorNode extends LogicCombinationEvaluatorNode {
  evaluatorType = 'any' as const
  title: string = '任意条件成立'
  protected logicType = 'any' as const
  constructor() {
    super('任意条件成立')
    this.color = '#ff9999' // 红色系
  }
}

/* ---------- 全部条件节点 ---------- */
export class AllEvaluatorNode extends LogicCombinationEvaluatorNode {
  evaluatorType = 'all' as const
  title: string = '全部条件成立'
  protected logicType = 'all' as const
  constructor() {
    super('全部条件成立')
    this.color = '#99ff99' // 绿色系
  }
}

// 注册节点类型
export const EVALUATOR_NODE_TYPES = {
  compare: CompareEvaluatorNode,
  probability: ProbabilityEvaluatorNode,
  any: AnyEvaluatorNode,
  all: AllEvaluatorNode,
  same: SameEvaluatorNode,
}

export function registerEvaluatorNodes() {
  Object.entries(EVALUATOR_NODE_TYPES).forEach(([type, cls]) => {
    LiteGraph.registerNodeType(`evaluator/${type}`, cls)
  })
}
