import { defineComponent, h, type PropType } from 'vue'
import { useTranslation } from 'i18next-vue'
import MarkdownIt from 'markdown-it'
import { serverText, renderContentDescription, contentLanguage } from '@/i18n/serverContent'
import { descriptionValues, formatRichDescription } from '@/i18n/richDescription'
import { useGameDataStore } from '@/stores/gameData'
import { useResourceStore } from '@/stores/resource'
import { resolveMarkIconUrl } from '@/utils/resourceResolver'
import Tooltip from './battle/Tooltip.vue'
import ResourceImage from './ResourceImage.vue'

const ContentDescription = defineComponent({
  name: 'ContentDescription',
  props: {
    namespace: { type: String, required: true },
    contentId: { type: String, required: true },
    fallback: { type: String, default: '' },
    depth: { type: Number, default: 0 },
    context: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
  },
  setup(props) {
    const { i18next } = useTranslation()
    const data = useGameDataStore()
    const resources = useResourceStore()
    return () => {
      const authored = serverText(props.namespace, props.contentId, 'description', contentLanguage.value)
      const value = authored?.value ?? props.fallback
      if (!authored?.rich)
        return h('div', {
          innerHTML: renderContentDescription(new MarkdownIt({ html: true }), value, props.namespace, props.contentId),
        })
      try {
        return h(
          'div',
          { class: 'content-description' },
          formatRichDescription(value, i18next.language || 'zh-CN', descriptionValues(props.context), id => {
            const mark = data.getMark(id)
            const name = String(
              i18next.t(`${id}.name`, {
                ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
                nsSeparator: false,
                defaultValue: id,
              }),
            )
            const description =
              serverText('mark', id, 'description')?.value ??
              String(
                i18next.t(`${id}.description`, {
                  ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
                  nsSeparator: false,
                  defaultValue: '',
                }),
              )
            if (props.depth >= 2) return h('span', { class: 'text-cyan-400' }, name)
            return h(
              Tooltip,
              { portal: true },
              {
                trigger: () =>
                  h('span', { class: 'inline-flex items-center gap-1 text-cyan-400', tabindex: 0 }, [
                    ...(mark
                      ? [
                          h(ResourceImage, {
                            src: resolveMarkIconUrl(mark, resources.getMarkImage),
                            uncached: !!mark.presentation?.icon,
                            class: 'inline-block h-[1em] w-[1em]',
                            alt: '',
                          }),
                        ]
                      : []),
                    name,
                  ]),
                default: () => [
                  h('strong', name),
                  h(ContentDescription, {
                    namespace: 'mark',
                    contentId: id,
                    fallback: description,
                    context: {},
                    depth: props.depth + 1,
                  }),
                ],
              },
            )
          }),
        )
      } catch {
        // Broken/incomplete author messages remain visible and cannot inject HTML.
        return h('div', { class: 'content-description', 'data-format-error': true }, value)
      }
    }
  },
})

export default ContentDescription
