import { EffectTrigger } from '@test-battle/const'
import type { Effect } from '@test-battle/schema'
import { EffectSchema } from '@test-battle/schema/effect'
import {
  LGraph,
  LGraphCanvas,
  LGraphNode,
  LiteGraph,
  type INodeInputSlot,
  type INodeOutputSlot,
} from '@comfyorg/litegraph'
import {
  valueSchema,
  type BaseSelector,
  type ConditionDSL,
  type OperatorDSL,
  type SelectorChain,
  type SelectorDSL,
} from '../../../effectDSL'
import { number } from 'zod'

export function createEditor(container: HTMLCanvasElement) {
  // 创建图表和画布
  const graph = new LGraph()
  const canvas = new LGraphCanvas(container, graph)
}

const TRIGGER_OPTIONS = Object.values(EffectTrigger).map(value => ({
  value,
  text: value,
}))

export class EffectNode extends LGraphNode {
  // 节点属性配置
  properties = {
    id: '',
    trigger: EffectTrigger.BeforeAttack,
    priority: 0,
    allowConsumesStacks: false,
    consumesStacks: undefined as number | undefined,
  }

  constructor() {
    super('Effect')
    this.size = [300, 200]
    this.title = '效果'

    // ID - 文本输入
    this.addWidget('text', '效果ID', 'effect_1', (value: string) => (this.properties.id = value), {})

    // 触发条件 - 下拉菜单
    this.addWidget(
      'combo',
      '触发时机',
      TRIGGER_OPTIONS[0].value,
      (value: EffectTrigger) => (this.properties.trigger = value),
      {
        values: TRIGGER_OPTIONS.map(opt => opt.value),
      },
    )

    this.addWidget('number', '优先级', 0, (value: number) => (this.properties.priority = value), {
      min: -10,
      max: 10,
    })

    this.addWidget(
      'toggle',
      '是否消耗层数',
      false,
      (value: boolean) => {
        if (value) {
          this.properties.consumesStacks = 1
        } else {
          this.properties.consumesStacks = undefined
        }
        this.properties.allowConsumesStacks = value
        const widget = this.widgets.find(w => w.name === '消耗层数')
        if (widget) {
          widget.disabled = !value
        }
      },
      {},
    )

    // 消耗层数 - 带可选的数字输入
    const consumesStacksWidget = this.addWidget(
      'number',
      '消耗层数',
      0,
      (value: number) => (this.properties.consumesStacks = this.properties.consumesStacks ? value : undefined),
      {
        min: 0,
        max: 999,
        optional: true,
        slider_color: this.properties.allowConsumesStacks ? '#000' : '#ccc',
        read_only: !this.properties.allowConsumesStacks,
      },
    )
    if (!this.properties.allowConsumesStacks) {
      consumesStacksWidget.disabled = true
    }

    // 输入输出端口
    this.addOutput('apply', 'operator')
    this.addInput('condition', 'condition')

    this.properties = {
      id: this.id as string,
      trigger: TRIGGER_OPTIONS[0].value,
      priority: 0,
      allowConsumesStacks: false,
      consumesStacks: undefined,
    }
  }

  onConnectInput(
    this: LGraphNode,
    target_slot: number,
    type: unknown,
    output: INodeOutputSlot,
    node: LGraphNode,
    slot: number,
  ): boolean {
    //如果对应的输入端口已经有连接，则拒绝新的连接
    if (this.inputs[slot].link !== null) {
      ElMessage.error('该输入端口已经有连接')
      return false
      //拒绝重复的链接
    } else if (node.id === this.id) {
      return false
    }
    return true
  }

  onConnectOutput(
    this: LGraphNode,
    slot: number,
    type: unknown,
    input: INodeInputSlot,
    node: LGraphNode,
    target_slot: number,
  ): boolean {
    //如果对应的输出端口已经有连接，则拒绝新的连接
    if (this.outputs[slot].links && this.outputs[slot].links.length > 0) {
      ElMessage.error('该输出端口已经有连接')
      return false
      //拒绝重复的链接
    } else if (node.id === this.id) {
      return false
    }
    return true
  }

  // 数据验证（使用 Zod）
  validate() {
    const result = EffectSchema.safeParse(this.toDSL())
    return result.success ? null : result.error
  }

  // 导出为 EffectDSL 结构
  toDSL(): Effect {
    return {
      id: this.properties.id,
      trigger: this.properties.trigger,
      priority: this.properties.priority,
      apply: this.getOutputData(0) as OperatorDSL, // 递归获取连接的 Operator 节点数据
      condition: this.getInputData(0) as ConditionDSL, // 递归获取 Condition 节点数据
      consumesStacks: this.properties.consumesStacks,
    }
  }

