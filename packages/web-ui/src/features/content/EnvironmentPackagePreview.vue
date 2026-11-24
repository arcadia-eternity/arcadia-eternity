<script setup lang="ts">
import { computed } from 'vue'
import type { PackagePreview } from './environmentPackagePreview'

const props = defineProps<{ preview: PackagePreview }>()

const labels = { species: '精灵', skills: '技能', marks: '印记' }
const countLabel = computed(() => {
  const { species, skills, marks } = props.preview
  return `${species.count} 只精灵 · ${skills.count} 个技能 · ${marks.count} 个印记`
})
</script>

<template>
  <details v-if="preview.species.count || preview.skills.count || preview.marks.count" class="package-preview">
    <summary>{{ countLabel }}</summary>
    <dl>
      <template v-for="(group, kind) in preview" :key="kind">
        <template v-if="group.count">
          <dt>{{ labels[kind] }}</dt>
          <dd>{{ group.examples.join('、') }}{{ group.count > group.examples.length ? '…' : '' }}</dd>
        </template>
      </template>
    </dl>
  </details>
  <span v-else>{{ countLabel }}</span>
</template>

<style scoped>
.package-preview {
  flex-basis: 100%;
  min-width: 0;
}
summary {
  width: fit-content;
  cursor: pointer;
}
dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 8px;
  margin: 8px 0 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
</style>
