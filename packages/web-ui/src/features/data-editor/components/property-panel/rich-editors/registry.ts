import type { RichDisplayHint, RichEditorRegistration, RichFieldContext } from './types'

const registry: RichEditorRegistration[] = []

export function registerRichEditor(reg: RichEditorRegistration): void {
  const idx = registry.findIndex(r => r.hint === reg.hint && r.component === reg.component)
  if (idx >= 0) {
    registry[idx] = reg
    return
  }
  registry.push(reg)
}

export function resolveRichEditor(ctx: RichFieldContext): RichEditorRegistration | null {
  const hint = ctx.hints.display ?? 'default'
  let best: RichEditorRegistration | null = null
  let bestPriority = -1

  for (const reg of registry) {
    if (reg.hint !== hint) continue
    if (reg.match && !reg.match(ctx)) continue
    const prio = reg.priority ?? 0
    if (prio > bestPriority) {
      best = reg
      bestPriority = prio
    }
  }

  return best
}

let defaultsRegistered = false

export async function ensureDefaultRichEditors(): Promise<void> {
  if (defaultsRegistered) return
  defaultsRegistered = true

  const { default: IdentityHeader } = await import('./editors/IdentityHeader.vue')
  const { default: StatBarsEditor } = await import('./editors/StatBarsEditor.vue')
  const { default: EntityTableEditor } = await import('./editors/EntityTableEditor.vue')
  const { default: EntityTagsChip } = await import('./editors/EntityTagsChip.vue')
  const { default: ConfigGridEditor } = await import('./editors/ConfigGridEditor.vue')
  const { default: StatsGridEditor } = await import('./editors/StatsGridEditor.vue')

  registerRichEditor({ hint: 'identity',     component: IdentityHeader,    priority: 1000 })
  registerRichEditor({ hint: 'statBars',     component: StatBarsEditor,    priority: 100 })
  registerRichEditor({ hint: 'entityTable',  component: EntityTableEditor, priority: 100 })
  registerRichEditor({ hint: 'entityTags',   component: EntityTagsChip,    priority: 100 })
  registerRichEditor({ hint: 'configGrid',   component: ConfigGridEditor,  priority: 100 })
  registerRichEditor({ hint: 'statsGrid',    component: StatsGridEditor,   priority: 100 })
}
