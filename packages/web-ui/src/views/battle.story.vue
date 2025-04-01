<script lang="ts" setup>
import BattleView from './battle.vue'
import { Element, Category, AttackTargetOpinion } from '@test-battle/const'
import type { markId, speciesId, baseMarkId, baseSkillId, petId, skillId, playerId } from '@test-battle/const'
import { ref, useTemplateRef } from 'vue'
import type { ComponentPublicInstance } from 'vue'

const battleView = useTemplateRef('battleView')
</script>

<template>
  <Story title="Views/BattleView">
    <Variant title="Default">
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
    </Variant>

    <Variant title="Damage Messages">
      <BattleView
        ref="battleView"
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
            marks: [],
          },
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
        :skills="[]"
      />

      <div class="fixed bottom-4 left-4 flex gap-2">
        <button
          class="px-4 py-2 bg-blue-500 text-white rounded"
          @click="battleView?.showDamageMessage('left', 50, 'normal', false)"
        >
          左侧普通伤害
        </button>
        <button
          class="px-4 py-2 bg-red-500 text-white rounded"
          @click="battleView?.showDamageMessage('left', 80, 'up', true)"
        >
          左侧暴击强效
        </button>
        <button
          class="px-4 py-2 bg-red-500 text-white rounded"
          @click="battleView?.showDamageMessage('left', 250, 'up', true)"
        >
          左侧暴击强效震动
        </button>
        <button
          class="px-4 py-2 bg-blue-500 text-white rounded"
          @click="battleView?.showDamageMessage('right', 40, 'normal', false)"
        >
          右侧普通伤害
        </button>
        <button
          class="px-4 py-2 bg-blue-400 text-white rounded"
          @click="battleView?.showDamageMessage('right', 30, 'down', false)"
        >
          右侧弱效伤害
        </button>
        <button class="px-4 py-2 bg-gray-500 text-white rounded" @click="battleView?.showMissMessage('left')">
          左侧Miss
        </button>
        <button class="px-4 py-2 bg-gray-500 text-white rounded" @click="battleView?.showMissMessage('right')">
          右侧Miss
        </button>
        <button class="px-4 py-2 bg-gray-500 text-white rounded" @click="battleView?.showAbsorbMessage('left')">
          左侧吸收
        </button>
        <button class="px-4 py-2 bg-gray-500 text-white rounded" @click="battleView?.showAbsorbMessage('right')">
          右侧吸收
        </button>
      </div>
    </Variant>
  </Story>
</template>
