import { LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type { ExtractorDSL } from '@test-battle/schema'

export class DynamicExtractorNode extends LGraphNode {
  constructor() {
    super('DynamicExtractor')
    this.title = '动态提取器'
    this.size = [140, 40]
    this.color = '#00BFFF' // 使用蓝色区分动态类型

    // 文本输入小部件
    this.addWidget('text', '字段路径', '', v => (this.properties.staticValue = v), {
      property: 'staticValue',
      associatedInput: 'param', // 关联输入端口
    })

    // 输出提取器描述
    this.addOutput('extractor', 'extractor')
  }

  // 序列化配置
  onSerialize(info: any): void {
    info.properties = this.properties
  }

  // 反序列化配置
  onConfigure(info: any): void {
    this.properties = info.properties || {}
  }

  // 生成 DSL
  toExtractorDSL(): ExtractorDSL {
    return {
      type: 'dynamic',
      arg: this.properties.staticValue as string,
    }
  }

  // 执行时输出数据
  onExecute() {
    this.setOutputData(0, this.toExtractorDSL())
  }
}

export function registerDynamicExtractorNode() {
  LiteGraph.registerNodeType('extractor/dynamicExtractor', DynamicExtractorNode)
}
