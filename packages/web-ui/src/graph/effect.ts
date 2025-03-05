import { LGraphNode, type INodeOutputSlot, type INodeInputSlot, LiteGraph } from '@comfyorg/litegraph'
import { EffectTrigger } from '@test-battle/const'
import {
  effectDSLSchema as EffectSchema,
  type EffectDSL as Effect,
  type OperatorDSL,
  type ConditionDSL,
} from '../../../effectDSL'

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

    this.addWidget('button', 'debug', 'debug', (v, widget, node, pos, graphcanvas) => {
      console.log(this.toDSL())
    })

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
        const widget = this.widgets!.find(w => w.name === '消耗层数')
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
    this.addInput('apply', 'object')
    this.addInput('condition', 'object')
    this.addOutput('effect', 'object')

    this.properties = {
      id: 'effect_1',
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

  onSerialize(info: any) {
    info.properties = { ...this.properties }
  }

  onConfigure(info: any) {
    this.properties = info.properties
    this.widgets?.forEach(widget => {
      switch (widget.name) {
        case '效果ID':
          widget.value = this.properties.id
          break
        case '触发时机':
          widget.value = this.properties.trigger
          break
        case '是否消耗层数':
          widget.value = this.properties.allowConsumesStacks
          // 更新子控件状态
          const stackWidget = this.widgets!.find(w => w.name === '消耗层数')!
          stackWidget.disabled = !this.properties.allowConsumesStacks
          stackWidget.value = this.properties.consumesStacks || 0
          break
      }
    })

    // 强制刷新控件状态
    this.setDirtyCanvas(true, true)
  }

  // 导出为 EffectDSL 结构
  toDSL(): Effect {
    return {
      id: this.properties.id,
      trigger: this.properties.trigger,
      priority: this.properties.priority,
      apply: this.getInputData(0) as OperatorDSL, // 递归获取连接的 Operator 节点数据
      condition: this.getInputData(1) as ConditionDSL, // 递归获取 Condition 节点数据
      consumesStacks: this.properties.consumesStacks,
    }
  }

  // 从 DSL 数据加载
  fromDSL(dsl: Effect) {
    this.properties.id = dsl.id
    this.properties.trigger = dsl.trigger
    this.properties.priority = dsl.priority
    this.properties.consumesStacks = dsl.consumesStacks

    // // 重建连接关系（需实现 connectOperator 和 connectCondition）
    // if (dsl.apply) this.connectOperator(dsl.apply)
    // if (dsl.condition) this.connectCondition(dsl.condition)
  }

  onExecute(): void {
    this.setOutputData(0, this.toDSL())
  }

  // // 私有方法：连接 Apply 操作节点
  // private connectOperator(operatorDSL: OperatorDSL) {
  //   const node = createOperatorNode(operatorDSL.type) // 根据类型创建对应节点
  //   this.graph.add(node)
  //   this.connect('apply', node, 'input')
  //   node.fromDSL(operatorDSL) // 假设 Operator 节点实现了 fromDSL
  // }

  // private connectCondition(conditionDSL: ConditionDSL) {
  //   const node = createConditionNode(conditionDSL) // 根据类型创建对应节点
  //   this.graph.add(node)
  //   this.connect('condition', node, 'input')
  //   node.fromDSL(conditionDSL) // 假设 Condition 节点实现了 fromDSL
  // }
}

export function registerEffectNodes() {
  LiteGraph.registerNodeType('effect/Effect', EffectNode)
}
