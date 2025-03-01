<template>
  <div class="property-editor">
    <el-form label-width="80px">
      <el-form-item label="效果ID">
        <el-input v-model="localEffect.id" />
      </el-form-item>

      <el-form-item label="触发时机">
        <el-select v-model="localEffect.trigger">
          <el-option v-for="trigger in triggers" :key="trigger" :label="trigger" :value="trigger" />
        </el-select>
      </el-form-item>

      <el-form-item label="优先级">
        <el-input-number v-model="localEffect.priority" />
      </el-form-item>

      <!-- 根据类型显示不同字段 -->
      <template v-if="localEffect.apply.type === 'dealDamage'">
        <el-form-item label="目标选择">
          <target-selector v-model="localEffect.apply.target" />
        </el-form-item>

        <el-form-item label="伤害值">
          <value-input v-model="localEffect.apply.value" />
        </el-form-item>
      </template>

      <!-- 其他效果类型的字段 -->
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Effect } from '@test-battle/schema'

const props = defineProps<{
  effect: Effect
}>()

const emit = defineEmits(['update'])

const localEffect = ref({ ...props.effect })
const triggers = ['OnHit', 'OnDamage', 'BeforeAttack' /* ...其他触发时机 */]

watch(
  localEffect,
  newVal => {
    emit('update', newVal)
  },
  { deep: true },
)
</script>
