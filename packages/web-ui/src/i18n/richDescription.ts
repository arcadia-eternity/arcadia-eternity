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

/** Validate every branch, including tags hidden behind an inactive ICU select/plural option. */
export function compileRichDescription(template: string, language: string): IntlMessageFormat {
  const message = new IntlMessageFormat(template, language)
  function check(elements: ReturnType<IntlMessageFormat['getAst']>) {
    for (const element of elements) {
      if ('children' in element) {
        if (element.value !== 'mark' && !Object.hasOwn(descriptionStyles, element.value))
          throw new Error(`Unsupported description tag: <${element.value}>`)
        check(element.children)
      } else if ('options' in element) {
        for (const option of Object.values(element.options)) check(option.value)
      }
    }
  }
  check(message.getAst())
  return message
}

/** The message is parsed for this render only. Neither templates nor rendered resource values are cached. */
export function formatRichDescription(
  template: string,
  language: string,
  values: Record<string, PrimitiveType>,
  reference?: (id: string) => VNode,
): Array<string | VNode> {
  // Definitions have no live stack. Keep its placeholder in catalogs/previews instead of inventing a battle value.
  const handlers: Record<string, PrimitiveType | VNode | FormatXMLElementFn<VNode>> = { stack: '{stack}', ...values }
  for (const [tag, className] of Object.entries(descriptionStyles))
    handlers[tag] = chunks => h('span', { class: className }, chunks)
  handlers.mark = chunks => reference?.(chunks.join('').trim()) ?? h('span', chunks)
  const output = compileRichDescription(template, language).format<VNode>(handlers)
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
          output[field] ??= scalar
        }
  }
  return output
}
