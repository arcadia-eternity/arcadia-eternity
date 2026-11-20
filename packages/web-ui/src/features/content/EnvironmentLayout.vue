<template>
  <div class="environment-layout" :class="{ 'with-directory': !!$slots.directory }">
    <aside v-if="$slots.directory" class="directory-column"><slot name="directory" /></aside>
    <div class="detail-column"><slot /></div>
  </div>
</template>

<style scoped>
.environment-layout {
  min-width: 0;
}
.with-directory {
  display: grid;
  grid-template-columns: clamp(200px, 21%, 272px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.directory-column {
  position: sticky;
  top: 0;
  min-width: 0;
}
.detail-column {
  display: grid;
  min-width: 0;
  gap: 14px;
}
@media (max-width: 760px) {
  .with-directory {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .directory-column {
    position: static;
  }
}
</style>
