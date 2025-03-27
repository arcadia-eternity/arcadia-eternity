<script setup lang="ts">
import { Element } from '@test-battle/const'
import ElementIcon from './ElementIcon.vue'
</script>

<template>
  <Story title="Components/ElementIcon">
    <Variant title="Water">
      <ElementIcon :element="Element.Water" />
    </Variant>
    <Variant title="Fire">
      <ElementIcon :element="Element.Fire" />
    </Variant>
    <Variant title="Grass">
      <ElementIcon :element="Element.Grass" />
    </Variant>
    <Variant title="Electric">
      <ElementIcon :element="Element.Electric" />
    </Variant>
    <Variant title="All Elements">
      <div class="grid grid-cols-4 gap-4">
        <div v-for="elem in Object.values(Element)" :key="elem">
          <ElementIcon :element="elem" />
          <div class="text-center">{{ elem }}</div>
        </div>
      </div>
    </Variant>
  </Story>
</template>
