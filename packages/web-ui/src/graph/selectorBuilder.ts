import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type { BaseSelector, SelectorChain, SelectorDSL } from '../../../effectDSL'
import { SelectorStepNode } from './selectorChain'
import { BaseSelectorNode, IsBaseSelectorNode } from './baseSelector'

export class SelectorBuilderNode extends LGraphNode {
  private baseSelector?: BaseSelector
  private chainSteps: SelectorChain[] = []

  constructor() {
    super('Selector Builder')
    this.size = [320, 160]
    this.color = '#66ccff'

    // 输入端口
    this.addInput('base', 'base_selector') // 基础选择器输入
    this.addInput('step', 'selector_chain') // 链式步骤输入

    // 输出端口
    this.addOutput('selector', 'selector_dsl')

    // 调试按钮
    this.addWidget('button', 'debug', '查看DSL', () => {
      console.log(this.buildSelectorDSL())
    })
  }

  // 连接验证（确保输入类型正确）
  onConnectInput(slot: number, type: string, _, sourceNode: LGraphNode): boolean {
    console.log(IsBaseSelectorNode(sourceNode))
    if (slot === 0 && !IsBaseSelectorNode(sourceNode)) {
      ElMessage.error('只能连接基础选择器节点')
      return false
    }
    if (slot === 1 && !(sourceNode instanceof SelectorStepNode)) {
      ElMessage.error('只能连接链式步骤节点')
      return false
    }
    return true
  }

  // 执行逻辑
  onExecute() {
    // 获取基础选择器
    this.baseSelector = this.getInputData(0) as BaseSelector

    // 收集链式步骤
    this.chainSteps = []
    let stepNode = this.getInputNode(1)
    while (stepNode instanceof SelectorStepNode) {
      this.chainSteps.unshift(stepNode.buildStep()) // 反向收集保证顺序
      stepNode = stepNode.getInputNode(0)
    }

    // 输出最终选择器
    if (this.baseSelector || this.chainSteps.length > 0) this.setOutputData(0, this.buildSelectorDSL())
    else this.setOutputData(0, null)
  }

  // 构建 DSL 结构
  private buildSelectorDSL(): SelectorDSL {
    if (!this.baseSelector && this.chainSteps.length === 0) {
      throw new Error('请至少连接基础选择器或链式步骤')
    }

    return this.baseSelector
      ? { base: this.baseSelector, chain: this.chainSteps }
      : this.chainSteps.length
        ? { base: 'self', chain: this.chainSteps } // 默认基础选择器
        : this.baseSelector! // 单独的基础选择器
  }

  // 可视化增强
  onDrawForeground(ctx: CanvasRenderingContext2D) {
    // 绘制状态指示器
    ctx.fillStyle = this.baseSelector ? '#88ff88' : '#ff8888'
    ctx.beginPath()
    ctx.fill()

    // 显示步骤数量
    ctx.fillStyle = '#fff'
    ctx.fillText(`步骤: ${this.chainSteps.length}`, this.size[0] - 70, this.size[1] - 10)
  }
}

export function registerSelectorBuilderNode() {
  LiteGraph.registerNodeType('selector/builder', SelectorBuilderNode)
}
