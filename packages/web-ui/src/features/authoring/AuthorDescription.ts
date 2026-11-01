import { defineComponent, h, type PropType } from 'vue'
import {
  compileRichDescription,
  descriptionMarkKind,
  descriptionStyles,
  descriptionValues,
  formatRichDescription,
} from '@/i18n/richDescription'

export interface DescriptionMark {
  id: string
  name: string
  reference?: string
  tags?: readonly string[]
}

export function descriptionProblem(template: string, language: string) {
  try {
    compileRichDescription(template, language)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
export default defineComponent({
  props: {
    text: { type: String, required: true },
    language: { type: String, required: true },
    context: { type: Object as PropType<Record<string, unknown>>, required: true },
    marks: { type: Array as PropType<DescriptionMark[]>, default: () => [] },
    interactive: { type: Boolean, default: true },
    compact: { type: Boolean, default: false },
  },
  emits: ['mark'],
  setup(props, { emit }) {
    return () => {
      const text = props.text
      try {
        return h(
          'div',
          { class: 'author-description' },
          formatRichDescription(text, props.language, descriptionValues(props.context), id => {
            const mark = props.marks.find(mark => mark.id === id || mark.reference === id)
            const kind = descriptionMarkKind(mark?.tags)
            const appearance = { class: descriptionStyles[kind], 'data-description-kind': kind }
            if (!props.interactive) return h('span', appearance, mark?.name ?? id)
            return h(
              'button',
              { ...appearance, type: 'button', onClick: () => emit('mark', mark?.id ?? id) },
              mark?.name ?? id,
            )
          }),
        )
      } catch (error) {
        if (props.compact) return h('div', { class: 'author-description' }, text)
        return h('div', [
          h('p', props.text),
          h('small', { role: 'status' }, `暂时无法预览：${error instanceof Error ? error.message : String(error)}`),
        ])
      }
    }
  },
})
