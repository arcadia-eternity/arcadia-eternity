<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useElementSize, usePreferredReducedMotion } from '@vueuse/core'
import type { PetMessage, PlayerMessage } from '@arcadia-eternity/const'
import type { PreparationTask } from '@/composition/useBattlePreparation'
import { useSound } from '@/composition/sound'
import { useGameDataStore } from '@/stores/gameData'
import backdrop from '@/assets/battle/loading/backdrop.svg'
import tipStrip from '@/assets/battle/loading/tip-strip.svg'
import shade from '@/assets/battle/loading/shade.svg'
import band from '@/assets/battle/loading/band.svg'
import glass from '@/assets/battle/loading/glass.svg'
import flash from '@/assets/battle/loading/flash.svg'
import versus from '@/assets/battle/loading/vs.svg'
// Trusted repository asset; its stroke uses currentColor for the authored tint.
import versusOutline from '@/assets/battle/loading/vs-outline.svg?raw'
import gear from '@/assets/battle/loading/gear.svg'
import spark from '@/assets/battle/loading/spark.svg'
import levelSign from '@/assets/battle/loading/level-sign.svg'
import percentSign from '@/assets/battle/loading/percent.svg'
import ElementIcon from './ElementIcon.vue'
import PetIcon from '../PetIcon.vue'

const props = defineProps<{
  left?: PlayerMessage | null
  right?: PlayerMessage | null
  tasks: PreparationTask[]
  progress: number
  error: string | null
  replay?: boolean
  motion?: 'standard' | 'simple' | 'reduced'
}>()
const emit = defineEmits<{ retry: []; exit: []; finished: [] }>()
const data = useGameDataStore()
const { playLoadingSound } = useSound()
const preferredMotion = usePreferredReducedMotion()
const animate = computed(() => preferredMotion.value !== 'reduce' && (!props.motion || props.motion === 'standard'))
// #572 closes when its vanish label (frame 56) reaches frame 81, at 24 fps.
const exitDuration = computed(() => (animate.value ? Math.round((25 * 1000) / 24) : 140))
// The entrance reaches its frame-40 resting state after 1,625 ms; hold the matchup briefly before vanishing.
const minimumDwell = computed(() => (animate.value ? 1625 + 875 : 0))

// The original client scales its 1200×660 loader independently on each axis.
const root = useTemplateRef<HTMLElement>('root')
const { width, height } = useElementSize(root)
const stageScale = computed(() => `scale(${(width.value || 1200) / 1200}, ${(height.value || 660) / 660})`)

const digitGlyphs = import.meta.glob<string>('../../assets/battle/loading/digit-*.svg', {
  import: 'default',
  eager: true,
})
const gears = [
  'matrix(.9982,.05997,-.05997,.9982,48.7,.2)',
  'matrix(.5517,-.0652,.0652,.5517,-1.5,7.15)',
  'matrix(-.99754,-.07005,-.07005,.99754,60.9,32.5)',
]

function petIcon(pet?: PetMessage) {
  const species = pet && !pet.isUnknown ? data.getSpecies(pet.speciesID) : undefined
  return { id: species?.num ?? 0, species, isUnknown: !pet || pet.isUnknown }
}

const teams = computed(() =>
  [props.left, props.right].map(player => {
    const [lead, ...reserves] = player?.team ?? []
    return {
      name: player?.name ?? '等待玩家',
      level: lead && !lead.isUnknown && lead.level > 0 ? lead.level : undefined,
      element: lead && !lead.isUnknown ? lead.element : undefined,
      lead: petIcon(lead),
      reserves: reserves.map(pet => ({ key: pet.id, icon: petIcon(pet) })),
    }
  }),
)
const tips = ['留意怒气消耗与属性相性，把握释放必杀的时机。', '出手慢时，试试先制技能。', '遇到不利属性时，考虑换宠。']
const tipIndex = ref(0)
let tipTimer: ReturnType<typeof setInterval> | undefined
const heading = computed(() => (props.replay ? '战斗回放' : '准备对战'))
const status = computed(() => {
  if (props.error) return '准备失败'
  if (props.progress >= 100) return '准备完成'
  return props.tasks.find(task => task.state === 'loading')?.label ?? '正在准备战场'
})

const shownProgress = ref(0)
const exiting = ref(false)
let exitCuePlayed = false
// Three right-aligned slots with leading zeroes hidden, as in the original counter.
const digits = computed(() => {
  const value = String(shownProgress.value).padStart(3, ' ')
  return [...value].map(char =>
    char === ' ' ? undefined : { char, src: digitGlyphs[`../../assets/battle/loading/digit-${char}.svg`] },
  )
})

watch(
  () => props.progress,
  progress => {
    if (Number.isFinite(progress))
      shownProgress.value = Math.max(shownProgress.value, Math.min(100, Math.floor(progress)))
  },
  { immediate: true },
)

const dwellElapsed = ref(false)
const dwellRun = ref(0)
let dwellStart = Date.now()
watch(
  [minimumDwell, dwellRun],
  ([dwell], _, onCleanup) => {
    const remaining = dwellStart + dwell - Date.now()
    dwellElapsed.value = remaining <= 0
    if (remaining <= 0) return
    const timer = setTimeout(() => (dwellElapsed.value = true), remaining)
    onCleanup(() => clearTimeout(timer))
  },
  { immediate: true },
)

