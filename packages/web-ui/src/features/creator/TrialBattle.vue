<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter, isNavigationFailure } from 'vue-router'
import type { NativeWorkSelection } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Nature } from '@arcadia-eternity/const'
import { createCreatorTrialLaunch, takeCreatorTrialLaunch } from '@/services/localBattleSession'
const props = defineProps<{
  beforeLaunch: () => Promise<void>
  selection: NativeWorkSelection
  species: { id: string; label: string; skills: string[]; ability?: string; emblem?: string }[]
}>()
const chosen = ref(props.species[0]?.id ?? '')
const router = useRouter()
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
const error = ref(''),
  busy = ref(false)
async function start() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.beforeLaunch()
    if (disposed) return
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
    const key = createCreatorTrialLaunch({
      selection: props.selection,
      teams: [
        { name: '创作者', pets: [pet] },
        { name: '镜像对手', pets: [pet] },
      ],
    })
    try {
      const failure = await router.push({ name: 'LocalBattle', query: { trialKey: key } })
      if (isNavigationFailure(failure)) throw new Error('未能进入本地对战，请重试')
    } catch (cause) {
      await takeCreatorTrialLaunch(key)?.dispose()
      throw cause
    }
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="trial">
    <h3>试战 · 当前草稿快照</h3>
    <p>使用 100 级临时队伍和镜像对手，进入本地对战配置后可调整规则。编辑草稿后，重新校验试战即可更新。</p>
    <div class="toolbar">
      <label
        >试战精灵<select v-model="chosen">
          <option v-for="pet in species" :key="pet.id" :value="pet.id">{{ pet.label }} · {{ pet.id }}</option>
        </select></label
      ><button :disabled="busy || !chosen" @click="start">开始试战</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
