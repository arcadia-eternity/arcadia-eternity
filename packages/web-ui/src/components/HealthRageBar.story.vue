<script setup lang="ts">
import HealthRageBar from './HealthRageBar.vue'

function initState() {
  return {
    current: 500,
    max: 500,
    rage: 0,
    reverse: false,
  }
}

function lowHealthState() {
  return {
    current: 100,
    max: 500,
    rage: 50,
    reverse: false,
  }
}

function fullRageState() {
  return {
    current: 300,
    max: 500,
    rage: 100,
    reverse: false,
  }
}

function reversedState() {
  return {
    current: 200,
    max: 500,
    rage: 75,
    reverse: true,
  }
}
</script>

<template>
  <Story title="HealthRageBar">
    <Variant title="Default" :init-state="initState">
      <template #default="{ state }">
        <HealthRageBar v-bind="state" />
      </template>
      <template #controls="{ state }">
        <HstNumber v-model="state.current" title="Current" :min="0" :max="state.max" />
        <HstNumber v-model="state.max" title="Max" :min="1" :max="1000" />
        <HstNumber v-model="state.rage" title="Rage" :min="0" :max="100" />
        <HstCheckbox v-model="state.reverse" title="Reverse" />
      </template>
    </Variant>

    <Variant title="Low Health" :init-state="lowHealthState">
      <template #default="{ state }">
        <HealthRageBar v-bind="state" />
      </template>
    </Variant>

    <Variant title="Full Rage" :init-state="fullRageState">
      <template #default="{ state }">
        <HealthRageBar v-bind="state" />
      </template>
    </Variant>

    <Variant title="Reversed" :init-state="reversedState">
      <template #default="{ state }">
        <HealthRageBar v-bind="state" />
      </template>
    </Variant>
  </Story>
</template>
