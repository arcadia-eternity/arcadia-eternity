<template>
  <div class="battle-record-list">
    <!-- 头部 -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">战报记录</h2>
      <el-button @click="refresh" :loading="loading.battleRecords && battleRecords.length > 0" type="primary">
        刷新
      </el-button>
    </div>

    <!-- 统计信息 -->
    <div v-if="battleStatistics" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-blue-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-blue-600">{{ battleStatistics.total_battles }}</div>
        <div class="text-sm text-gray-600">总战斗数</div>
      </div>
      <div class="bg-green-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-green-600">{{ battleStatistics.total_players }}</div>
        <div class="text-sm text-gray-600">参与玩家</div>
      </div>
      <div class="bg-yellow-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-yellow-600">{{ battleStatistics.battles_today }}</div>
        <div class="text-sm text-gray-600">今日战斗</div>
      </div>
      <div class="bg-purple-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-purple-600">{{ Math.round(battleStatistics.avg_battle_duration) }}s</div>
        <div class="text-sm text-gray-600">平均时长</div>
      </div>
    </div>

    <!-- 错误提示 -->
    <el-alert v-if="errors.battleRecords" :title="errors.battleRecords" type="error" :closable="false" class="mb-4" />

    <!-- 战报列表 -->
    <div class="space-y-4">
      <div
        v-for="record in battleRecords"
        :key="record.id"
        class="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
        @click="viewRecord(record.id)"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <!-- 玩家信息 -->
            <div class="flex items-center space-x-4 mb-2">
              <div class="flex items-center space-x-2">
                <span class="font-medium text-gray-800">{{ record.player_a_name }}</span>
                <span class="text-gray-400">vs</span>
                <span class="font-medium text-gray-800">{{ record.player_b_name }}</span>
              </div>

              <!-- 胜负标识 -->
              <div class="flex items-center">
                <el-tag v-if="record.battle_result === 'player_a_wins'" type="success" size="small">
                  {{ record.player_a_name }} 胜利
                </el-tag>
                <el-tag v-else-if="record.battle_result === 'player_b_wins'" type="success" size="small">
                  {{ record.player_b_name }} 胜利
                </el-tag>
                <el-tag v-else-if="record.battle_result === 'draw'" type="info" size="small"> 平局 </el-tag>
                <el-tag v-else type="warning" size="small"> 未完成 </el-tag>
              </div>
            </div>

            <!-- 战斗信息 -->
            <div class="flex items-center space-x-4 text-sm text-gray-600">
              <span>开始时间: {{ formatDate(record.started_at) }}</span>
              <span v-if="record.duration_seconds"> 持续时间: {{ formatDuration(record.duration_seconds) }} </span>
              <span>结束原因: {{ getEndReasonText(record.end_reason) }}</span>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center space-x-2">
            <el-button size="small" @click.stop="viewRecord(record.id)"> 查看详情 </el-button>
            <el-button size="small" type="primary" @click.stop="previewRecord(record.id)"> 预览战报 </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="battleRecordsPagination.hasMore" class="text-center mt-6">
      <el-button @click="loadMore" :loading="loading.battleRecords" type="primary" plain> 加载更多 </el-button>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading.battleRecords && battleRecords.length === 0" class="text-center py-12">
      <div class="text-gray-400 text-lg mb-2">暂无战报记录</div>
      <div class="text-gray-500 text-sm">开始一场战斗来创建第一个战报吧！</div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading.battleRecords && battleRecords.length === 0" class="text-center py-12">
      <el-icon class="text-2xl text-blue-500 mb-2">
        <Loading />
      </el-icon>
      <div class="text-gray-600">加载中...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { Loading } from '@element-plus/icons-vue'

const router = useRouter()
const battleReportStore = useBattleReportStore()

const { battleRecords, battleStatistics, battleRecordsPagination, loading, errors } = storeToRefs(battleReportStore)

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

// 查看战报详情
const viewRecord = (id: string) => {
  router.push(`/battle-reports/${id}`)
}

// 预览战报
const previewRecord = (id: string) => {
  router.push(`/battle-reports/${id}/preview`)
}

// 刷新数据
const refresh = async () => {
  await Promise.all([battleReportStore.fetchBattleRecords(true), battleReportStore.fetchBattleStatistics()])
}

// 加载更多
const loadMore = () => {
  battleReportStore.loadMoreBattleRecords()
}

// 初始化
onMounted(() => {
  refresh()
})
</script>

<style scoped>
.battle-record-list {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
</style>
