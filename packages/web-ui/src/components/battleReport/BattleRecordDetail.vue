<template>
  <div class="battle-record-detail">
    <!-- 返回按钮 -->
    <div class="mb-6 flex justify-between items-center">
      <el-button @click="goBack" icon="ArrowLeft">返回列表</el-button>
      <el-button v-if="currentBattleRecord" @click="previewBattle" type="primary" icon="VideoPlay">
        预览战报
      </el-button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading.battleRecord" class="text-center py-12">
      <el-icon class="text-2xl text-blue-500 mb-2">
        <Loading />
      </el-icon>
      <div class="text-gray-600">加载战报详情中...</div>
    </div>

    <!-- 错误状态 -->
    <el-alert v-if="errors.battleRecord" :title="errors.battleRecord" type="error" :closable="false" class="mb-4" />

    <!-- 战报详情 -->
    <div v-if="currentBattleRecord && !loading.battleRecord" class="space-y-6">
      <!-- 基本信息 -->
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <h2 class="text-xl font-bold mb-4">战斗信息</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- 玩家A -->
          <div class="space-y-2">
            <h3 class="font-medium text-gray-800">玩家A</h3>
            <div class="bg-gray-50 p-3 rounded">
              <div class="font-medium">{{ currentBattleRecord.player_a_name }}</div>
              <div class="text-sm text-gray-600">ID: {{ currentBattleRecord.player_a_id }}</div>
            </div>
          </div>

          <!-- 玩家B -->
          <div class="space-y-2">
            <h3 class="font-medium text-gray-800">玩家B</h3>
            <div class="bg-gray-50 p-3 rounded">
              <div class="font-medium">{{ currentBattleRecord.player_b_name }}</div>
              <div class="text-sm text-gray-600">ID: {{ currentBattleRecord.player_b_id }}</div>
            </div>
          </div>
        </div>

        <!-- 战斗结果 -->
        <div class="mt-6 p-4 bg-gray-50 rounded-lg">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium text-gray-800 mb-2">战斗结果</h3>
              <el-tag v-if="currentBattleRecord.battle_result === 'player_a_wins'" type="success" size="large">
                {{ currentBattleRecord.player_a_name }} 胜利
              </el-tag>
              <el-tag v-else-if="currentBattleRecord.battle_result === 'player_b_wins'" type="success" size="large">
                {{ currentBattleRecord.player_b_name }} 胜利
              </el-tag>
              <el-tag v-else-if="currentBattleRecord.battle_result === 'draw'" type="info" size="large"> 平局 </el-tag>
              <el-tag v-else type="warning" size="large"> 未完成 </el-tag>
            </div>

            <div class="text-right text-sm text-gray-600">
              <div>结束原因: {{ getEndReasonText(currentBattleRecord.end_reason) }}</div>
              <div v-if="currentBattleRecord.duration_seconds">
                持续时间: {{ formatDuration(currentBattleRecord.duration_seconds) }}
              </div>
            </div>
          </div>
        </div>

        <!-- 时间信息 -->
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
          <div>
            <span class="font-medium">开始时间:</span>
            {{ formatDate(currentBattleRecord.started_at) }}
          </div>
          <div v-if="currentBattleRecord.ended_at">
            <span class="font-medium">结束时间:</span>
            {{ formatDate(currentBattleRecord.ended_at) }}
          </div>
        </div>
      </div>

      <!-- 战斗消息 -->
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">战斗过程</h2>
          <div class="text-sm text-gray-600">共 {{ currentBattleRecord.battle_messages.length }} 条消息</div>
        </div>

        <div class="max-h-96 overflow-y-auto border border-gray-200 rounded p-4">
          <div
            v-for="(message, index) in currentBattleRecord.battle_messages"
            :key="index"
            class="mb-2 p-2 bg-gray-50 rounded text-sm"
          >
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-medium text-gray-800">{{ getMessageTypeText(message.type) }}</div>
                <div class="text-gray-600 mt-1">
                  {{ formatMessageData(message) }}
                </div>
              </div>
              <div class="text-xs text-gray-500">#{{ message.sequenceId }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 最终状态 -->
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <h2 class="text-xl font-bold mb-4">最终状态</h2>
        <div class="bg-gray-50 p-4 rounded">
          <pre class="text-sm text-gray-700 whitespace-pre-wrap">{{
            JSON.stringify(currentBattleRecord.final_state, null, 2)
          }}</pre>
        </div>
      </div>

      <!-- 元数据 -->
      <div
        v-if="Object.keys(currentBattleRecord.metadata).length > 0"
        class="bg-white border border-gray-200 rounded-lg p-6"
      >
        <h2 class="text-xl font-bold mb-4">元数据</h2>
        <div class="bg-gray-50 p-4 rounded">
          <pre class="text-sm text-gray-700 whitespace-pre-wrap">{{
            JSON.stringify(currentBattleRecord.metadata, null, 2)
          }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { Loading } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const battleReportStore = useBattleReportStore()

const { currentBattleRecord, loading, errors } = storeToRefs(battleReportStore)

// 格式化日期
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString('zh-CN')
}

// 格式化持续时间
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

// 获取结束原因文本
const getEndReasonText = (reason: string) => {
  const reasonMap: Record<string, string> = {
    all_pet_fainted: '所有宠物倒下',
    surrender: '投降',
    timeout: '超时',
    disconnect: '断线',
  }
  return reasonMap[reason] || reason
}

// 获取消息类型文本
const getMessageTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    BattleStart: '战斗开始',
    TurnStart: '回合开始',
    TurnEnd: '回合结束',
    BattleEnd: '战斗结束',
    PetSwitch: '宠物切换',
    PetDefeated: '宠物倒下',
    SkillUse: '使用技能',
    Damage: '造成伤害',
    Heal: '治疗',
    MarkApply: '施加标记',
    MarkExpire: '标记过期',
  }
  return typeMap[type] || type
}

// 格式化消息数据
const formatMessageData = (message: any) => {
  try {
    // 简化显示消息数据
    if (message.data) {
      const data = message.data
      if (data.skill) return `技能: ${data.skill}`
      if (data.damage) return `伤害: ${data.damage}`
      if (data.heal) return `治疗: ${data.heal}`
      if (data.fromPet && data.toPet) return `从 ${data.fromPet} 切换到 ${data.toPet}`
      return JSON.stringify(data)
    }
    return ''
  } catch {
    return '数据解析错误'
  }
}

// 返回列表
const goBack = () => {
  router.push('/battle-reports')
}

// 预览战报
const previewBattle = () => {
  const id = route.params.id as string
  if (id) {
    router.push(`/battle-reports/${id}/preview`)
  }
}

// 加载战报详情
const loadBattleRecord = async () => {
  const id = route.params.id as string
  if (id) {
    await battleReportStore.fetchBattleRecord(id)
  }
}

// 监听路由变化
watch(() => route.params.id, loadBattleRecord, { immediate: true })

onMounted(() => {
  loadBattleRecord()
})
</script>

<style scoped>
.battle-record-detail {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
</style>
