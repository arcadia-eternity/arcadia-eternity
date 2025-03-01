<template>
  <div class="effect-editor-container">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-button @click="addEffectNode('dealDamage')">添加伤害效果</el-button>
      <el-button @click="addEffectNode('heal')">添加治疗效果</el-button>
      <el-button @click="save">保存</el-button>
    </div>

    <!-- 流程图编辑器 -->
    <VueFlow
      v-model="elements"
      :nodes-draggable="true"
      :nodes-connectable="true"
      @connect="onConnect"
      @node-click="onNodeClick"
    >
      <template #node-custom="props">
        <div class="effect-node" :class="props.data.type">
          <div class="node-header">
            {{ getEffectTypeName(props.data.type) }}
          </div>
          <div class="node-content">
            {{ props.data.label }}
          </div>
          <div class="node-handle bottom" @mousedown="onHandleMouseDown(props.node, 'bottom')" />
        </div>
      </template>
    </VueFlow>

    <!-- 属性侧边栏 -->
    <el-drawer v-model="showPropertyPanel" title="效果属性" direction="rtl" size="400px">
      <effect-property-editor v-if="selectedNode" :effect="selectedNode.data" @update="updateNodeData" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { ref, watch, computed } from 'vue'
import type { Effect } from '@test-battle/schema'
import { ElDrawer, ElButton } from 'element-plus'
import EffectPropertyEditor from './EffectPropertyEditor.vue'
import type { FileData } from './fileData'

const props = defineProps<{
  currentData: FileData<Effect[]>
  selectedFile: string
}>()

const emit = defineEmits(['save'])

// 流程图相关状态
const { addEdges, addNodes, getNode, updateNode } = useVueFlow()
const elements = ref<any[]>([])
const selectedNode = ref<any>(null)
const showPropertyPanel = ref(false)

// 将原始数据转换为流程图元素
const transformDataToElements = (effects: Effect[]) => {
  const nodes = effects.map((effect, index) => ({
    id: effect.id,
    type: 'custom',
    position: { x: index * 300, y: 0 },
    data: {
      ...effect,
      type: effect.apply.type,
      label: effect.id,
    },
    sourcePosition: 'bottom',
  }))

  const edges = effects.flatMap(
    effect =>
      effect.nextEffects?.map(nextId => ({
        id: `${effect.id}-${nextId}`,
        source: effect.id,
        target: nextId,
      })) || [],
  )

  return [...nodes, ...edges]
}

// 监视数据变化
watch(
  () => props.currentData.data,
  newData => {
    elements.value = transformDataToElements(newData)
  },
  { immediate: true },
)

// 添加新效果节点
const addEffectNode = (type: string) => {
  const newNode = {
    id: `effect_${Date.now()}`,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      id: `effect_${Date.now()}`,
      type,
      trigger: 'OnHit',
      priority: 0,
      apply: createDefaultApply(type),
      nextEffects: [],
    },
  }

  addNodes([newNode])
}

// 创建默认的apply配置
const createDefaultApply = (type: string) => {
  const base = {
    target: { base: 'target' },
    value: { type: 'raw:number', value: 0 },
  }

  switch (type) {
    case 'dealDamage':
      return { type, ...base }
    case 'heal':
      return { type, ...base }
    case 'addMark':
      return {
        type,
        target: { base: 'target' },
        mark: 'example_mark',
        duration: 3,
      }
    // 其他类型处理...
    default:
      return { type }
  }
}

// 节点点击处理
const onNodeClick = (event: any) => {
  selectedNode.value = event.node
  showPropertyPanel.value = true
}

// 更新节点数据
const updateNodeData = (newData: any) => {
  const node = getNode.value(selectedNode.value.id)
  if (node) {
    updateNode(node.id, {
      data: {
        ...node.data,
        ...newData,
      },
    })
  }
}

// 处理连接创建
const onConnect = (connection: any) => {
  const sourceNode = getNode.value(connection.source)
  if (sourceNode) {
    const nextEffects = [...(sourceNode.data.nextEffects || []), connection.target]
    updateNode(sourceNode.id, {
      data: {
        ...sourceNode.data,
        nextEffects,
      },
    })
  }
  addEdges([connection])
}

// 保存处理
const save = () => {
  const nodes = elements.value
    .filter(e => e.type === 'custom')
    .map(node => ({
      ...node.data,
      nextEffects: node.data.nextEffects || [],
    }))

  emit('save', {
    ...props.currentData,
    data: nodes,
  })
}

// 获取效果类型名称
const getEffectTypeName = (type: string) => {
  const typeNames: Record<string, string> = {
    dealDamage: '造成伤害',
    heal: '治疗',
    addMark: '添加标记',
    // 其他类型...
  }
  return typeNames[type] || type
}
</script>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';

.effect-editor-container {
  height: 100vh;
  position: relative;
}

.toolbar {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 10;
  background: white;
  padding: 10px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.effect-node {
  background: #fff;
  border: 2px solid #409eff;
  border-radius: 6px;
  padding: 10px;
  min-width: 200px;
}

.node-header {
  background: #409eff;
  color: white;
  padding: 8px;
  border-radius: 4px;
  margin: -10px -10px 10px -10px;
}

.node-handle {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border: 2px solid #409eff;
  border-radius: 100%;
  bottom: -8px;
  left: calc(50% - 8px);
  cursor: crosshair;
}

.vue-flow__pane {
  cursor: grab;
}

.vue-flow__pane.dragging {
  cursor: grabbing;
}
</style>
