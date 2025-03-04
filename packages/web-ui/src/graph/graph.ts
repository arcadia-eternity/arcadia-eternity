import { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { registerOperatorNodes } from './opreator'
import { registerEffectNodes } from './effect'
import { registerBaseSelectorNodes } from './baseSelector'
import { registerSelectorChainNodes } from './selectorChain'
import { registerSelectorBuilderNode } from './selectorBuilder'

export function createEditor(container: HTMLCanvasElement) {
  // 创建图表和画布
  const graph = new LGraph()
  const canvas = new LGraphCanvas(container, graph)
  registerOperatorNodes()
  registerEffectNodes()
  registerBaseSelectorNodes()
  registerSelectorChainNodes()
  registerSelectorBuilderNode()

  graph.start()
}
