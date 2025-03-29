<script setup lang="ts">
import BattleStatus from './BattleStatus.vue'
import { Element } from '@test-battle/const'

const mockPlayer = {
  name: '训练师小明',
  rage: 80,
  currentPet: {
    speciesNum: 25,
    name: '杰尼龟',
    level: 42,
    currentHp: 320,
    maxHp: 450,
    maxRage: 100,
    element: Element.Water,
    marks: [
      {
        id: 'mark1',
        name: '灼烧',
        stack: 2,
        duration: 3,
        description: '每回合损失10%最大生命值',
        image: 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/markImage/1.png',
      },
    ],
  },
}

const mockEnemy = {
  name: '训练师小红',
  rage: 60,
  currentPet: {
    speciesNum: 94,
    name: '小火龙',
    level: 38,
    currentHp: 210,
    maxHp: 280,
    maxRage: 100,
    element: Element.Water,
    marks: [
      {
        id: 'mark1',
        name: '灼烧',
        stack: 2,
        duration: 3,
        description: '每回合损失10%最大生命值',
        image: 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/markImage/1.png',
      },
    ],
  },
}
</script>

<template>
  <Story title="BattleStatus">
    <Variant title="己方状态（左侧布局）">
      <BattleStatus :player="mockPlayer" side="left" />
    </Variant>

    <Variant title="敌方状态（右侧布局）">
      <BattleStatus :player="mockEnemy" side="right" />
    </Variant>
  </Story>
</template>

<style scoped></style>
