<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, useId, useTemplateRef, watch, type Ref } from 'vue'
import { useMediaQuery, useMutationObserver } from '@vueuse/core'
import ModifiedValue from './ModifiedValue.vue'
import BattleBarNumber from './BattleBarNumber.vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'
import { analyzeModifierType } from '@/utils/modifierStyles'
const props = withDefaults(
  defineProps<{
    current: number
    max: number
    rage?: number
    maxRage?: number
    reverse?: boolean
    currentHpModifierInfo?: AttributeModifierInfo<number>
    maxHpModifierInfo?: AttributeModifierInfo<number>
    rageModifierInfo?: AttributeModifierInfo<number>
    maxRageModifierInfo?: AttributeModifierInfo<number>
  }>(),
  { rage: 0, maxRage: 100, reverse: false },
)

const emptyFrame = 40
const frameDuration = 1000 / 24
function targetFrame(value: number, max: number) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return Math.trunc(emptyFrame - ratio * (emptyFrame - 1))
}

const root = useTemplateRef('root')
const shell = ref<HTMLElement | null>(null)
const shellMotion = ref<string>()
function readShellMotion() {
  shellMotion.value = shell.value?.dataset.motion
}
onMounted(() => {
  shell.value = root.value?.closest<HTMLElement>('.battle-shell') ?? null
  readShellMotion()
})
useMutationObserver(shell, readShellMotion, { attributes: true, attributeFilter: ['data-motion'] })
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const jump = computed(() => prefersReducedMotion.value || ['simple', 'reduced'].includes(shellMotion.value ?? ''))

function useMeterTimeline(target: Readonly<Ref<number>>, queueTargets = false) {
  const frame = ref(target.value)
  const queue: number[] = []
  let animation: number | undefined
  let lastTick = 0

  function stop() {
    if (animation !== undefined) cancelAnimationFrame(animation)
    animation = undefined
    queue.length = 0
  }

  // Move at the original 24 frames per second, interpolated on every display refresh.
  function advance(now: number) {
    animation = undefined
    let budget = Math.max(0, now - lastTick) / frameDuration
    lastTick = now
    let position = frame.value
    while (queue.length && budget > 0) {
      const distance = queue[0] - position
      const step = Math.min(Math.abs(distance), budget)
      position += Math.sign(distance) * step
      budget -= step
      if (Math.abs(queue[0] - position) < 1e-6) position = queue.shift()!
    }
    frame.value = position
    if (queue.length) animation = requestAnimationFrame(advance)
  }

  watch([target, jump], ([next, skip]) => {
    if (skip) {
      stop()
      frame.value = next
      return
    }
    if (!queueTargets) queue.length = 0
    if (next !== (queue.at(-1) ?? frame.value)) queue.push(next)
    if (queue.length && animation === undefined) {
      lastTick = performance.now()
      animation = requestAnimationFrame(advance)
    }
  })
  onScopeDispose(stop)
  return computed(() => (jump.value ? target.value : frame.value))
}

const hpFrame = useMeterTimeline(computed(() => targetFrame(props.current, props.max)))
const rageFrame = useMeterTimeline(
  computed(() => targetFrame(props.rage, props.maxRage)),
  true,
)
const gradientId = useId()

// The scale deltas in #369 and #647 are linear to subpixel precision. The HP
// color transform uses the authored per-frame multipliers and green offsets.
const hpMultipliers = [256, 244, 236, 229, 223, 219, 214, 210, 206, 201, 195, 188, 179, 167, 147, 118, 81, 45, 18]
const hpGreen = [255, 242, 228, 215, 201, 188, 174, 161, 148, 134, 121, 107, 94, 81, 67, 54, 40, 27, 13, 0]

function frameColors(frame: number, kind: 'hp' | 'rage') {
  if (kind === 'hp') {
    if (frame >= 20) {
      const color = [255, hpGreen[frame - 20], 0]
      return [color, color]
    }
    const multiplier = hpMultipliers[frame - 1]
    return [
      transformColor([119, 226, 12], multiplier, 256 - multiplier, 256 - multiplier),
      transformColor([194, 254, 154], multiplier, 256 - multiplier, 256 - multiplier),
    ]
  }
  const progress = (frame - 1) / 38
  const multiplier = Math.round(256 * (1 - progress))
  const red = Math.round(255 * progress)
  return [transformColor([248, 121, 7], multiplier, red, 0), transformColor([255, 255, 0], multiplier, red, 0)]
}

function transformColor(base: number[], multiplier: number, red: number, green: number) {
  const add = [red, green, 0]
  return base.map((value, index) => Math.min(255, (value * multiplier) / 256 + add[index]))
}

// Blend the authored colors of the two neighbouring frames.
function fillColors(position: number, kind: 'hp' | 'rage') {
  const from = Math.floor(position)
  const to = Math.min(emptyFrame - 1, from + 1)
  const weight = position - from
  const [a, b] = [frameColors(from, kind), frameColors(to, kind)]
  return a.map(
    (color, stop) =>
      `rgb(${color.map((value, index) => Math.round(value + (b[stop][index] - value) * weight)).join(', ')})`,
  )
}

