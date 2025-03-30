<script lang="ts" setup>
import BattleView from './battle.vue'
import { Element, Category, AttackTargetOpinion } from '@test-battle/const'
import type { markId, speciesId, baseMarkId, baseSkillId, petId, skillId, playerId } from '@test-battle/const'
</script>

<template>
  <Story title="Views/BattleView">
    <BattleView
      background="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battleBackground/grass.png"
      :left-player="{
        id: 'player1' as unknown as playerId,
        name: '玩家1',
        rage: 50,
        teamAlives: 3,
        activePet: {
          id: 'pet1' as unknown as petId,
          level: 50,
          name: '小火龙',
          speciesID: '1' as unknown as speciesId,
          currentHp: 120,
          maxHp: 150,
          element: Element.Fire,
          isUnknown: false,
          marks: [
            {
              id: 'mark1' as unknown as markId,
              baseId: '1001' as unknown as baseMarkId,
              stack: 1,
              duration: 3,
              isActive: true,
            },
          ],
        },
        team: [
          {
            id: 'pet1' as unknown as petId,
            level: 50,
            name: '小火龙',
            speciesID: '1' as unknown as speciesId,
            currentHp: 120,
            maxHp: 150,
            element: Element.Fire,
            isUnknown: false,
            marks: [
              {
                id: 'mark1' as unknown as markId,
                baseId: '1001' as unknown as baseMarkId,
                stack: 1,
                duration: 3,
                isActive: true,
              },
            ],
          },
        ],
      }"
      :right-player="{
        id: 'player2' as unknown as playerId,
        name: '玩家2',
        rage: 30,
        teamAlives: 3,
        activePet: {
          id: 'pet2' as unknown as petId,
          level: 48,
          name: '杰尼龟',
          speciesID: '2' as unknown as speciesId,
          currentHp: 110,
          maxHp: 130,
          element: Element.Water,
          isUnknown: false,
          marks: [],
        },
      }"
      :global-marks="[]"
      :turns="1"
      :skills="[
        {
          id: 'skill1' as unknown as skillId,
          element: Element.Fire,
          category: Category.Special,
          power: 90,
          rage: 20,
          accuracy: 100,
          isUnknown: false,
          baseId: '1001' as unknown as baseSkillId,
          priority: 0,
          target: AttackTargetOpinion.opponent,
          multihit: 1,
          sureHit: false,
          tag: [],
        },
        {
          id: 'skill2' as unknown as skillId,
          element: Element.Normal,
          category: Category.Physical,
          power: 40,
          rage: 10,
          accuracy: 100,
          isUnknown: false,
          baseId: '1002' as unknown as baseSkillId,
          priority: 0,
          target: AttackTargetOpinion.opponent,
          multihit: 1,
          sureHit: false,
          tag: [],
        },
        {
          id: 'skill3' as unknown as skillId,
          element: Element.Normal,
          category: Category.Status,
          power: 0,
          rage: 15,
          accuracy: 100,
          isUnknown: false,
          baseId: '1003' as unknown as baseSkillId,
          priority: 0,
          target: AttackTargetOpinion.self,
          multihit: 1,
          sureHit: false,
          tag: [],
        },
        {
          id: 'skill4' as unknown as skillId,
          element: Element.Normal,
          category: Category.Status,
          power: 0,
          rage: 10,
          accuracy: 100,
          isUnknown: false,
          baseId: '1004' as unknown as baseSkillId,
          priority: 0,
          target: AttackTargetOpinion.opponent,
          multihit: 1,
          sureHit: false,
          tag: [],
        },
        {
          id: 'skill5' as unknown as skillId,
          element: Element.Fire,
          category: Category.Climax,
          power: 40,
          rage: 10,
          accuracy: 100,
          isUnknown: false,
          baseId: '1005' as unknown as baseSkillId,
          priority: 0,
          target: AttackTargetOpinion.opponent,
          multihit: 1,
          sureHit: false,
          tag: [],
        },
      ]"
    />
  </Story>
</template>
