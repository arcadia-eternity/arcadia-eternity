import type { TSchema } from '@sinclair/typebox'

export type ArrayDisplayMode = 'inline' | 'table' | 'drilldown'
export type ObjectDisplayMode = 'inline' | 'drilldown'

export interface ArrayUIHint {
  display?: ArrayDisplayMode
  itemLabel?: string
  collapsible?: boolean
  collapsed?: boolean
}

export interface ObjectUIHint {
  display?: ObjectDisplayMode
  order?: string[]
  hidden?: string[]
  collapsible?: boolean
  collapsed?: boolean
}

export interface FieldUIHint {
  label?: string
  helpText?: string
  prominent?: boolean
}

export type UIHint = ArrayUIHint | ObjectUIHint | FieldUIHint

export const UIHintKey = 'uiHint'

export function withUIHint<T extends TSchema>(schema: T, hint: UIHint): T {
  ;(schema as any)[UIHintKey] = hint
  return schema
}

export function getUIHint(schema: TSchema): UIHint | undefined {
  return (schema as any)[UIHintKey]
}

export function getArrayUIHint(schema: TSchema): ArrayUIHint {
  const hint = getUIHint(schema) as ArrayUIHint | undefined
  return {
    display: hint?.display ?? 'drilldown',
    itemLabel: hint?.itemLabel,
    collapsible: hint?.collapsible ?? true,
    collapsed: hint?.collapsed ?? false,
  }
}

export function getObjectUIHint(schema: TSchema): ObjectUIHint {
  const hint = getUIHint(schema) as ObjectUIHint | undefined
  return {
    display: hint?.display ?? 'drilldown',
    order: hint?.order,
    hidden: hint?.hidden,
    collapsible: hint?.collapsible ?? false,
    collapsed: hint?.collapsed ?? false,
  }
}

export function getFieldUIHint(schema: TSchema): FieldUIHint {
  const hint = getUIHint(schema) as FieldUIHint | undefined
  return {
    label: hint?.label,
    helpText: hint?.helpText,
    prominent: hint?.prominent ?? false,
  }
}
