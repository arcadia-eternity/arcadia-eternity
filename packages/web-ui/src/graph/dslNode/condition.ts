// conditionNodes.ts
import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type { ConditionDSL, EvaluatorDSL, SelectorDSL } from '@test-battle/schema'
import { SelectStepNode } from './selectorChain'
import { CompareEvaluatorNode } from './evaluator'

/* ---------- 条件节点基类 ---------- */
abstract class BaseConditionNode extends LGraphNode {
  abstract conditionType: ConditionDSL['type']
  protected defaultColor = '#FFB6C1' // 粉色系

  constructor(title: string) {
    super(title)
    this.addOutput('condition', 'condition')
    this.color = this.defaultColor
    this.size = [160, 60]
  }

  abstract toConditionDSL(): ConditionDSL

  onExecute() {
    this.setOutputData(0, this.toConditionDSL() as any)
  }
}

/* ---------- 基础评估条件节点 ---------- */
export class EvaluateConditionNode extends BaseConditionNode {
  conditionType = 'evaluate' as const

  constructor() {
    super('基础条件')
    this.color = '#87CEFA' // 浅蓝色

    // 输入端口
    this.addInput('selector', 'selector')
    this.addInput('evaluator', 'evaluator')
  }

  toConditionDSL(): ConditionDSL {
    return {
      type: 'evaluate',
      target: (this.getInputData(0) as SelectorDSL) || { base: 'self' }, // 默认选择器
      evaluator: (this.getInputData(1) as EvaluatorDSL) || { type: 'compare', operator: '>', value: 0 }, // 默认评估器
    }
  }
}

/* ---------- 逻辑组合条件基类 ---------- */
abstract class LogicCombinationConditionNode extends BaseConditionNode {
  protected conditionSlots: number[] = []
  protected abstract logicType: 'some' | 'every'

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
    this.addWidget('button', '＋添加', 'add', () => {
      const newSlot = this.conditionSlots.length
      this.addConditionInput(newSlot)
    })

    // 移除条件按钮
    this.addWidget('button', '－移除', 'remove', () => {
      if (this.conditionSlots.length > 2) {
        const lastSlot = this.conditionSlots.pop()!
        this.removeInput(lastSlot)
      }
    })
  }

  private addConditionInput(slot: number) {
    const inputName = `condition_${slot}`
    this.addInput(inputName, 'condition')
    this.conditionSlots.push(slot)
    this.setSize([this.size[0], 60 + this.conditionSlots.length * 30])
  }

  toConditionDSL(): ConditionDSL {
    return {
      type: this.logicType,
      conditions: this.conditionSlots.map(slot => this.getInputData(slot)).filter(Boolean) as ConditionDSL[],
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

/* ---------- 任意条件成立节点 ---------- */
export class SomeConditionNode extends LogicCombinationConditionNode {
  conditionType = 'some' as const
  protected logicType = 'some' as const

  constructor() {
    super('任意条件成立')
    this.color = '#98FB98' // 浅绿色
  }
}

/* ---------- 全部条件成立节点 ---------- */
export class EveryConditionNode extends LogicCombinationConditionNode {
  conditionType = 'every' as const
  protected logicType = 'every' as const

  constructor() {
    super('全部条件成立')
    this.color = '#FFA07A' // 浅橙色
  }
}

/* ---------- 逻辑非节点 ---------- */
export class NotConditionNode extends BaseConditionNode {
  conditionType = 'not' as const

  constructor() {
    super('条件取反')
    this.color = '#DDA0DD' // 浅紫色
    this.addInput('condition', 'condition')
    this.addWidget('button', '创建条件', 'cond', () => {
      const node = new EvaluateConditionNode()
      node.connect(0, this, 0)
      this.graph?.add(node)
    })
  }

  toConditionDSL(): ConditionDSL {
    return {
      type: 'not',
      condition: this.getInputData(0) as ConditionDSL,
    }
  }
}

/* ---------- 注册节点 ---------- */
const CONDITION_NODE_TYPES = {
  evaluate: EvaluateConditionNode,
  some: SomeConditionNode,
  every: EveryConditionNode,
  not: NotConditionNode,
}

export function registerConditionNodes() {
  Object.entries(CONDITION_NODE_TYPES).forEach(([type, cls]) => {
    LiteGraph.registerNodeType(`condition/${type}`, cls)
  })
}
