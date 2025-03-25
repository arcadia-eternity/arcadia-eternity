<template>
  <div class="pet-status" :class="{ 'empty-state': !pet }">
    <!-- 正常状态 -->
    <template v-if="pet">
      <div class="pet-name">{{ pet.name }}</div>
      <div class="hp-bar">
        <el-progress
          :percentage="(pet.currentHp / pet.maxHp) * 100"
          :format="() => `${pet!.currentHp}/${pet!.maxHp}`"
          :color="hpColor"
        />
      </div>
      <div class="element">
        <img :src="elementIcon" class="element-icon" :alt="pet.element" @error="handleImageError" />
      </div>

      <div class="effects">
        <div v-for="mark in pet.marks" :key="mark.id" class="field-effect" :title="`剩余${mark.duration}回合`">
          {{ mark.baseId }} × {{ mark.stack }} / {{ mark.duration }}
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="empty-content">
      <el-icon class="empty-icon"><QuestionFilled /></el-icon>
      <div class="empty-text">{{ isOpponent ? '敌方训练师' : '未选择精灵' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import type { PetMessage } from '@test-battle/const'

const props = defineProps<{
  pet?: PetMessage
  isOpponent?: boolean
}>()

const imageError = ref(false)

const hpStatus = computed(() => {
  if (!props.pet) return 'exception'
  return props.pet.currentHp / props.pet.maxHp > 0.3 ? 'success' : 'exception'
})

const hpColor = computed(() => {
  return '#4caf50' // 强制使用绿色
})

const elementIcon = computed(() => {
  if (!props.pet || imageError.value) return '/elements/unknown.png'
  return `/elements/${props.pet.element}.png`
})

const handleImageError = () => {
  imageError.value = true
}
</script>

<style scoped>
.pet-status {
  position: relative;
  min-height: 120px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
}

.empty-icon {
  font-size: 3em;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 0.9em;
}

.pet-name {
  font-size: 1.2em;
  font-weight: 600;
  margin-bottom: 8px;
  color: #4caf50; /* 修改为绿色 */
}

.hp-bar {
  margin-bottom: 12px;
  max-width: 600px;
}

.element {
  position: absolute;
  top: 16px;
  right: 16px;
}

.element-icon {
  width: 32px;
  height: 32px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}
</style>
