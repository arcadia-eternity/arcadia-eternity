<script setup lang="ts">
import BattleLogEntry from './BattleLogEntry.vue'
import { computed, ref } from 'vue'
import type {
  BattleMessage,
  MarkMessage,
  petId,
  PetMessage,
  playerId,
  PlayerMessage,
  skillId,
  SkillMessage,
  StatTypeOnBattle,
} from '@test-battle/const'
import { BattleMessageType, AttackTargetOpinion } from '@test-battle/const'

const props = defineProps<{
  message: BattleMessage
  petData?: Map<string, PetMessage>
  skillData?: Map<string, SkillMessage>
  playerData?: Map<string, PlayerMessage>
  markData?: Map<string, MarkMessage>
}>()

// 从props获取静态数据
const petMap = computed(() => props.petData || new Map<string, PetMessage>())
const skillMap = computed(() => props.skillData || new Map<string, SkillMessage>())
const playerMap = computed(() => props.playerData || new Map<string, SkillMessage>())
const markMap = computed(() => props.markData || new Map<string, MarkMessage>())

// 技能使用消息
const skillMessage = ref<BattleMessage>({
  sequenceId: 1,
  type: BattleMessageType.SkillUse,
  data: {
    user: 'pet-123' as petId,
    target: AttackTargetOpinion.opponent,
    skill: 'skill-456' as skillId,
    rageCost: 30,
  },
})

// 状态变化消息
const statusMessage = ref<BattleMessage>({
  sequenceId: 2,
  type: BattleMessageType.StatChange,
  data: {
    pet: 'pet-123' as petId,
    stat: 'ATK' as StatTypeOnBattle,
    stage: 2,
    reason: '技能效果',
  },
})

// 换宠消息
const switchMessage = ref<BattleMessage>({
  sequenceId: 3,
  type: BattleMessageType.PetSwitch,
  data: {
    player: 'player-1' as playerId,
    fromPet: 'pet-123' as petId,
    toPet: 'pet-456' as petId,
    currentHp: 80,
  },
})

// 普通信息消息
const infoMessage = ref<BattleMessage>({
  sequenceId: 4,
  type: BattleMessageType.Info,
  data: {
    message: '[战斗] 皮卡丘使用了十万伏特！',
  },
})
</script>

<template>
  <Story title="BattleLogEntry">
    <Variant title="技能使用消息">
      <BattleLogEntry
        :message="skillMessage"
        :skill-data="skillData"
        :mark-data="markData"
        :pet-data="petData"
        :player-data="playerData"
      />
    </Variant>

    <Variant title="状态变化消息">
      <BattleLogEntry
        :message="statusMessage"
        :skill-data="skillData"
        :mark-data="markData"
        :pet-data="petData"
        :player-data="playerData"
      />
    </Variant>

    <Variant title="换宠消息">
      <BattleLogEntry
        :message="switchMessage"
        :skill-data="skillData"
        :mark-data="markData"
        :pet-data="petData"
        :player-data="playerData"
      />
    </Variant>

    <Variant title="普通信息消息">
      <BattleLogEntry
        :message="infoMessage"
        :skill-data="skillData"
        :mark-data="markData"
        :pet-data="petData"
        :player-data="playerData"
      />
    </Variant>
  </Story>
</template>
