<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  current: number
  max: number
  rage?: number
  reverse?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  rage: 0,
  reverse: false,
})

const healthPercentage = computed(() => {
  return Math.min(100, Math.max(0, (props.current / props.max) * 100))
})

const healthColor = computed(() => {
  const hue = (healthPercentage.value * 120) / 100 // 120° (green) to 0° (red)
  return `hsl(${hue}, 100%, 50%)`
})

const ragePercentage = computed(() => {
  return Math.min(100, Math.max(0, props.rage))
})
</script>

<template>
  <div class="health-rage-container" :class="{ reverse: reverse }">
    <div class="health-bar">
      <div class="health-bg"></div>
      <div
        class="health-value"
        :style="{
          width: `${healthPercentage}%`,
          'background-color': healthColor,
        }"
      ></div>
      <span class="health-text"> {{ current }}/{{ max }} </span>
    </div>

    <div class="rage-bar">
      <div class="rage-bg"></div>
      <div
        class="rage-value"
        :style="{
          width: `${ragePercentage}%`,
          background: `linear-gradient(to right, #ff6b00, #ffcc00)`,
        }"
      ></div>
      <span class="rage-text"> {{ rage }}/100 </span>
    </div>
  </div>
</template>

<style scoped>
.health-rage-container {
  width: 100%;
  position: relative;
  display: block;
  margin: 8px 0;
  overflow: hidden;
}

.health-rage-container.reverse {
  direction: rtl;
}

.health-bar {
  height: 32px;
  width: 100%;
  position: relative;
  margin-bottom: 4px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0% 100%);
}

.health-rage-container.reverse .health-bar {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%);
}

.health-bg {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: #000;
}

.health-value {
  height: 100%;
  transition:
    width 0.3s ease,
    background-color 0.3s ease;
  position: relative;
  clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0% 100%);
}

.health-rage-container.reverse .health-value {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%);
}

.health-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: white;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
  font-size: 20px;
  font-weight: bold;
  width: 100%;
  text-align: center;
  pointer-events: none;
  z-index: 2;
}

.rage-bar {
  position: relative;
  height: 32px;
  width: 100%;
  position: relative;
  clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0% 100%);
}

.health-rage-container.reverse .rage-bar {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%);
}

.rage-bg {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: #000;
}

.rage-value {
  height: 100%;
  transition: width 0.3s ease;
  clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0% 100%);
  position: relative;
}

.health-rage-container.reverse .rage-value {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%);
}

.rage-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: white;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
  font-size: 20px;
  font-weight: bold;
  pointer-events: none;
  z-index: 2;
}
</style>
