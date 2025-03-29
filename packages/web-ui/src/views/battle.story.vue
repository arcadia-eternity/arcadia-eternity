<script lang="ts" setup>
import BattleView from './battle.vue'
import { Element, Category } from '@test-battle/const'
</script>

<template>
  <Story title="Views/BattleView">
    <BattleView
      :left-player="{
        name: '玩家1',
        rage: 50,
        currentPet: {
          level: 50,
          name: '小火龙',
          speciesNum: 1,
          currentHp: 120,
          maxHp: 150,
          element: Element.Fire,
          marks: [
            {
              id: 'mark1',
              name: '灼烧',
              stack: 1,
              duration: 3,
              description: '每回合损失5%最大HP',
              image: 'burn.png',
            },
          ],
        },
      }"
      :right-player="{
        name: '玩家2',
        rage: 30,
        currentPet: {
          level: 48,
          name: '杰尼龟',
          speciesNum: 2,
          currentHp: 110,
          maxHp: 130,
          element: Element.Water,
        },
      }"
      :skills="[
        {
          id: 'skill1',
          name: '火焰喷射',
          element: Element.Fire,
          category: Category.Special,
          power: 90,
          rage: 20,
          accuracy: 100,
          description: '发射火焰攻击对手',
        },
        {
          id: 'skill2',
          name: '抓',
          element: Element.Normal,
          category: Category.Physical,
          power: 40,
          rage: 10,
          accuracy: 100,
          description: '用爪子抓挠对手',
        },
        {
          id: 'skill3',
          name: '吼叫',
          element: Element.Normal,
          category: Category.Status,
          power: 0,
          rage: 15,
          accuracy: 100,
          description: '吓退对手',
        },
        {
          id: 'skill4',
          name: '烟幕',
          element: Element.Normal,
          category: Category.Status,
          power: 0,
          rage: 10,
          accuracy: 100,
          description: '降低对手命中率',
        },
        {
          id: 'skill5',
          name: '火花',
          element: Element.Fire,
          category: Category.Special,
          power: 40,
          rage: 10,
          accuracy: 100,
          description: '发射小型火焰',
        },
      ]"
    />
  </Story>
</template>
