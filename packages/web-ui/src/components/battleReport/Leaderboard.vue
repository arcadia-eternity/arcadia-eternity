<template>
  <div class="leaderboard">
    <!-- 头部 -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">排行榜</h2>
      <el-button @click="refresh" :loading="loading.leaderboard" type="primary">
        刷新
      </el-button>
    </div>

    <!-- 错误提示 -->
    <el-alert
      v-if="errors.leaderboard"
      :title="errors.leaderboard"
      type="error"
      :closable="false"
      class="mb-4"
    />

    <!-- 排行榜表格 -->
    <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <el-table
        :data="leaderboard"
        v-loading="loading.leaderboard"
        stripe
        style="width: 100%"
      >
        <el-table-column label="排名" width="80" align="center">
          <template #default="{ $index }">
            <div class="flex items-center justify-center">
              <el-icon v-if="$index === 0" class="text-yellow-500 text-lg">
                <Trophy />
              </el-icon>
              <el-icon v-else-if="$index === 1" class="text-gray-400 text-lg">
                <Medal />
              </el-icon>
              <el-icon v-else-if="$index === 2" class="text-orange-600 text-lg">
                <Medal />
              </el-icon>
              <span v-else class="font-medium">{{ $index + 1 }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="玩家" min-width="150">
          <template #default="{ row }">
            <div class="flex items-center space-x-2">
              <div>
                <div class="font-medium text-gray-800">{{ row.player_name }}</div>
                <div class="text-xs text-gray-500">{{ row.player_id }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="总场次" width="100" align="center">
          <template #default="{ row }">
            <span class="font-medium">{{ row.total_battles }}</span>
          </template>
        </el-table-column>

        <el-table-column label="胜场" width="100" align="center">
          <template #default="{ row }">
            <span class="font-medium text-green-600">{{ row.wins }}</span>
          </template>
        </el-table-column>

        <el-table-column label="负场" width="100" align="center">
          <template #default="{ row }">
            <span class="font-medium text-red-600">{{ row.losses }}</span>
          </template>
        </el-table-column>

        <el-table-column label="平局" width="100" align="center">
          <template #default="{ row }">
            <span class="font-medium text-gray-600">{{ row.draws }}</span>
          </template>
        </el-table-column>

        <el-table-column label="胜率" width="120" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center space-x-2">
              <span class="font-medium" :class="getWinRateColor(row.win_rate)">
                {{ row.win_rate }}%
              </span>
              <el-progress
                :percentage="row.win_rate"
                :show-text="false"
                :stroke-width="6"
                :color="getProgressColor(row.win_rate)"
                style="width: 40px"
              />
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              @click="viewPlayerRecords(row.player_id)"
              type="primary"
              link
            >
              查看战报
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 加载更多 -->
    <div v-if="leaderboardPagination.hasMore" class="text-center mt-6">
      <el-button
        @click="loadMore"
        :loading="loading.leaderboard"
        type="primary"
        plain
      >
        加载更多
      </el-button>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading.leaderboard && leaderboard.length === 0" class="text-center py-12">
      <div class="text-gray-400 text-lg mb-2">暂无排行榜数据</div>
      <div class="text-gray-500 text-sm">还没有玩家参与战斗</div>
    </div>

    <!-- 分页信息 -->
    <div v-if="leaderboard.length > 0" class="mt-4 text-center text-sm text-gray-600">
      显示 {{ leaderboard.length }} / {{ leaderboardPagination.total }} 名玩家
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { Trophy, Medal } from '@element-plus/icons-vue'

const router = useRouter()
const battleReportStore = useBattleReportStore()

const {
  leaderboard,
  leaderboardPagination,
  loading,
  errors
} = storeToRefs(battleReportStore)

// 获取胜率颜色
const getWinRateColor = (winRate: number) => {
  if (winRate >= 80) return 'text-green-600'
  if (winRate >= 60) return 'text-blue-600'
  if (winRate >= 40) return 'text-yellow-600'
  return 'text-red-600'
}

// 获取进度条颜色
const getProgressColor = (winRate: number) => {
  if (winRate >= 80) return '#10b981'
  if (winRate >= 60) return '#3b82f6'
  if (winRate >= 40) return '#f59e0b'
  return '#ef4444'
}

// 查看玩家战报
const viewPlayerRecords = (playerId: string) => {
  router.push(`/players/${playerId}/battles`)
}

// 刷新数据
const refresh = async () => {
  await battleReportStore.fetchLeaderboard(true)
}

// 加载更多
const loadMore = () => {
  battleReportStore.fetchLeaderboard(false)
}

// 初始化
onMounted(() => {
  refresh()
})
</script>

<style scoped>
.leaderboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

:deep(.el-table .el-table__row:first-child) {
  background-color: #fef3c7;
}

:deep(.el-table .el-table__row:nth-child(2)) {
  background-color: #f3f4f6;
}

:deep(.el-table .el-table__row:nth-child(3)) {
  background-color: #fef2f2;
}
</style>
