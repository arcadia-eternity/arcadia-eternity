import { defineComponent, h, type PropType } from 'vue'
import { IntlMessageFormat } from 'intl-messageformat'
import { descriptionValues, formatRichDescription } from '@/i18n/richDescription'

export interface DescriptionMark {
  id: string
  name: string
  reference?: string
}

export function descriptionProblem(template: string, language: string) {
  try {
    new IntlMessageFormat(template, language)
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
  },
  emits: ['mark'],
  setup(props, { emit }) {
    return () => {
      try {
        return h(
          'div',
          { class: 'author-description' },
          formatRichDescription(props.text, props.language, descriptionValues(props.context), id => {
            const mark = props.marks.find(mark => mark.id === id || mark.reference === id)
            return h('button', { type: 'button', onClick: () => emit('mark', mark?.id ?? id) }, mark?.name ?? id)
          }),
        )
      } catch (error) {
        return h('div', [
          h('p', props.text),
          h('small', { role: 'status' }, `暂时无法预览：${error instanceof Error ? error.message : String(error)}`),
        ])
      }
    }
  },
})