const meters = computed(() =>
  (
    [
      {
        kind: 'hp',
        name: '生命值',
        current: props.current,
        max: props.max,
        frame: hpFrame.value,
        width: 306,
        height: 18,
        fullScale: 0.9629822,
        lastScale: 0.007675171,
        shape: 'M0 3 8 0H316L318 4 305 18H0Z',
        modifier: analyzeModifierType(props.currentHpModifierInfo, 'currentHp'),
        currentInfo: props.currentHpModifierInfo,
        maxInfo: props.maxHpModifierInfo,
      },
      {
        kind: 'rage',
        name: '怒气',
        current: props.rage,
        max: props.maxRage,
        frame: rageFrame.value,
        width: 294,
        height: 12.25,
        fullScale: 1,
        lastScale: 0.004043579,
        shape: 'M0 3 6 0H294L291 6 285 12.25H0Z',
        modifier: analyzeModifierType(props.rageModifierInfo, 'currentRage'),
        currentInfo: props.rageModifierInfo,
        maxInfo: props.maxRageModifierInfo,
      },
    ] as const
  ).map(meter => {
    const position = Math.min(meter.frame, emptyFrame - 1)
    return {
      ...meter,
      empty: meter.frame >= emptyFrame,
      scale: meter.fullScale - ((meter.fullScale - meter.lastScale) * (position - 1)) / 38,
      colors: meter.frame >= emptyFrame ? [] : fillColors(position, meter.kind),
    }
  }),
)
</script>
<template>
  <div ref="root" class="battle-bars" :class="{ 'battle-bars--reverse': reverse }">
    <div v-for="meter in meters" :key="meter.kind" class="battle-bars__row" :class="`battle-bars__row--${meter.kind}`">
      <span class="battle-bars__label" aria-hidden="true">{{ meter.kind === 'hp' ? 'HP' : '怒' }}</span>
      <div
        class="battle-bars__track"
        role="meter"
        :aria-label="meter.name"
        :aria-valuenow="meter.current"
        :aria-valuemin="0"
        :aria-valuemax="meter.max"
        :data-modifier="meter.modifier"
      >
        <svg
          class="battle-bars__visual"
          :width="meter.width"
          :height="meter.height"
          :data-frame="Math.round(meter.frame)"
          aria-hidden="true"
        >
          <defs v-if="!meter.empty">
            <linearGradient :id="`${gradientId}-${meter.kind}`" x2="0" y2="1">
              <stop offset="0" :stop-color="meter.colors[1]" />
              <stop offset=".42" :stop-color="meter.colors[0]" />
              <stop offset="1" :stop-color="meter.colors[0]" />
            </linearGradient>
          </defs>
          <path
            v-if="!meter.empty"
            class="battle-bars__fill"
            :d="meter.shape"
            :fill="`url(#${gradientId}-${meter.kind})`"
            :transform="`scale(${meter.scale} 1)`"
          />
        </svg>
        <span class="battle-bars__value">
          <ModifiedValue :value="meter.current" :attribute-info="meter.currentInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" :kind="meter.kind" /></template>
          </ModifiedValue>
          <BattleBarNumber value="/" :kind="meter.kind" />
          <ModifiedValue :value="meter.max" :attribute-info="meter.maxInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" :kind="meter.kind" /></template>
          </ModifiedValue>
        </span>
      </div>
    </div>
  </div>
</template>
<style scoped>
.battle-bars {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.battle-bars__row {
  position: absolute;
  inset-inline: 0;
  top: 10px;
  --fill-anchor: 111px;
  --value-top: 3px;
  --meter-width: 306px;
  --meter-height: 18px;
}
.battle-bars__row--rage {
  top: 33px;
  --fill-anchor: 110px;
  --value-top: 0px;
  --meter-width: 294px;
  --meter-height: 12.25px;
}
.battle-bars__label {
  position: absolute;
  left: 85px;
  top: -1px;
  width: 22px;
  color: #76e20c;
  font:
    italic 900 13px/1.2 system-ui,
    sans-serif;
  text-align: center;
  text-shadow: 0 1px 2px #111827;
}
.battle-bars__track {
  position: absolute;
  left: var(--fill-anchor);
  top: 0;
  width: var(--meter-width);
  height: var(--meter-height);
}
.battle-bars__visual {
  display: block;
  overflow: hidden;
}
.battle-bars__value {
  position: absolute;
  left: 50%;
  top: var(--value-top);
  display: grid;
  grid-template-columns: 1fr 12px 1fr;
  align-items: center;
  width: 128px;
  transform: translateX(-50%);
  font-size: 12px;
  line-height: 1;
  color: #fff;
}
.battle-bars__value > :first-child {
  text-align: right;
}
.battle-bars__value :deep(span) {
  font-size: inherit;
  line-height: 1;
}
.battle-bars__row--rage .battle-bars__label {
  color: #ff9832;
  font-size: 12px;
  font-style: normal;
}
.battle-bars--reverse .battle-bars__track {
  left: auto;
  right: var(--fill-anchor);
}
.battle-bars--reverse .battle-bars__visual {
  scale: -1 1;
}
.battle-bars--reverse .battle-bars__label {
  left: 322px;
}
</style>