function restart() {
  shownProgress.value = 0
  dwellStart = Date.now()
  dwellRun.value++
  emit('retry')
}

onMounted(() => {
  if (!props.error) playLoadingSound('enter')
  tipTimer = setInterval(() => {
    tipIndex.value = (tipIndex.value + 1) % tips.length
  }, 3000)

  watch(
    [() => props.progress, () => props.error, exitDuration, dwellElapsed],
    ([progress, error, duration, elapsed], _, onCleanup) => {
      const ready = Number.isFinite(progress) && progress >= 100 && !error
      exiting.value = ready && (exiting.value || elapsed)
      if (!exiting.value) return
      if (!exitCuePlayed) {
        exitCuePlayed = true
        playLoadingSound('vanish')
      }
      const exitTimer = setTimeout(() => emit('finished'), duration)
      onCleanup(() => clearTimeout(exitTimer))
    },
    { immediate: true },
  )
})
onUnmounted(() => clearInterval(tipTimer))
</script>

<template>
  <section
    ref="root"
    class="battle-loading"
    :class="{ 'battle-loading--animated': animate, 'battle-loading--exiting': exiting }"
    :style="{ '--loading-exit-duration': `${exitDuration}ms` }"
    data-testid="battle-loading-overlay"
    :aria-busy="!error && !exiting"
    :aria-label="heading"
  >
    <div class="battle-loading__stage" :style="{ transform: stageScale }">
      <h1 class="sr-only">{{ heading }}</h1>
      <img class="battle-loading__backdrop" :src="backdrop" alt="" />

      <div v-if="!error" class="battle-loading__animation" aria-hidden="true">
        <img class="battle-loading__shade" :src="shade" alt="" />
        <div class="battle-loading__band-mask"><img :src="band" alt="" /></div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="battle-loading__outline"><span v-html="versusOutline"></span></div>
        <img class="battle-loading__flash" :src="flash" alt="" />
        <div class="battle-loading__glass battle-loading__glass--left"><img :src="glass" alt="" /></div>
        <div class="battle-loading__glass battle-loading__glass--right"><img :src="glass" alt="" /></div>
        <div class="battle-loading__gears">
          <div v-for="matrix in gears" :key="matrix" :style="{ transform: matrix }">
            <img :src="gear" alt="" />
          </div>
        </div>
        <div class="battle-loading__spark"><img :src="spark" alt="" /></div>
        <div class="battle-loading__versus"><img :src="versus" alt="" /></div>
      </div>

      <div
        class="battle-loading__progress"
        role="progressbar"
        aria-label="战斗准备进度"
        :aria-valuenow="shownProgress"
        :aria-valuetext="`${shownProgress}%`"
        :aria-valuemin="0"
        :aria-valuemax="100"
      >
        <template v-for="(digit, index) in digits" :key="index">
          <img
            v-if="digit"
            class="battle-loading__digit"
            :style="{ left: `${565.55 + 23 * index}px` }"
            :data-digit="digit.char"
            :src="digit.src"
            alt=""
          />
        </template>
        <img class="battle-loading__percent" :src="percentSign" alt="" />
      </div>

      <div v-if="!error" class="battle-loading__matchup">
        <article
          v-for="(team, side) in teams"
          :key="side"
          class="battle-loading__fighter"
          :class="`battle-loading__fighter--${side ? 'right' : 'left'}`"
        >
          <h2 :title="team.name">{{ team.name }}</h2>
          <img class="battle-loading__level-sign" :src="levelSign" alt="" />
          <span v-if="team.level !== undefined" class="battle-loading__level" :aria-label="`等级 ${team.level}`">{{
            team.level
          }}</span>
          <div class="battle-loading__portrait"><PetIcon v-bind="team.lead" :reverse="side === 1" /></div>
          <ElementIcon v-if="team.element" class="battle-loading__element" :element="team.element" :size="20" />
          <ul v-if="team.reserves.length" class="battle-loading__reserves" :aria-label="`${team.name}后备精灵`">
            <li v-for="pet in team.reserves" :key="pet.key"><PetIcon v-bind="pet.icon" :reverse="side === 1" /></li>
          </ul>
        </article>
      </div>

      <div v-if="!error" class="battle-loading__tip">
        <img :src="tipStrip" alt="" />
        <p>小贴士:{{ tips[tipIndex] }}</p>
      </div>

      <div class="battle-loading__readiness">
        <span class="sr-only" role="status">{{ status }}</span>
        <ol class="battle-loading__tasks">
          <li v-for="task in tasks" :key="task.id" :data-state="task.state">
            <span class="battle-loading__dot" aria-hidden="true"></span>{{ task.label }}
            <span v-if="task.state === 'degraded'" class="battle-loading__degraded">简化显示</span>
          </li>
        </ol>
      </div>

      <div v-if="error" class="battle-loading__error" role="alert">
        <p>{{ error }}</p>
        <button type="button" class="battle-control" @click="restart">重试</button>
        <button type="button" class="battle-control" @click="emit('exit')">返回</button>
      </div>
    </div>
  </section>
</template>
