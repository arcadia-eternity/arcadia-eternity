<template>
  <div class="pack-text-editor-root">
    <div ref="editorContainerRef" class="monaco-editor-container" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  readWorkspacePackFile,
  readWorkspacePackManifest,
  writeWorkspacePackFile,
  writeWorkspacePackManifest,
} from '@/services/packWorkspace'
import { monaco } from '@/utils/monaco'

const props = defineProps<{
  packFolder: string
  relativePath: string
  mode: 'manifest' | 'text'
  title?: string
}>()

const emit = defineEmits<{
  saved: []
}>()

const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const editorContainerRef = ref<HTMLElement | null>(null)

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let suppressDirtyFlag = false
let resizeObserver: ResizeObserver | null = null
const modelDisposables: monaco.IDisposable[] = []

const knownLanguageIds = new Set(monaco.languages.getLanguages().map(item => item.id))

function resolveLanguageId(): string {
  if (props.mode === 'manifest') return 'json'

  const extension = props.relativePath.split('.').pop()?.toLowerCase() ?? ''
  const fallback = 'plaintext'
  const byExtension: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  }

  const target = byExtension[extension] ?? fallback
  return knownLanguageIds.has(target) ? target : fallback
}

function setModelContent(value: string): void {
  if (!model) return
  suppressDirtyFlag = true
  model.setValue(value)
  suppressDirtyFlag = false
  dirty.value = false
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('文件不存在') || message.includes('not found')
}

function getEditorContent(): string {
  return model?.getValue() ?? ''
}

async function loadFile(): Promise<void> {
  loading.value = true
  try {
    if (props.mode === 'manifest') {
      const result = await readWorkspacePackManifest({
        folderName: props.packFolder,
      })
      setModelContent(`${JSON.stringify(result.manifest, null, 2)}\n`)
      return
    }

    const result = await readWorkspacePackFile({
      folderName: props.packFolder,
      relativePath: props.relativePath,
    })
    setModelContent(result.content)
  } catch (error) {
    if (props.mode === 'text' && isMissingFileError(error)) {
      setModelContent('')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`读取文件失败: ${message}`)
  } finally {
    loading.value = false
  }
}

async function saveFile(): Promise<void> {
  if (saving.value || loading.value) return
  saving.value = true
  try {
    const content = getEditorContent()

    if (props.mode === 'manifest') {
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('pack.json 必须是对象')
      }
      await writeWorkspacePackManifest({
        folderName: props.packFolder,
        manifest: parsed as Record<string, unknown>,
      })
      dirty.value = false
      emit('saved')
      return
    }

    await writeWorkspacePackFile({
      folderName: props.packFolder,
      relativePath: props.relativePath,
      content,
    })
    dirty.value = false
    emit('saved')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`保存失败: ${message}`)
  } finally {
    saving.value = false
  }
}

function disposeEditor(): void {
  while (modelDisposables.length > 0) {
    modelDisposables.pop()?.dispose()
  }

  if (resizeObserver && editorContainerRef.value) {
    resizeObserver.unobserve(editorContainerRef.value)
  }
  resizeObserver?.disconnect()
  resizeObserver = null

  editor?.dispose()
  editor = null

  model?.dispose()
  model = null
}

function ensureEditor(): void {
  if (editor || !editorContainerRef.value) return

  model = monaco.editor.createModel('', resolveLanguageId())
  modelDisposables.push(
    model.onDidChangeContent(() => {
      if (suppressDirtyFlag) return
      dirty.value = true
    }),
  )

  editor = monaco.editor.create(editorContainerRef.value, {
    model,
    theme: 'vs-dark',
    automaticLayout: false,
    contextmenu: true,
    fixedOverflowWidgets: true,
    minimap: { enabled: true },
    fontSize: 13,
    lineNumbersMinChars: 3,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void saveFile()
  })

  resizeObserver = new ResizeObserver(() => {
    editor?.layout()
  })
  resizeObserver.observe(editorContainerRef.value)
}

function updateModelLanguage(): void {
  if (!model) return
  monaco.editor.setModelLanguage(model, resolveLanguageId())
}

watch(
  () => [props.packFolder, props.relativePath, props.mode],
  async () => {
    updateModelLanguage()
    await loadFile()
  },
)

onMounted(async () => {
  ensureEditor()
  await loadFile()
})

onBeforeUnmount(() => {
  disposeEditor()
})
</script>

<style scoped>
.pack-text-editor-root {
  height: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1f242b;
}

.monaco-editor-container {
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
