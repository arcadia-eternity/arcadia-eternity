import { ref, computed, type Ref } from 'vue'
import type { Effect } from '@arcadia-eternity/schema'
import { OPERATOR_TYPE_LABELS } from '../constants'

// TODO: This composable is prepared for future template discovery UI.
// Currently not imported by any component — will be wired into the
// effect editor template picker when that feature is built.

export interface DiscoveredTemplate {
  id: string
  category: 'apply' | 'condition' | 'evaluator'
  summary: string
  usageCount: number
  definition: unknown
  scope: 'local' | 'global'
  sourceFile?: string
}

interface GlobalTemplate {
  id: string
  category: DiscoveredTemplate['category']
  definition: unknown
}

const globalTemplates = ref<GlobalTemplate[]>([])

function classifyAnchor(name: string): DiscoveredTemplate['category'] {
  const lower = name.toLowerCase()
  if (lower.includes('cond') || lower.startsWith('prob_') || lower.includes('probability')) {
    return 'condition'
  }
  if (lower.includes('eval') || lower.includes('compare') || lower.includes('same')) {
    return 'evaluator'
  }
  return 'apply'
}

function summarizeDefinition(def: unknown): string {
  if (!def || typeof def !== 'object') return '未知'
  const record = def as Record<string, unknown>
  const type = record.type as string | undefined
  if (!type) return '无类型'
  return OPERATOR_TYPE_LABELS[type] ?? type
}

function discoverLocalTemplates(effects: Effect[]): DiscoveredTemplate[] {
  const templates: DiscoveredTemplate[] = []

  for (const effect of effects) {
    const id = effect.id
    if (!id.includes('template') && !id.startsWith('effect_skill_template')) continue

    const template: DiscoveredTemplate = {
      id,
      category: classifyAnchor(id),
      summary: summarizeDefinition(effect.apply),
      usageCount: 0,
      definition: effect.apply ?? effect.condition,
      scope: 'local',
    }

    if (effect.apply && !effect.condition) {
      template.category = 'apply'
      template.definition = effect.apply
      template.summary = summarizeDefinition(effect.apply)
    } else if (effect.condition && !effect.apply) {
      template.category = 'condition'
      template.definition = effect.condition
      template.summary = summarizeDefinition(effect.condition)
    }

    templates.push(template)
  }

  for (const template of templates) {
    const def = template.definition
    let count = 0
    for (const effect of effects) {
      if (effect.id === template.id) continue
      const applyStr = JSON.stringify(effect.apply)
      const defStr = JSON.stringify(def)
      if (applyStr.includes(defStr) || JSON.stringify(effect.condition).includes(defStr)) {
        count++
      }
    }
    template.usageCount = count
  }

  return templates.filter(t => t.usageCount > 0 || templates.length < 20)
}

function loadGlobalTemplates() {
  try {
    const stored = localStorage.getItem('arcadia-effect-templates')
    if (stored) {
      globalTemplates.value = JSON.parse(stored)
    }
  } catch {
    globalTemplates.value = []
  }
}

function saveGlobalTemplate(template: GlobalTemplate) {
  const existing = globalTemplates.value.findIndex(t => t.id === template.id)
  if (existing >= 0) {
    globalTemplates.value[existing] = template
  } else {
    globalTemplates.value.push(template)
  }
  persistGlobalTemplates()
}

function deleteGlobalTemplate(id: string) {
  globalTemplates.value = globalTemplates.value.filter(t => t.id !== id)
  persistGlobalTemplates()
}

function persistGlobalTemplates() {
  try {
    localStorage.setItem('arcadia-effect-templates', JSON.stringify(globalTemplates.value))
  } catch {
    void 0
  }
}

export function useTemplateDiscovery(effectsList: Ref<Effect[]>) {
  loadGlobalTemplates()

  const localTemplates = computed(() => discoverLocalTemplates(effectsList.value))

  const allTemplates = computed(() => [
    ...localTemplates.value,
    ...globalTemplates.value.map(gt => ({
      id: gt.id,
      category: gt.category,
      summary: summarizeDefinition(gt.definition),
      usageCount: 0,
      definition: gt.definition,
      scope: 'global' as const,
    })),
  ])

  function getTemplate(id: string): DiscoveredTemplate | undefined {
    return allTemplates.value.find(t => t.id === id)
  }

  function getTemplatesByCategory(category: DiscoveredTemplate['category']) {
    return allTemplates.value.filter(t => t.category === category)
  }

  function createGlobalTemplate(id: string, category: DiscoveredTemplate['category'], definition: unknown) {
    saveGlobalTemplate({ id, category, definition })
  }

  return {
    localTemplates,
    globalTemplates: computed(() => globalTemplates.value),
    allTemplates,
    getTemplate,
    getTemplatesByCategory,
    createGlobalTemplate,
    deleteGlobalTemplate,
  }
}
