<script setup lang="ts">
import { ref } from 'vue'
import DamageDisplay from './DamageDisplay.vue'

// 使用 ref 而不是 data 选项
const value = ref(123)
const type = ref('')
</script>

<template>
  <Story title="DamageDisplay" :layout="{ type: 'grid', width: 800 }">
    <template #controls>
      <div class="p-4 space-y-4">
        <div>
          <label class="block mb-2 text-sm font-medium">伤害值</label>
          <input type="number" v-model.number="value" min="1" class="w-full p-2 border rounded" />
        </div>
        <div>
          <label class="block mb-2 text-sm font-medium">类型</label>
          <select v-model="type" class="w-full p-2 border rounded">
            <option value="">默认</option>
            <option value="blue">蓝色</option>
            <option value="red">红色</option>
          </select>
        </div>
      </div>
    </template>

    <div class="flex justify-center items-center h-full">
      <DamageDisplay :value="value" :type="type" />
    </div>
  </Story>
</template>