  // 从 DSL 数据加载
  fromDSL(dsl: Effect) {
    this.properties.id = dsl.id
    this.properties.trigger = dsl.trigger
    this.properties.priority = dsl.priority
    this.properties.consumesStacks = dsl.consumesStacks

    // 重建连接关系（需实现 connectOperator 和 connectCondition）
    if (dsl.apply) this.connectOperator(dsl.apply)
    if (dsl.condition) this.connectCondition(dsl.condition)
  }

  // 私有方法：连接 Apply 操作节点
  private connectOperator(operatorDSL: OperatorDSL) {
    const node = createOperatorNode(operatorDSL.type) // 根据类型创建对应节点
    this.graph.add(node)
    this.connect('apply', node, 'input')
    node.fromDSL(operatorDSL) // 假设 Operator 节点实现了 fromDSL
  }

  private connectCondition(conditionDSL: ConditionDSL) {
    const node = createConditionNode(conditionDSL) // 根据类型创建对应节点
    this.graph.add(node)
    this.connect('condition', node, 'input')
    node.fromDSL(conditionDSL) // 假设 Condition 节点实现了 fromDSL
  }
}

LiteGraph.registerNodeType('effect/Effect', EffectNode)

abstract class BaseOperatorNode extends LGraphNode {
  static operatorType: OperatorDSL['type']
  abstract title: string
  abstract color: string

  constructor(title: string) {
    super(title)
    this.size = [240, 120]
    this.addInput('apply', 'operator')
    this.addOutput('target', 'selector')
  }

  onConnectInput(
    this: LGraphNode,
    target_slot: number,
    type: unknown,
    output: INodeOutputSlot,
    node: LGraphNode,
    slot: number,
  ): boolean {
    //如果已经有一个连接，则不允许再连接
    if (this.inputs[slot].link !== null) {
      ElMessage.error('该输入端口已经有连接')
      return false
    }
    return true
  }

  onConnectOutput(
    this: LGraphNode,
    target_slot: number,
    type: unknown,
    input: INodeInputSlot,
    node: LGraphNode,
    slot: number,
  ): boolean {
    if (this.outputs[slot].links && this.outputs[slot].links.length > 0) {
      ElMessage.error('该输出端口已经有连接')
      return false
    }
    return true
  }

  // 公共属性处理
  toDSL(): OperatorDSL {
    return {
      type: this.operatorType,
      target: this.getInputData(0) as SelectorDSL,
      ...this.getSpecificProperties(),
    } as OperatorDSL
  }

  protected abstract getSpecificProperties(): Partial<OperatorDSL>
}

// 造成伤害节点
export class DealDamageNode extends BaseOperatorNode {
  static operatorType = 'dealDamage' as const
  title = '造成伤害'
  color = '#ff6666'

  constructor() {
    super('造成伤害')
    const valueWidget = this.addWidget('number', '伤害值', 100, null, { property: 'value' })
    this.addInput('value', 'number|dynamic', valueWidget)
  }

  protected getSpecificProperties() {
    return {
      value: this.properties.value,
    }
  }
}

// 治疗节点
export class HealNode extends BaseOperatorNode {
  static operatorType = 'heal' as const
  title = '治疗'
  color = '#66ff66'

  constructor() {
    super('治疗')
    const valueWidget = this.addWidget('number', '治疗量', 100, null, { property: 'value' })
    this.addInput('value', 'number|dynamic', valueWidget)
  }

  protected getSpecificProperties() {
    return {
      value: this.properties.value,
    }
  }
}

// 添加标记节点
export class AddMarkNode extends BaseOperatorNode {
  static operatorType = 'addMark' as const
  title = '添加标记'
  color = '#ffcc00'

  constructor() {
    super('添加标记')
    this.addWidget('number', '持续时间', 3, null, { property: 'duration' })
    this.addWidget('text', '标记ID', 'mark_1', null, { property: 'mark' })
    this.addWidget('number', '持续时间', 3, null, { property: 'duration' })
  }

  protected getSpecificProperties() {
    return {
      mark: this.properties.mark,
      duration: this.properties.duration,
    }
  }
}

// 层数操作节点基类
abstract class StackOperatorNode extends BaseOperatorNode {
  constructor(title: string, color: string) {
    super(title)
    this.addInput('value', 'number')
    this.addWidget('number', '数量', 1, null, { property: 'value' })
  }
}

