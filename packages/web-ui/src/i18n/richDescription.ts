import { IntlMessageFormat, type PrimitiveType, type FormatXMLElementFn } from 'intl-messageformat'
import { h, type VNode } from 'vue'

export const descriptionStyles: Record<string, string> = {
  damage: 'text-orange-400',
  heal: 'text-green-400',
  shield: 'text-cyan-400',
  buff: 'text-emerald-400',
  debuff: 'text-purple-400',
  rage: 'text-yellow-400',
  strong: 'font-bold',
  emphasis: 'italic',
}

/** The message is parsed for this render only. Neither templates nor rendered resource values are cached. */
export function formatRichDescription(
  template: string,
  language: string,
  values: Record<string, PrimitiveType>,
  reference?: (id: string) => VNode,
): Array<string | VNode> {
  const handlers: Record<string, PrimitiveType | VNode | FormatXMLElementFn<VNode>> = { ...values }
  for (const [tag, className] of Object.entries(descriptionStyles))
    handlers[tag] = chunks => h('span', { class: className }, chunks)
  handlers.mark = chunks => reference?.(chunks.join('').trim()) ?? h('span', chunks)
  const output = new IntlMessageFormat(template, language).format<VNode>(handlers)
  return Array.isArray(output) ? output : [output]
}

/** Only scalar public values reach the formatter; template text never evaluates expressions. */
export function descriptionValues(context: Record<string, unknown>): Record<string, PrimitiveType> {
  const output: Record<string, PrimitiveType> = {}
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') output[key] = value
    else if (value && typeof value === 'object')
      for (const [field, scalar] of Object.entries(value))
        if (typeof scalar === 'string' || typeof scalar === 'number' || typeof scalar === 'boolean') {
          output[`${key}.${field}`] = scalar
          output[field] ??= scalar
        }
  }
  return output
}
