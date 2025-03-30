<script setup lang="ts">
import BattleStatus from './BattleStatus.vue'
import { Element, type baseMarkId, type markId, type petId, type playerId, type speciesId } from '@test-battle/const'

const mockPlayer = {
  id: 'player1' as playerId,
  name: '玩家1',
  rage: 50,
  teamAlives: 3,
  activePet: {
    id: 'pet1' as petId,
    level: 50,
    name: '小火龙',
    speciesID: 'pet_dilante' as speciesId,
    currentHp: 120,
    maxHp: 150,
    element: Element.Fire,
    isUnknown: false,
    marks: [
      {
        id: 'mark1' as markId,
        baseId: '1001' as baseMarkId,
        stack: 1,
        duration: 3,
        isActive: true,
      },
    ],
  },
  team: [
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
        },
      ],
    },
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
        },
      ],
    },
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
        },
      ],
    },
  ],
}

const mockEnemy = {
  id: 'player2' as playerId,
  name: '玩家2',
  rage: 30,
  teamAlives: 3,
  activePet: {
    id: 'pet2' as petId,
    level: 48,
    name: '杰尼龟',
    speciesID: '2' as speciesId,
    currentHp: 110,
    maxHp: 130,
    element: Element.Water,
    isUnknown: false,
    marks: [],
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
