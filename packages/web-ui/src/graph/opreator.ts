import { LGraphNode, type INodeOutputSlot, type INodeInputSlot, LiteGraph } from '@comfyorg/litegraph'
import type { OperatorDSL, SelectorDSL, Value, DynamicValue } from '../../../effectDSL'
import { StatTypeWithoutHp, StatTypeOnlyBattle } from '@test-battle/const'

abstract class BaseOperatorNode extends LGraphNode {
  static operatorType: OperatorDSL['type']
  abstract title: string
  abstract color: string

  private inputLinks = new Map<number, boolean>()

  constructor(title: string) {
    super(title)
    this.size = [240, 120]
    this.addOutput('apply', 'object')
    this.addInput('target', 'selector_dsl')

    this.addWidget('button', 'debug', 'debug', (v, widget, node, pos, graphcanvas) => {
      console.log(this.toDSL())
      console.log(this.inputs.map(i => i.type).join(','))
    })
  }

  onConnectionsChange(type: number, slotIndex: number, isConnected: boolean, linkInfo: any, portInfo: any) {
    if (super.onConnectionsChange) super.onConnectionsChange(type, slotIndex, isConnected, linkInfo, portInfo)
    this.updateWidgetVisibility()
  }

  private updateWidgetVisibility() {
    this.widgets?.forEach(widget => {
      const options = widget.options as { associatedInput?: string }
      if (options?.associatedInput) {
        const input = this.inputs.find(i => i.name === options.associatedInput)
        widget.hidden = !!input?.link // 有连接时隐藏控件
      }
    })
    this.setDirtyCanvas(true) // 强制重绘
  }

  onConnectInput(target_slot: number, type: unknown, output: INodeOutputSlot, node: LGraphNode, slot: number): boolean {
    //如果已经有一个连接，则不允许再连接
    if (this.inputs[slot].link !== null) {
      ElMessage.error('该输入端口已经有连接')
      return false
    }
    return true
  }

  onConnectOutput(target_slot: number, type: unknown, input: INodeInputSlot, node: LGraphNode, slot: number): boolean {
    if (this.outputs[slot].links && this.outputs[slot].links.length > 0) {
      ElMessage.error('该输出端口已经有连接')
      return false
    }
    return true
  }

  // 公共属性处理
  toDSL(): OperatorDSL {
    // const { success, data, error } = operatorDSLSchema.safeParse(this.getSpecificProperties())
    // if (!success) {
    //   ElMessage.error('OperatorDSL schema validation failed')
    //   console.log(error)
    //   throw new Error('OperatorDSL schema validation failed')
    // }
    return {
      target: this.inputs[0].link ? (this.getInputData(0) as SelectorDSL) : undefined,
      ...this.getSpecificProperties(),
    } as OperatorDSL
  }

  onExecute(): void {
    this.setOutputData(0, this.toDSL())
  }

  protected getValue(inputSlot: number, rawType: Value['type'], defaultValue: unknown): Value {
    const input = this.inputs[inputSlot]

    // 优先使用动态选择器
    if (input?.link) {
      return {
        type: 'dynamic',
        selector: this.getInputData(inputSlot) as SelectorDSL,
      }
    }

    // 回退到控件静态值
    const widget = this.widgets?.find(w => (w.options as any)?.associatedInput === input?.name)
    return {
      type: rawType,
      value: widget ? this.properties[(widget.options as any).property] : defaultValue,
    }
  }

  protected getNumberValue(inputSlot: number, defaultValue: number): Value {
    const input = this.inputs[inputSlot]

    // 优先使用动态选择器
    if (input?.link) {
      return {
        type: 'dynamic',
        selector: this.getInputData(inputSlot) as SelectorDSL,
      }
    }

    // 回退到控件静态值
    const widget = this.widgets?.find(w => (w.options as any)?.associatedInput === input?.name)
    return {
      type: 'raw:number',
      value: widget ? this.properties[(widget.options as any).property] : defaultValue,
    }
  }

  protected getStringValue(inputSlot: number, defaultValue: string): Value {
    const input = this.inputs[inputSlot]

    // 优先使用动态选择器
    if (input?.link) {
      return {
        type: 'dynamic',
        selector: this.getInputData(inputSlot) as SelectorDSL,
      }
    }

    // 回退到控件静态值
    const widget = this.widgets?.find(w => (w.options as any)?.associatedInput === input?.name)
    return {
      type: 'raw:string',
      value: widget ? this.properties[(widget.options as any).property] : defaultValue,
    }
  }

  protected getDynamicValue(inputSlot: number): DynamicValue {
    return this.getValue(inputSlot, 'dynamic', '') as DynamicValue
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
    this.addInput('value', 'selector_dsl', {
      name: 'heal_value',
    })

    this.addWidget(
      'number',
      '治疗量',
      100,
      v => {
        this.properties.staticHeal = v
      },
      {
        property: 'staticHeal',
        associatedInput: 'heal_value', // 关联输入端口名称
      },
    )
  }

