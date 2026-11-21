<template>
  <a
    :href="href"
    class="flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
defineProps<{ href: string }>()
</script>
