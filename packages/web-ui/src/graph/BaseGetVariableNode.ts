import { LGraphNode } from '@comfyorg/litegraph'
import type { Value, SelectorDSL, DynamicValue } from '../../../effectDSL'

export abstract class BaseGetVariableNode extends LGraphNode {
  abstract title: string

  constructor(title: string) {
    super(title)
  }

  onConnectionsChange(type: number, slotIndex: number, isConnected: boolean, linkInfo: any, portInfo: any) {
    if (super.onConnectionsChange) super.onConnectionsChange(type, slotIndex, isConnected, linkInfo, portInfo)
    this.updateWidgetVisibility()
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

  public updateWidgetVisibility() {
    this.widgets?.forEach(widget => {
      const options = widget.options as { associatedInput?: string }
      if (options?.associatedInput) {
        const input = this.inputs.find(i => i.name === options.associatedInput)
        widget.disabled = !!input?.link // 有连接时隐藏控件
      }
    })
    this.setDirtyCanvas(true) // 强制重绘
  }

  protected getFixedValue(inputSlot: number, type: string): Value {
    if (this.inputs[inputSlot].link) {
      return this.getDynamicValue(inputSlot)
    }

    switch (type) {
      case 'number':
        return this.getNumberValue(inputSlot, 0)
      case 'string':
        return this.getStringValue(inputSlot, '')
      case 'boolean':
        return this.getValue(inputSlot, 'raw:boolean', false)
      default:
        throw new Error('Unsupported type')
    }
  }

  protected getDynamicValue(inputSlot: number): DynamicValue {
    return this.getValue(inputSlot, 'dynamic', '') as DynamicValue
  }
}
