<script setup lang="ts">
import PetButton from './PetButton.vue'
import { Element } from '@test-battle/const'

function leftPetState() {
  return {
    id: 'left-pet',
    name: '迪兰',
    level: 15,
    health: 120,
    maxHealth: 150,
    element: Element.Fire,
    skills: [
      {
        name: '火焰冲击',
        description: '对敌人造成火焰伤害',
        rage: 20,
        power: 90,
        element: Element.Fire,
      },
      {
        name: '水之护盾',
        description: '为自己施加护盾',
        rage: 15,
        power: 0,
        element: Element.Water,
      },
    ],
    position: 'left',
    num: 1,
    isActive: false,
    disabled: false,
  }
}

function rightPetState() {
  return {
    id: 'right-pet',
    name: '迪迪兰',
    level: 12,
    health: 80,
    maxHealth: 100,
    element: Element.Water,
    skills: [
      {
        name: '火焰冲击',
        description: '对敌人造成火焰伤害',
        rage: 20,
        power: 90,
        element: Element.Fire,
      },
      {
        name: '水之护盾',
        description: '为自己施加护盾',
        rage: 15,
        power: 0,
        element: Element.Water,
      },
    ],
    position: 'right',
    num: 2,
    isActive: false,
    disabled: false,
  }
}

function bottomPetState() {
  return {
    id: 'bottom-pet',
    name: '迪兰特',
    level: 18,
    health: 200,
    maxHealth: 200,
    element: Element.Ground,
    skills: [
      {
        name: '火焰冲击',
        description: '对敌人造成火焰伤害',
        rage: 20,
        power: 90,
        element: Element.Fire,
      },
      {
        name: '水之护盾',
        description: '为自己施加护盾',
        rage: 15,
        power: 0,
        element: Element.Water,
      },
    ],
    position: 'bottom',
    num: 3,
    isActive: false,
    disabled: false,
  }
}

function disabledPetState() {
  return {
    id: 'disabled-pet',
    name: '大地熊',
    level: 18,
    health: 200,
    maxHealth: 200,
    element: Element.Ground,
    skills: [
      {
        name: '火焰冲击',
        description: '对敌人造成火焰伤害',
        rage: 20,
        power: 90,
        element: Element.Fire,
      },
      {
        name: '水之护盾',
        description: '为自己施加护盾',
        rage: 15,
        power: 0,
        element: Element.Water,
      },
    ],
    position: 'bottom',
    num: 3,
    isActive: false,
    disabled: true,
  }
}
</script>

<template>
  <Story title="PetButton">
    <Variant title="左侧位置" :init-state="leftPetState">
      <template #default="{ state }">
        <PetButton v-bind="state" />
      </template>
    </Variant>

    <Variant title="右侧位置" :init-state="rightPetState">
      <template #default="{ state }">
        <PetButton v-bind="state" />
      </template>
    </Variant>

    <Variant title="底部位置" :init-state="bottomPetState">
      <template #default="{ state }">
        <PetButton v-bind="state" />
      </template>
    </Variant>

    <Variant title="禁用状态" :init-state="disabledPetState">
      <template #default="{ state }">
        <PetButton v-bind="state" />
      </template>
    </Variant>
  </Story>
</template>
<style>
html,
body,
#app {
  width: 100vw;
  height: 100vh;
}

.__histoire-render-story,
.__histoire-render-story > div,
.__histoire-render-story > div > div {
  width: 100%;
  height: 100%;
  display: flex;
  place-content: center;
  flex-wrap: wrap;
}
</style>