  protected getSpecificProperties() {
    return {
      type: DealDamageNode.operatorType,
      value: this.getNumberValue(1, 100),
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
    this.addInput('value', 'selector_dsl', {
      name: 'heal_value',
    })
    this.addWidget(
      'number',
      '治疗量',
      100,
      v => {
        this.properties.staticHeal = v
      },
      {
        property: 'staticHeal',
        associatedInput: 'heal_value', // 关联输入端口名称
      },
    )
  }

  protected getSpecificProperties() {
    return {
      type: HealNode.operatorType,
      value: this.getNumberValue(1, 100),
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
      type: AddMarkNode.operatorType,
      mark: this.properties.mark as string,
      duration: this.properties.duration as number,
    }
  }
}
// 层数操作节点基类

abstract class StackOperatorNode extends BaseOperatorNode {
  constructor(title: string, color: string) {
    super(title)
    this.addInput('value', 'selector_dsl')
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
    return {
      type: AddStacksNode.operatorType,
      value: this.properties.value as number,
    }
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
    return {
      type: ConsumeStacksNode.operatorType,
      value: this.properties.value as number,
    }
  }
}
// 属性修改节点

export class ModifyStatNode extends BaseOperatorNode {
  static operatorType = 'modifyStat' as const
  title = '属性调整'
  color = '#cc99ff'

  constructor() {
    super('属性调整')

    // const statTypeWidget = this.addWidget('combo', '属性类型', 'ATK', null, {
    //   values: Object.values(StatTypeWithoutHp),
    // })
    // const valueWidget = this.addWidget('number', '调整值', 10, v => (this.properties.value = v))
    // const percentWidget = this.addWidget('number', '百分比', 10, v => (this.properties.percent = v))
    // this.addInput('statType', 'selector_dsl')
    // this.addInput('value', 'selector_dsl')
    // this.addInput('percent', 'selector_dsl')

    this.addInput('statType', 'selector_dsl')
    this.addInput('value', 'selector_dsl')
    this.addInput('percent', 'selector_dsl')
    this.addWidget('combo', '属性类型', 'atk', v => (this.properties.statType = v), {
      values: [...Object.values(StatTypeWithoutHp), ...Object.values(StatTypeOnlyBattle)],
      property: 'statType',
      assocaiteInput: 'statType',
    })
    this.addWidget('number', '调整值', 10, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
    this.addWidget('number', '百分比', 10, v => (this.properties.percent = v), {
      property: 'percent',
      associatedInput: 'percent',
    })
  }

  protected getSpecificProperties() {
    return {
      type: ModifyStatNode.operatorType,
      statType: this.getStringValue(1, 'atk'),
      value: this.getNumberValue(2, 10),
      percent: this.getNumberValue(3, 0),
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
    this.addInput('statType', 'selector_dsl')
    this.addInput('value', 'selector_dsl')
    this.addWidget('combo', '属性类型', 'atk', v => (this.properties.statType = v), {
      values: Object.values(StatTypeWithoutHp),
      property: 'statType',
      associatedInput: 'statType',
    })
    this.addWidget('number', '增益等级', 1, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
  }

  protected getSpecificProperties() {
    return {
      statType: this.getStringValue(1, 'atk'),
      value: this.getNumberValue(2, 10),
    }
  }
}
// 资源操作节点基类

abstract class ResourceOperatorNode extends BaseOperatorNode {
  title = '资源操作'
  color = '#9999ff'
  constructor(title: string, color: string) {
    super(title)
    this.title = title
    this.color = color
  }
}

export class AddRageNode extends ResourceOperatorNode {
  static operatorType = 'addRage' as const
  constructor() {
    super('增加怒气', '#ff6666')
    this.addInput('value', 'selector_dsl')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
  }
  protected getSpecificProperties() {
    return { value: this.getNumberValue(1, 10) }
  }
}

export class AmplifyPowerNode extends ResourceOperatorNode {
  static operatorType = 'amplifyPower' as const
  constructor() {
    super('强化威力', '#ff66ff')
    this.addInput('value', 'selector_dsl')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: 0,
      max: 114514,
      step: 10,
      property: 'value',
      associatedInput: 'value',
    })
  }
  protected getSpecificProperties() {
    return { value: this.getNumberValue(1, 10) }
  }
}

export class AddPowerNode extends ResourceOperatorNode {
  static operatorType = 'addPower' as const
  constructor() {
    super('增加能量', '#66ffff')
    this.addInput('value', 'generic')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: -10000,
      max: 10000,
      step: 10,
      property: 'value',
      associatedInput: 'value',
    })
  }
  protected getSpecificProperties() {
    return { value: this.getNumberValue(1, 10000) }
  }
}
// 转移标记节点

export class TransferMarkNode extends BaseOperatorNode {
  static operatorType = 'transferMark' as const
  title = '转移标记'
  color = '#ff9933'

  constructor() {
    super('转移标记')
    this.addInput('mark', 'selector_dsl')
  }

  protected getSpecificProperties() {
    return {
      mark: this.getDynamicValue(1),
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
