<template>
  <tr class="feature-row">
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
      {{ feature }}
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-center">
      <FeatureIcon :supported="web" />
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-center">
      <FeatureIcon :supported="client" />
    </td>
  </tr>
</template>

<script setup lang="ts">
import { h } from 'vue'

interface Props {
  feature: string
  web: boolean
  client: boolean
}

defineProps<Props>()

// 功能图标组件
const FeatureIcon = ({ supported }: { supported: boolean }) => {
  if (supported) {
    return h(
      'svg',
      {
        class: 'w-5 h-5 text-green-500 mx-auto',
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24',
      },
      [
        h('path', {
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-width': '2',
          d: 'M5 13l4 4L19 7',
        }),
      ],
    )
  } else {
    return h(
      'svg',
      {
        class: 'w-5 h-5 text-red-500 mx-auto',
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24',
      },
      [
        h('path', {
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-width': '2',
          d: 'M6 18L18 6M6 6l12 12',
        }),
      ],
    )
  }
}
</script>

<style scoped>
.feature-row:nth-child(even) {
  background-color: #f9fafb;
}

.feature-row:hover {
  background-color: #f3f4f6;
}
</style>
