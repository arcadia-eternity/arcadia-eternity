import type { Component } from 'vue'
import PackDataEditorPanel from '@/components/pack-editor/PackDataEditorPanel.vue'
import PackTextFileEditor from '@/components/pack-editor/PackTextFileEditor.vue'
import PackAssetPreviewEditor from '@/components/pack-editor/PackAssetPreviewEditor.vue'
import PackUnsupportedFileEditor from '@/components/pack-editor/PackUnsupportedFileEditor.vue'

export type StructuredDataKind = 'species' | 'skills' | 'marks'
export type PackWorkbenchFileKind = 'manifest' | 'structured' | 'text' | 'image' | 'binary'

export type PackWorkbenchFileEntry = {
  key: string
  label: string
  relativePath: string
  kind: PackWorkbenchFileKind
  size?: number
  sourceFile?: string
  dataKind?: string
}

export type PackWorkbenchEditorContext = {
  packFolder: string
  entry: PackWorkbenchFileEntry
}

export type PackWorkbenchResolvedEditor = {
  id: string
  component: Component
  props: Record<string, unknown>
}

export type PackWorkbenchEditorProvider = {
  id: string
  priority?: number
  match: (context: PackWorkbenchEditorContext) => boolean | number
  resolve: (context: PackWorkbenchEditorContext) => PackWorkbenchResolvedEditor
}

const providers: PackWorkbenchEditorProvider[] = []
let defaultProvidersRegistered = false

function asStructuredDataKind(value: string | undefined): StructuredDataKind | null {
  if (value === 'species' || value === 'skills' || value === 'marks') {
    return value
  }
  return null
}

function normalizedScore(
  provider: PackWorkbenchEditorProvider,
  context: PackWorkbenchEditorContext,
): number {
  const score = provider.match(context)
  if (typeof score === 'number') {
    return score
  }
  return score ? 1 : 0
}

function registerDefaultProviders() {
  if (defaultProvidersRegistered) return
  defaultProvidersRegistered = true

  registerPackWorkbenchEditorProvider({
    id: 'structured-data-form',
    priority: 500,
    match: ({ entry }) => {
      return entry.kind === 'structured' && asStructuredDataKind(entry.dataKind) ? 500 : 0
    },
    resolve: ({ entry, packFolder }) => {
      const structuredKind = asStructuredDataKind(entry.dataKind)
      if (!structuredKind) {
        throw new Error('structured 数据文件缺少可识别的 dataKind')
      }

      return {
        id: `structured-data-form:${structuredKind}`,
        component: PackDataEditorPanel,
        props: {
          kind: structuredKind,
          packFolder,
          initialDataFile: entry.sourceFile,
          lockDataFile: true,
        },
      }
    },
  })

  registerPackWorkbenchEditorProvider({
    id: 'manifest-json-editor',
    priority: 400,
    match: ({ entry }) => (entry.kind === 'manifest' ? 400 : 0),
    resolve: ({ entry, packFolder }) => ({
      id: 'manifest-json-editor',
      component: PackTextFileEditor,
      props: {
        packFolder,
        relativePath: entry.relativePath,
        mode: 'manifest',
        title: `${packFolder}/${entry.relativePath}`,
      },
    }),
  })

  registerPackWorkbenchEditorProvider({
    id: 'image-preview',
    priority: 300,
    match: ({ entry }) => (entry.kind === 'image' ? 300 : 0),
    resolve: ({ entry, packFolder }) => ({
      id: 'image-preview',
      component: PackAssetPreviewEditor,
      props: {
        packFolder,
        relativePath: entry.relativePath,
        title: `${packFolder}/${entry.relativePath}`,
      },
    }),
  })

  registerPackWorkbenchEditorProvider({
    id: 'text-editor',
    priority: 100,
    match: ({ entry }) => (entry.kind === 'text' ? 100 : 0),
    resolve: ({ entry, packFolder }) => ({
      id: 'text-editor',
      component: PackTextFileEditor,
      props: {
        packFolder,
        relativePath: entry.relativePath,
        mode: 'text',
        title: `${packFolder}/${entry.relativePath}`,
      },
    }),
  })

  registerPackWorkbenchEditorProvider({
    id: 'binary-readonly',
    priority: 1,
    match: () => 1,
    resolve: ({ entry, packFolder }) => ({
      id: 'binary-readonly',
      component: PackUnsupportedFileEditor,
      props: {
        packFolder,
        relativePath: entry.relativePath,
        title: `${packFolder}/${entry.relativePath}`,
      },
    }),
  })
}

export function registerPackWorkbenchEditorProvider(provider: PackWorkbenchEditorProvider): void {
  const index = providers.findIndex(item => item.id === provider.id)
  if (index >= 0) {
    providers[index] = provider
    return
  }
  providers.push(provider)
}

export function listPackWorkbenchEditorProviders(): PackWorkbenchEditorProvider[] {
  registerDefaultProviders()
  return [...providers].sort((left, right) => {
    const rightPriority = right.priority ?? 0
    const leftPriority = left.priority ?? 0
    if (rightPriority !== leftPriority) return rightPriority - leftPriority
    return left.id.localeCompare(right.id)
  })
}

export function resolvePackWorkbenchEditor(
  context: PackWorkbenchEditorContext,
): PackWorkbenchResolvedEditor | null {
  const allProviders = listPackWorkbenchEditorProviders()

  let bestProvider: PackWorkbenchEditorProvider | null = null
  let bestScore = 0

  for (const provider of allProviders) {
    const score = normalizedScore(provider, context)
    if (score <= 0) continue
    if (!bestProvider || score > bestScore) {
      bestProvider = provider
      bestScore = score
    }
  }

  if (!bestProvider) return null
  return bestProvider.resolve(context)
}