export class AddStacksNode extends StackOperatorNode {
  static operatorType = 'addStacks' as const
  title = '添加层数'
  color = '#66ccff'
  constructor() {
    super('添加层数', '#66ccff')
  }
  protected getSpecificProperties() {
    return {}
  }
}

export class ConsumeStacksNode extends StackOperatorNode {
  static operatorType = 'consumeStacks' as const
  title = '消耗层数'
  color = '#ff9966'
  constructor() {
    super('消耗层数', '#ff9966')
  }
  protected getSpecificProperties() {
    return {}
  }
}

// 属性修改节点
export class ModifyStatNode extends BaseOperatorNode {
  static operatorType = 'modifyStat' as const
  title = '属性调整'
  color = '#cc99ff'

  constructor() {
    super('属性调整')

    const statTypeWidget = this.addWidget('combo', '属性类型', 'ATK', null, {
      values: ['ATK', 'DEF', 'SPD'],
    })
    const valueWidget = this.addWidget('number', '调整值', 10, v => (this.properties.value = v))
    const percentWidget = this.addWidget('number', '百分比', 10, v => (this.properties.percent = v))
    this.addInput('statType', 'statType', statTypeWidget)
    this.addInput('value', 'number|dynamic', valueWidget)
    this.addInput('percent', 'boolean', percentWidget)
  }

  protected getSpecificProperties() {
    return {
      statType: this.properties.statType,
      value: this.properties.value,
      percent: this.properties.percent,
    }
  }
}

// 状态阶段增益节点
export class StatStageBuffNode extends BaseOperatorNode {
  static operatorType = 'statStageBuff' as const
  title = '状态增益'
  color = '#99ff99'

  constructor() {
    super('状态增益')
    const statTypeWidget = this.addWidget('combo', '属性类型', 'ATK', v => (this.properties.statType = v), {
      values: ['ATK', 'DEF', 'SPD'],
    })
    const statBuffLevelWidget = this.addWidget('slider', '增益等级', 1, v => (this.properties.value = v), {
      min: -6,
      max: 6,
      step: 1,
    })
    this.addInput('statType', 'statType', statTypeWidget)
    this.addInput('value', 'number', statBuffLevelWidget)
  }

  protected getSpecificProperties() {
    return {
      statType: this.properties.statType,
      value: this.properties.value,
    }
  }
}

// 资源操作节点基类
abstract class ResourceOperatorNode extends BaseOperatorNode {
  title = '资源操作'
  color = '#9999ff'
  constructor(title: string, color: string) {
    super(title)
    this.addInput('value', 'number|dynamic')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v))
  }
}

export class AddRageNode extends ResourceOperatorNode {
  static operatorType = 'addRage' as const
  constructor() {
    super('增加怒气', '#ff6666')
    const valueWidget = this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: -100,
      max: 100,
      step: 10,
    })
    this.addInput('value', 'number', valueWidget)
  }
  protected getSpecificProperties() {
    return { value: this.properties.value }
  }
}

export class AmplifyPowerNode extends ResourceOperatorNode {
  static operatorType = 'amplifyPower' as const
  constructor() {
    super('强化威力', '#ff66ff')
    const valueWidget = this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: 0,
      max: 114514,
      step: 10,
    })
    this.addInput('value', 'number', valueWidget)
  }
  protected getSpecificProperties() {
    return { value: this.properties.value }
  }
}

export class AddPowerNode extends ResourceOperatorNode {
  static operatorType = 'addPower' as const
  constructor() {
    super('增加能量', '#66ffff')
    const valueWidget = this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: -10000,
      max: 10000,
      step: 10,
    })
    this.addInput('value', 'number', valueWidget)
  }
  protected getSpecificProperties() {
    return { value: this.properties.value }
  }
}

// 转移标记节点
export class TransferMarkNode extends BaseOperatorNode {
  static operatorType = 'transferMark' as const
  title = '转移标记'
  color = '#ff9933'

  constructor() {
    super('转移标记')
    this.addInput('mark', 'dynamic')
  }

  protected getSpecificProperties() {
    return {
      mark: this.properties.mark,
    }
  }
}

// 注册所有节点类型
const NODE_CLASSES = [
  DealDamageNode,
  HealNode,
  AddMarkNode,
  AddStacksNode,
  ConsumeStacksNode,
  ModifyStatNode,
  StatStageBuffNode,
  AddRageNode,
  AmplifyPowerNode,
  AddPowerNode,
  TransferMarkNode,
]

export function registerOperatorNodes() {
  NODE_CLASSES.forEach(cls => {
    LiteGraph.registerNodeType(`operators/${(cls as any).operatorType}`, cls)
  })
}

