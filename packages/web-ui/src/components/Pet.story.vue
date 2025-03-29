<script setup lang="ts">
import Pet from './Pet.vue'
</script>

<template>
  <Story title="Components/Pet">
    <Variant title="Default">
      <Pet :num="1" />
    </Variant>

    <Variant title="Reversed">
      <Pet :num="1" reverse />
    </Variant>

    <Variant title="Error State">
      <Pet :num="9999" />
    </Variant>
  </Story>
</template>
