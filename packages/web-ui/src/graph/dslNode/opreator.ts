import { LGraphNode, type INodeOutputSlot, type INodeInputSlot, LiteGraph } from '@comfyorg/litegraph'
import type { OperatorDSL, SelectorDSL } from '@arcadia-eternity/schema'
import { StatTypeWithoutHp, StatTypeOnlyBattle } from '@arcadia-eternity/const'
import { BaseGetVariableNode } from './BaseGetVariableNode'

abstract class BaseOperatorNode extends BaseGetVariableNode {
  static operatorType: OperatorDSL['type']
  abstract title: string
  abstract color: string

  constructor(title: string) {
    super(title)
    this.size = [240, 120]
    this.addOutput('apply', 'apply')
    this.addInput('target', 'selector')

    this.addWidget('button', 'debug', 'debug', (v, widget, node, pos, graphcanvas) => {
      console.log(this.toDSL())
      console.log(this.inputs.map(i => i.type).join(','))
    })
  }

  onSerialize(info: any) {
    info.properties = { ...this.properties }
  }

  onConnectInput(target_slot: number, type: unknown, output: INodeOutputSlot, node: LGraphNode, slot: number): boolean {
    //如果已经有一个连接，则不允许再连接
    if (this.inputs[target_slot].link !== null) {
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
    return {
      target: this.inputs[0].link ? (this.getInputData(0) as SelectorDSL) : undefined,
      ...this.getSpecificProperties(),
    } as OperatorDSL
  }

  onExecute(): void {
    this.setOutputData(0, this.toDSL())
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
    this.addInput('value', 'selector', {
      name: 'damage_value',
    })

    this.addWidget('number', '伤害量', 100, v => (this.properties.staticDamage = v), {
      property: 'staticDamage',
      associatedInput: 'damage_value', // 关联输入端口名称
    })

    this.properties.staticDamage = 100
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
    this.addInput('value', 'selector', {
      name: 'heal_value',
    })
    this.addWidget('number', '治疗量', 100, v => (this.properties.staticHeal = v), {
      property: 'staticHeal',
      associatedInput: 'heal_value', // 关联输入端口名称
    })

    this.properties.staticHeal = 100
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
    this.addWidget('number', '持续时间', 3, v => (this.properties.duration = v), { property: 'duration' })
    this.addWidget('text', '标记ID', 'mark_1', v => (this.properties.mark = v), { property: 'mark' })

    this.properties = {
      mark: 'mark_1',
      duration: 3,
    }
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
    this.addInput('value', 'selector')
    this.addWidget('number', '数量', 1, v => (this.properties.value = v), { property: 'value' })
    this.properties.value = 1
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

    this.addInput('statType', 'selector')
    this.addInput('value', 'selector')
    this.addInput('percent', 'selector')
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
    this.properties = {
      statType: 'atk',
      value: 10,
      percent: 0,
    }
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
    this.addInput('statType', 'selector')
    this.addInput('value', 'selector')
    this.addInput('strategy', 'selector')
    this.addWidget('combo', '属性类型', 'atk', v => (this.properties.statType = v), {
      values: Object.values(StatTypeWithoutHp),
      property: 'statType',
      associatedInput: 'statType',
    })
    this.addWidget('number', '增益等级', 1, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
    this.addWidget('combo', '设置策略', 'add', v => (this.properties.strategy = v), {
      values: ['add', 'set'],
      property: 'strategy',
      associatedInput: 'strategy',
    })

    this.properties = {
      statType: 'atk',
      value: 1,
      strategy: 'add',
    }
  }

  protected getSpecificProperties() {
    return {
      statType: this.getStringValue(1, 'atk'),
      value: this.getNumberValue(2, 10),
      strategy: this.getStringValue(3, 'add'),
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
    this.addInput('value', 'selector')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
    this.properties.value = 10
  }
  protected getSpecificProperties() {
    return { value: this.getNumberValue(1, 10) }
  }
}

export class AmplifyPowerNode extends ResourceOperatorNode {
  static operatorType = 'amplifyPower' as const
  constructor() {
    super('强化威力', '#ff66ff')
    this.addInput('value', 'selector')
    this.addWidget('number', '数值', 10, v => (this.properties.value = v), {
      min: 0,
      max: 114514,
      step: 10,
      property: 'value',
      associatedInput: 'value',
    })
    this.properties.value = 10
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
    this.properties.value = 10
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
    this.addInput('mark', 'selector')
  }

  protected getSpecificProperties() {
    return {
      mark: this.getDynamicValue(1),
    }
  }
}

// 标签化配置节点

export class RegisterTaggedConfigNode extends BaseOperatorNode {
  static operatorType = 'registerTaggedConfig' as const
  title = '注册标签配置'
  color = '#66ff66'

  constructor() {
    super('注册标签配置')
    this.addInput('configKey', 'selector')
    this.addInput('initialValue', 'selector')
    this.addInput('tags', 'selector')

    this.addWidget('text', '配置键', 'my.config', v => (this.properties.configKey = v), {
      property: 'configKey',
      associatedInput: 'configKey',
    })
    this.addWidget('text', '初始值', '0', v => (this.properties.initialValue = v), {
      property: 'initialValue',
      associatedInput: 'initialValue',
    })
    this.addWidget('text', '标签(逗号分隔)', 'tag1,tag2', v => (this.properties.tags = v), {
      property: 'tags',
      associatedInput: 'tags',
    })

    this.properties = {
      configKey: 'my.config',
      initialValue: '0',
      tags: 'tag1,tag2',
    }
  }

  protected getSpecificProperties() {
    return {
      type: RegisterTaggedConfigNode.operatorType,
      configKey: this.getStringValue(1, 'my.config'),
      initialValue: this.getStringValue(2, '0'),
      tags: this.getArrayValue(3, ['tag1', 'tag2']),
    }
  }

  private getArrayValue(inputIndex: number, defaultValue: string[]): any {
    const input = this.inputs[inputIndex]
    if (input && input.link !== null) {
      return this.getDynamicValue(inputIndex)
    }

    // Parse comma-separated string into array
    const tagsString = this.properties.tags as string
    const tagsArray = tagsString
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)

    return {
      type: 'raw:array',
      value: tagsArray.length > 0 ? tagsArray : defaultValue,
    }
  }
}

export class AddTaggedConfigModifierNode extends BaseOperatorNode {
  static operatorType = 'addTaggedConfigModifier' as const
  title = '标签配置修改器'
  color = '#ff9966'

  constructor() {
    super('标签配置修改器')
    this.addInput('tag', 'selector')
    this.addInput('value', 'selector')
    this.addInput('priority', 'selector')

    this.addWidget('text', '标签', 'probability', v => (this.properties.tag = v), {
      property: 'tag',
      associatedInput: 'tag',
    })
    this.addWidget('combo', '修改类型', 'delta', v => (this.properties.modifierType = v), {
      values: ['override', 'delta', 'append', 'prepend'],
      property: 'modifierType',
    })
    this.addWidget('number', '修改值', 0.05, v => (this.properties.value = v), {
      property: 'value',
      associatedInput: 'value',
    })
    this.addWidget('number', '优先级', 100, v => (this.properties.priority = v), {
      property: 'priority',
      associatedInput: 'priority',
    })

    this.properties = {
      tag: 'probability',
      modifierType: 'delta',
      value: 0.05,
      priority: 100,
    }
  }

  protected getSpecificProperties() {
    return {
      type: AddTaggedConfigModifierNode.operatorType,
      tag: this.getStringValue(1, 'probability'),
      modifierType: {
        type: 'raw:string',
        value: this.properties.modifierType as string,
      },
      value: this.getNumberValue(2, 0.05),
      priority: this.getNumberValue(3, 100),
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
  RegisterTaggedConfigNode,
  AddTaggedConfigModifierNode,
]

export function registerOperatorNodes() {
  NODE_CLASSES.forEach(cls => {
    LiteGraph.registerNodeType(`operators/${(cls as any).operatorType}`, cls)
  })
}

export const NODE_TYPE_MAP = {
  dealDamage: DealDamageNode,
  heal: HealNode,
  addMark: AddMarkNode,
  addStacks: AddStacksNode,
  consumeStacks: ConsumeStacksNode,
  modifyStat: ModifyStatNode,
  statStageBuff: StatStageBuffNode,
  addRage: AddRageNode,
  amplifyPower: AmplifyPowerNode,
  addPower: AddPowerNode,
  transferMark: TransferMarkNode,
  registerTaggedConfig: RegisterTaggedConfigNode,
  addTaggedConfigModifier: AddTaggedConfigModifierNode,
}

export function createOperatorNode(type: OperatorDSL['type']) {
  const cls = NODE_TYPE_MAP[type]
  if (!cls) {
    throw new Error(`Unknown operator type: ${type}`)
  }
  return new cls()
}
