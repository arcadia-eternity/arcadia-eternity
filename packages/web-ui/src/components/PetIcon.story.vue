<script setup lang="ts">
import PetIcon from './PetIcon.vue'
</script>

<template>
  <Story title="Components/PetIcon">
    <Variant title="Default">
      <PetIcon :id="1" />
    </Variant>

    <Variant title="Different ID">
      <PetIcon :id="999" />
    </Variant>

    <Variant title="Invalid ID">
      <PetIcon :id="114514" />
    </Variant>
  </Story>
</template>
