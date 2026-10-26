<script setup lang="ts">
import { ref, shallowRef, onBeforeUnmount } from 'vue'
import type { NativeWorkSelection } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Nature } from '@arcadia-eternity/const'
import type { BattleState, PlayerSelection } from '@arcadia-eternity/const'
import type { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { createNativeWebBattleSystem } from '@/services/nativeBattleFactory'
const props = defineProps<{
  selection: NativeWorkSelection
  species: { id: string; label: string; skills: string[]; ability?: string; emblem?: string }[]
}>()
const chosen = ref(props.species[0]?.id ?? '')
const state = shallowRef<BattleState>()
const actions = shallowRef<PlayerSelection[]>([])
const error = ref(''),
  busy = ref(false)
let system: LocalBattleSystemV4 | undefined,
  generation = 0
async function stop() {
  generation++
  const previous = system
  system = undefined
  actions.value = []
  state.value = undefined
  await previous?.cleanup()
}
onBeforeUnmount(() => {
  void stop()
})
async function refresh(current: LocalBattleSystemV4) {
  const pending = await current.waitForPendingDecision()
  const next = await current.getState(undefined, true)
  if (system !== current) return
  state.value = next
  actions.value = pending.selections[0].filter(action => action.type !== 'surrender')
}
async function start() {
  busy.value = true
  error.value = ''
  try {
    await stop()
    const token = generation
    const species = props.species.find(item => item.id === chosen.value)
    if (!species?.skills.length) throw new Error('请为精灵配置至少一个可学技能')
    const pet = {
      id: 'preview-pet',
      name: species.label,
      species: species.id,
      level: 100,
      nature: Nature.Hardy,
      skills: species.skills.slice(0, 4),
      ...(species.ability ? { ability: species.ability } : {}),
      ...(species.emblem ? { emblem: species.emblem } : {}),
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as PetSchemaType
    const empty = { allIds: [], byId: {} }
    const current = await createNativeWebBattleSystem(
      { name: '创作者', team: [pet] },
      { name: '镜像对手', team: [pet] },
      { species: empty, skills: empty, marks: empty },
      {
        works: props.selection,
        rngSeed: 'creator-preview',
        timerConfig: { enabled: false },
        ai: { enabled: true, players: ['playerB'] },
      },
    )
    if (token !== generation) {
      await current.cleanup()
      return
    }
    system = current
    await current.ready()
    await refresh(current)
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value)
  } finally {
    busy.value = false
  }
}
async function act(action: PlayerSelection) {
  const current = system
  if (!current) return
  busy.value = true
  try {
    await current.submitAction(action)
    await refresh(current)
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value)
  } finally {
    busy.value = false
  }
}
function label(action: PlayerSelection) {
  if (action.type === 'use-skill')
    return (
      state.value?.players[0]?.team?.flatMap(pet => pet.skills ?? []).find(skill => skill.id === action.skill)
        ?.baseId ?? '技能'
    )
  return action.type === 'do-nothing' ? '等待' : '换上精灵'
}
</script>
<template>
  <section class="trial">
    <h3>试战 · 当前草稿快照</h3>
    <p>100 级镜像对手，使用精灵的前四个可学技能。编辑草稿后，重新校验试战即可更新。</p>
    <div class="toolbar">
      <label
        >试战精灵<select v-model="chosen">
          <option v-for="pet in species" :key="pet.id" :value="pet.id">{{ pet.label }} · {{ pet.id }}</option>
        </select></label
      ><button :disabled="busy || !chosen" @click="start">开始试战</button
      ><button :disabled="busy || !state" @click="stop">结束试战</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="state" data-testid="creator-battle">
      <p>已完成 {{ state.currentTurn }} 回合 · {{ state.status === 'Ended' ? '已结束' : '选择行动' }}</p>
      <div class="fields">
        <article v-for="player in state.players" :key="player.id">
          <h4>{{ player.name }}</h4>
          <div v-for="pet in player.team" :key="pet.id">
            <strong>{{ pet.name }}</strong>
            <p>生命 {{ pet.currentHp }} / {{ pet.maxHp }}</p>
            <p v-for="mark in pet.marks" :key="mark.id">{{ mark.baseId }} × {{ mark.stack }}</p>
          </div>
        </article>
      </div>
      <div class="toolbar">
        <button v-for="(action, index) in actions" :key="index" :disabled="busy" @click="act(action)">
          {{ label(action) }}
        </button>
      </div>
    </div>
  </section>
</template>