registerOperatorNodes()

/* ---------- 基础选择器节点 ---------- */
export class BaseSelectorNode extends LGraphNode {
  static selectorType: BaseSelector = 'self'

  constructor() {
    super()
    this.addOutput('selector', 'base_selector')
    this.title = this.constructor.name.replace('Node', '')
    this.size = [120, 40]
  }

  onExecute() {
    this.setOutputData(0, this.constructor.selectorType)
  }
}

export class TargetNode extends BaseSelectorNode {
  static selectorType = 'target'
}

export class SelfNode extends BaseSelectorNode {
  static selectorType = 'self'
}

export class EnemyNode extends BaseSelectorNode {
  static selectorType = 'foe'
}

export class PetOwnersNode extends BaseSelectorNode {
  static selectorType = 'petOwners'
}

export class FoeOwnersNode extends BaseSelectorNode {
  static selectorType = 'foeOwners'
}

export class UsingSkillContextNode extends BaseSelectorNode {
  static selectorType = 'usingSkillContext'
}

export class DamageContextNode extends BaseSelectorNode {
  static selectorType = 'damageContext'
}

export class MarkNode extends BaseSelectorNode {
  static selectorType = 'mark'
}

export class SelfMarksNode extends BaseSelectorNode {
  static selectorType = 'selfMarks'
}

export class FoeMarksNode extends BaseSelectorNode {
  static selectorType = 'foeMarks'
}

LiteGraph.registerNodeType('selector/base/self', SelfNode)
LiteGraph.registerNodeType('selector/base/enemy', EnemyNode)
LiteGraph.registerNodeType('selector/base/petOwners', PetOwnersNode)
LiteGraph.registerNodeType('selector/base/foeOwners', FoeOwnersNode)
LiteGraph.registerNodeType('selector/base/usingSkillContext', UsingSkillContextNode)
LiteGraph.registerNodeType('selector/base/damageContext', DamageContextNode)
LiteGraph.registerNodeType('selector/base/mark', MarkNode)
LiteGraph.registerNodeType('selector/base/selfMarks', SelfMarksNode)
LiteGraph.registerNodeType('selector/base/foeMarks', FoeMarksNode)

/* ---------- 链式步骤节点基类 ---------- */
abstract class SelectorStepNode extends LGraphNode {
  stepType!: SelectorChain['type']

  constructor() {
    super()
    this.addInput('prev', 'selector_chain')
    this.addOutput('next', 'selector_chain')
    this.size = [160, 60]
  }

  abstract buildStep(): SelectorChain
}

/* ---------- Where条件节点 ---------- */
export class WhereNode extends SelectorStepNode {
  stepType = 'where' as const
  private condition: string = 'health > 50'

  constructor() {
    super()
    this.addWidget('text', 'condition', this.condition, v => (this.condition = v))
  }

  buildStep(): SelectorChain {
    return {
      type: 'where',
      arg: { type: 'compare', operator: '>', left: 'health', right: 50 },
    }
  }
}
LiteGraph.registerNodeType('selector/step/where', WhereNode)

/* ---------- RandomPick节点 ---------- */
export class RandomPickNode extends SelectorStepNode {
  stepType = 'randomPick' as const
  private count: number = 1

  constructor() {
    super()
    this.addWidget('number', 'count', this.count, v => (this.count = v))
  }

  buildStep(): SelectorChain {
    return { type: 'randomPick', arg: this.count }
  }
}
LiteGraph.registerNodeType('selector/step/randomPick', RandomPickNode)

/* ---------- 主选择器组合节点 ---------- */
export class SelectorBuilderNode extends LGraphNode {
  private base?: BaseSelector
  private chain: SelectorChain[] = []

  constructor() {
    super('Selector Builder')
    this.addInput('base', 'base_selector')
    this.addInput('step', 'selector_chain')
    this.addOutput('selector', 'selector_dsl')
    this.size = [240, 120]
  }

  onExecute() {
    // 收集基础选择器
    const base = this.getInputData(0) as BaseSelector

    // 收集链式步骤
    const chain: SelectorChain[] = []
    let stepNode = this.getInputNode(1)
    while (stepNode instanceof SelectorStepNode) {
      chain.push(stepNode.buildStep())
      stepNode = stepNode.getInputNode(0)
    }

    // 构建最终选择器
    const result: SelectorDSL = base
      ? {
          base,
          chain: chain.reverse(),
        }
      : base

    this.setOutputData(0, result)
  }
}
LiteGraph.registerNodeType('selector/builder', SelectorBuilderNode)
