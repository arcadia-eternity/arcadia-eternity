// graph-editor.ts
import { LGraph, LGraphCanvas, LiteGraph } from '@comfyorg/litegraph'
import { registerBaseSelectorNodes } from './dslNode/baseSelector'
import { registerEffectNodes } from './dslNode/effect'
import { registerOperatorNodes } from './dslNode/opreator'
import { registerSelectorChainNodes } from './dslNode/selectorChain'
import type { EffectDSL } from '@arcadia-eternity/schema'
import { EffectSetSchema } from '@arcadia-eternity/schema'
import { registerEvaluatorNodes } from './dslNode/evaluator'
import { registerBaseExtractorNodes } from './dslNode/baseExtractor'
import { registerDynamicExtractorNode } from './dslNode/dynamicExtractor'
import { registerConditionNodes } from './dslNode/condition'

// 全局单例
let globalInstance: GraphEditor | null = null

LiteGraph.debug = true

export class GraphEditor {
  private static instance: GraphEditor
  private canvas: LGraphCanvas
  private graph: LGraph
  private currentData: Map<string, { graph: any }> = new Map()
  private currentTabId: string = ''
  private timer: any

  private constructor(container: HTMLCanvasElement) {
    this.graph = new LGraph()
    this.canvas = new LGraphCanvas(container, this.graph)
    this.canvas.autoresize = true

    this.registerNodes()
    this.graph.start()

    const timer = setInterval(() => {
      this.graph.runStep(1, true)
    }, 50)
    this.timer = timer
  }

  public static getInstance(container?: HTMLCanvasElement): GraphEditor {
    if (!globalInstance && container) {
      globalInstance = new GraphEditor(container)
    }
    return globalInstance!
  }

  private registerNodes() {
    if (!LiteGraph.registered_node_types['base/selector']) {
      registerEffectNodes()
      registerOperatorNodes()
      registerConditionNodes()
      registerBaseSelectorNodes()
      registerSelectorChainNodes()
      registerEvaluatorNodes()
      registerBaseExtractorNodes()
      registerDynamicExtractorNode()
    }
  }

  public removeProject(tabId: string) {
    console.log('remove', tabId)
    this.currentData.delete(tabId)
  }

  public switchProject(tabId: string) {
    console.log('switchProject', tabId, this.currentTabId)
    this.currentData.set(this.currentTabId, {
      graph: this.graph.asSerialisable(),
    })

    // 清除图
    this.graph.clear()

    // 加载新项目
    const data = this.currentData.get(tabId)
    if (data) {
      console.log(data)
      this.graph.configure(data.graph)
    }

    // 更新画布
    this.canvas.draw(true)

    // 更新当前标签 ID
    this.currentTabId = tabId
    console.log('switchProject', this.currentTabId)
  }

  public saveProject(tabId: string) {
    this.currentData.set(tabId, {
      graph: this.graph.asSerialisable(),
    })
  }

  public exportProject(tabId?: string) {
    if (tabId) {
      const data = this.currentData.get(tabId)
      if (data) {
        return data.graph
      }
    }
    return this.graph.asSerialisable()
  }

  public buildEffectDSL() {
    const res: any[] = []
    const nodes = this.graph.findNodesByType('effect/Effect', [])
    console.log(nodes)
    for (const node of nodes) {
      const nodeData = node.getOutputData(0) as EffectDSL
      if (nodeData) {
        console.log(nodeData)
      }
      res.push(nodeData)
    }
    const result = EffectSetSchema.safeParse(res)
    if (!result.success) {
      console.log(res)
      console.log(result.error.errors)
      throw new Error(result.error.errors.join('\n'))
    }
    return result.data
  }

  public importProject(data: any) {
    this.graph.configure(data)

    // 强制所有节点刷新
    this.graph.nodes.forEach(node => {
      node.setDirtyCanvas(true, true)
    })

    this.canvas.draw(true)
  }

  public destroy() {
    this.graph.stop()
    this.canvas.clear()
    this.currentData.clear()
    clearInterval(this.timer)
    globalInstance = null
  }
}
