<template>
  <div class="graph-container">
    <el-container>
      <el-header>
        <el-tabs
          v-model="activeTab"
          type="card"
          class="demo-tabs"
          editable
          @tab-change="handleTabChange"
          @edit="handleTabEdit"
        >
          <el-tab-pane v-for="item in editableTabs" :key="item.name" :label="item.title" :name="item.name">
          </el-tab-pane>
        </el-tabs>
      </el-header>
      <el-container>
        <el-aside width="200px" class="side-menu">
          <el-menu default-active="file" class="menu-list">
            <el-menu-item index="import" @click="importProject">
              <el-icon><Upload /></el-icon>
              <span>导入项目</span>
            </el-menu-item>
            <el-menu-item index="export" @click="exportProject">
              <el-icon><Download /></el-icon>
              <span>导出项目</span>
            </el-menu-item>
            <el-menu-item index="exportEffect" @click="exportEffectData">
              <el-icon><Download /></el-icon>
              <span>导出特效数据</span>
            </el-menu-item>

            <!-- 可扩展其他菜单项 -->
            <el-menu-item index="nodes">
              <el-icon><MagicStick /></el-icon>
              <span>节点库</span>
            </el-menu-item>
          </el-menu>
        </el-aside>

        <!-- 主内容区 -->
        <el-main class="graph-main">
          <canvas class="graph-canvas" ref="canvasRef"></canvas>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, toRaw, nextTick, watch } from 'vue'
import { GraphEditor } from '../graph/graph'
import { nanoid } from 'nanoid'
import YAML from 'yaml'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const editableTabs = ref([
  {
    title: 'Tab 1',
    name: nanoid(),
    content: 'Tab 1 content',
  },
])
const activeTab = ref(editableTabs.value[0].name)

let editor: GraphEditor | null = null

const handleTabChange = (tabId: string | number) => {
  toRaw(editor)?.switchProject(String(tabId))
}

const handleTabEdit = (targetName: string | undefined, action: 'add' | 'remove') => {
  if (action === 'add') {
    const newTabName = nanoid()
    editableTabs.value.push({
      title: `New Tab-${editableTabs.value.length + 1}`,
      name: newTabName,
      content: 'New Tab content',
    })
    activeTab.value = newTabName
  }
  if (action === 'remove' && targetName) {
    const tabs = editableTabs.value
    let activeName = activeTab.value
    let lastIndex = tabs.findIndex(tab => tab.name === targetName)
    editor?.removeProject(targetName)
    tabs.splice(lastIndex, 1)

    if (tabs.length === 0) {
      const newTabName = nanoid()
      editableTabs.value.push({
        title: `New Tab-${tabs.length + 1}`,
        name: newTabName,
        content: 'New Tab content',
      })
      activeTab.value = newTabName
      toRaw(editor)?.switchProject(newTabName)
    } else if (activeName === targetName) {
      // Otherwise, switch to adjacent tab
      let newActiveName = tabs[lastIndex] ? tabs[lastIndex].name : tabs[lastIndex - 1].name
      activeTab.value = newActiveName
    }
  }
}

const exportProject = () => {
  const data = editor?.exportProject()

  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `project-${activeTab.value}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const importProject = () => {
  //弹出文件选择框
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e: any) => {
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = (e: any) => {
      const data = JSON.parse(e.target.result)
      editableTabs.value.push({
        title: `New Tab-${editableTabs.value.length + 1}`,
        name: nanoid(),
        content: 'New Tab content',
      })
      activeTab.value = editableTabs.value[editableTabs.value.length - 1].name
      editor?.switchProject(activeTab.value)
      editor?.importProject(data)
    }
    reader.readAsText(file)
  }
  input.click()
}

const exportEffectData = () => {
  try {
    const data = editor?.buildEffectDSL()
    const blob = new Blob([YAML.stringify(data)])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `effect-${activeTab.value}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error('导出失败')
    console.error(e)
  }
}

const initCanvas = (container: HTMLCanvasElement) => {
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      container.width = width
      container.height = height
    }
  })
  // 初始设置
  container.width = container.parentElement?.clientWidth || 0
  container.height = container.parentElement?.clientHeight || 0

  resizeObserver.observe(container.parentElement as Element)

  console.log('Initial size:', container.clientWidth, container.clientHeight)
}

onMounted(() => {
  nextTick(() => {
    if (canvasRef.value) {
      editor = GraphEditor.getInstance(canvasRef.value)
      initCanvas(canvasRef.value)
    }

    console.log('EffectGraphEditor mounted')
    toRaw(editor)?.switchProject(activeTab.value)
  })
})

watch(activeTab, newVal => {
  toRaw(editor)?.switchProject(newVal)
})

onUnmounted(() => {
  editor?.destroy()
})
</script>

<style scoped>
.graph-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

.el-container {
  height: 100% !important;
}

.el-main {
  position: relative;
  padding: 0 !important;
  overflow: hidden !important;
}

.graph-canvas {
  display: block;
}
</style>

<style>
@import url('@comfyorg/litegraph/style.css');
</style>
