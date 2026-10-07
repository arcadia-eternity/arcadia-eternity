<script setup lang="ts">
import {
  type skillId,
  type petId,
  type SkillMessage,
  type PetMessage,
  type AttributeModifierInfo,
} from '@arcadia-eternity/const'
import BattleGlyph from './BattleGlyph.vue'
import SkillButton from './SkillButton.vue'
import PetButton from './PetButton.vue'
import BattleLogPanel from './BattleLogPanel.vue'
import { useBattleViewStore } from '@/stores/battleView'
import { useGameSettingStore } from '@/stores/gameSetting'
import i18next from 'i18next'

defineProps<{
  panel: 'skills' | 'pets'
  skills: SkillMessage[]
  pets: PetMessage[]
  waiting: boolean
  spectator: boolean
  training: boolean
  canWait: boolean
  canSurrender: boolean
  skillAvailable: (id: skillId) => boolean
  petSelectable: (id: petId) => boolean
  modifier: (skill: SkillMessage, attribute: string) => AttributeModifierInfo | undefined
  effectiveness: (skill: SkillMessage) => number
}>()
defineEmits<{
  panel: [value: 'skills' | 'pets']
  skill: [id: string]
  pet: [id: string]
  wait: []
  surrender: []
  training: []
  fullscreen: []
  exit: []
}>()
const view = useBattleViewStore()
const settings = useGameSettingStore()
</script>
<template>
  <section class="battle-dock" data-testid="battle-command-dock" :class="{ 'battle-dock--log': view.showLogPanel }">
    <div class="battle-dock__toolbar">
      <div class="battle-dock__tabs" v-if="!spectator">
        <button class="battle-control" :aria-pressed="panel === 'skills'" @click="$emit('panel', 'skills')">
          <BattleGlyph name="fight" />{{ i18next.t('fight', { ns: 'battle' }) }}
        </button>
        <button class="battle-control" :aria-pressed="panel === 'pets'" @click="$emit('panel', 'pets')">
          <BattleGlyph name="switch" />{{ i18next.t('switch', { ns: 'battle' }) }}
        </button>
        <span class="battle-dock__waiting" role="status">{{ waiting ? '已提交 · 等待对手' : '选择下一步行动' }}</span>
      </div>
      <span v-else class="battle-dock__waiting">观战模式</span>
      <div class="battle-dock__tools">
        <button
          class="battle-control battle-control--icon"
          title="战斗日志"
          aria-label="战斗日志"
          :aria-pressed="view.showLogPanel"
          @click="view.toggleLogPanel()"
        >
          <BattleGlyph name="log" />
        </button>
        <label class="battle-motion"
          ><BattleGlyph name="motion" /><span class="sr-only">动效模式</span
          ><select v-model="settings.battleMotion" aria-label="动效模式">
            <option value="standard">标准动效</option>
            <option value="simple">简化动效</option>
            <option value="reduced">减少动态</option>
          </select></label
        >
        <button
          v-if="training"
          class="battle-control battle-control--icon"
          aria-label="训练"
          title="训练"
          @click="$emit('training')"
        >
          <BattleGlyph name="training" />
        </button>
        <button class="battle-control battle-control--icon" title="全屏" aria-label="全屏" @click="$emit('fullscreen')">
          <BattleGlyph name="fullscreen" />
        </button>
      </div>
    </div>
    <div v-if="view.showLogPanel" class="battle-dock__log"><BattleLogPanel /></div>
    <div class="battle-dock__commands">
      <div v-show="panel === 'skills' && !spectator" class="battle-dock__skills">
        <SkillButton
          v-for="skill in skills"
          :key="skill.id"
          :skill="skill"
          :disabled="!skillAvailable(skill.id) || waiting"
          :power-modifier-info="modifier(skill, 'power')"
          :accuracy-modifier-info="modifier(skill, 'accuracy')"
          :rage-modifier-info="modifier(skill, 'rage')"
          :type-effectiveness="effectiveness(skill)"
          @click="$emit('skill', skill.id)"
        />
      </div>
      <div v-show="panel === 'pets' && !spectator" class="battle-dock__pets">
        <PetButton
          v-for="pet in pets"
          :key="pet.id"
          :pet="pet"
          position="bottom"
          :disabled="!petSelectable(pet.id) || waiting"
          @click="$emit('pet', pet.id)"
        />
      </div>
      <div v-if="spectator" class="battle-dock__spectator">
        <BattleGlyph name="shield" /><span>正在观看对战</span
        ><button class="battle-control" @click="$emit('exit')">退出观战</button>
      </div>
    </div>
    <div v-if="!spectator" class="battle-dock__actions">
      <button
        class="battle-control"
        data-testid="do-nothing-button"
        :disabled="!canWait || waiting"
        @click="$emit('wait')"
      >
        <BattleGlyph name="wait" />{{ i18next.t('do-nothing', { ns: 'battle' }) }}
      </button>
      <button
        class="battle-control battle-control--danger"
        data-testid="surrender-button"
        :disabled="!canSurrender"
        @click="$emit('surrender')"
      >
        <BattleGlyph name="flag" />{{ i18next.t('surrunder', { ns: 'battle' }) }}
      </button>
    </div>
  </section>
</template>
