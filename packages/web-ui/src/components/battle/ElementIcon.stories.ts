import type { Meta, StoryObj } from '@storybook/vue3'
import { Element } from '@arcadia-eternity/const'
import ElementIcon from './ElementIcon.vue'

const meta: Meta<typeof ElementIcon> = {
  title: 'Components/Battle/ElementIcon',
  component: ElementIcon,
}

export default meta

type Story = StoryObj<typeof ElementIcon>

export const Water: Story = {
  render: () => ({
    components: { ElementIcon },
    setup() {
      return { element: Element.Water }
    },
    template: '<ElementIcon :element="element" />',
  }),
}

export const Fire: Story = {
  render: () => ({
    components: { ElementIcon },
    setup() {
      return { element: Element.Fire }
    },
    template: '<ElementIcon :element="element" />',
  }),
}

export const Grass: Story = {
  render: () => ({
    components: { ElementIcon },
    setup() {
      return { element: Element.Grass }
    },
    template: '<ElementIcon :element="element" />',
  }),
}

export const Electric: Story = {
  render: () => ({
    components: { ElementIcon },
    setup() {
      return { element: Element.Electric }
    },
    template: '<ElementIcon :element="element" />',
  }),
}

export const AllElements: Story = {
  render: () => ({
    components: { ElementIcon },
    setup() {
      return { elements: Object.values(Element) }
    },
    template: `
      <div class="grid grid-cols-4 gap-4">
        <div v-for="elem in elements" :key="elem">
          <ElementIcon :element="elem" />
          <div class="text-center">{{ elem }}</div>
        </div>
      </div>
    `,
  }),
}
