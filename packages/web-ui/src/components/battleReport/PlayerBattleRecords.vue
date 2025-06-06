<template>
  <div class="player-battle-records">
    <!-- 返回按钮 -->
    <div class="mb-6">
      <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
    </div>

    <!-- 玩家信息 -->
    <div v-if="currentPlayer" class="bg-white border border-gray-200 rounded-lg p-6 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-gray-800 mb-2">{{ currentPlayer.name }}</h2>
          <div class="text-sm text-gray-600">
            <span>玩家ID: {{ currentPlayer.id }}</span>
            <span class="ml-4">注册时间: {{ formatDate(currentPlayer.created_at) }}</span>
            <span class="ml-4">最后登录: {{ formatDate(currentPlayer.last_login_at) }}</span>
          </div>
        </div>

        <!-- 玩家统计 -->
        <div v-if="currentPlayerStats" class="grid grid-cols-2 gap-4 text-center">
          <div class="bg-blue-50 p-3 rounded">
            <div class="text-lg font-bold text-blue-600">{{ currentPlayerStats.total_battles }}</div>
            <div class="text-xs text-gray-600">总场次</div>
          </div>
          <div class="bg-green-50 p-3 rounded">
            <div class="text-lg font-bold text-green-600">
              {{ Math.round((currentPlayerStats.wins / currentPlayerStats.total_battles) * 100) }}%
            </div>
            <div class="text-xs text-gray-600">胜率</div>
          </div>
          <div class="bg-yellow-50 p-3 rounded">
            <div class="text-lg font-bold text-yellow-600">{{ currentPlayerStats.wins }}</div>
            <div class="text-xs text-gray-600">胜场</div>
          </div>
          <div class="bg-red-50 p-3 rounded">
            <div class="text-lg font-bold text-red-600">{{ currentPlayerStats.losses }}</div>
            <div class="text-xs text-gray-600">负场</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <el-alert
      v-if="errors.playerBattleRecords"
      :title="errors.playerBattleRecords"
      type="error"
      :closable="false"
      class="mb-4"
    />

    <!-- 战报列表 -->
    <div class="bg-white border border-gray-200 rounded-lg">
      <div class="p-4 border-b border-gray-200">
        <h3 class="text-lg font-medium text-gray-800">战斗记录</h3>
      </div>

      <div class="divide-y divide-gray-200">
        <div
          v-for="record in playerBattleRecords"
          :key="record.id"
          class="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
          @click="viewRecord(record.id)"
        >
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <!-- 对手信息 -->
              <div class="flex items-center space-x-4 mb-2">
                <span class="text-gray-600">对战</span>
                <span class="font-medium text-gray-800">{{ record.opponent_name }}</span>

                <!-- 胜负标识 -->
                <el-tag
                  :type="record.is_winner ? 'success' : record.battle_result === 'draw' ? 'info' : 'danger'"
                  size="small"
                >
                  {{ record.is_winner ? '胜利' : record.battle_result === 'draw' ? '平局' : '失败' }}
                </el-tag>
              </div>

              <!-- 战斗信息 -->
              <div class="flex items-center space-x-4 text-sm text-gray-600">
                <span>{{ formatDate(record.started_at) }}</span>
                <span v-if="record.duration_seconds"> 持续: {{ formatDuration(record.duration_seconds) }} </span>
                <span>{{ getBattleResultText(record.battle_result) }}</span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div>
              <el-button size="small" @click.stop="viewRecord(record.id)"> 查看详情 </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载更多 -->
      <div v-if="playerBattleRecordsPagination.hasMore" class="p-4 text-center border-t border-gray-200">
        <el-button @click="loadMore" :loading="loading.playerBattleRecords" type="primary" plain> 加载更多 </el-button>
      </div>

      <!-- 空状态 -->
      <div v-if="!loading.playerBattleRecords && playerBattleRecords.length === 0" class="p-8 text-center">
        <div class="text-gray-400 text-lg mb-2">暂无战斗记录</div>
        <div class="text-gray-500 text-sm">该玩家还没有参与任何战斗</div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading.playerBattleRecords && playerBattleRecords.length === 0" class="text-center py-12">
      <el-icon class="text-2xl text-blue-500 mb-2">
        <Loading />
      </el-icon>
      <div class="text-gray-600">加载中...</div>
    </div>

    <!-- 分页信息 -->
    <div v-if="playerBattleRecords.length > 0" class="mt-4 text-center text-sm text-gray-600">
      显示 {{ playerBattleRecords.length }} / {{ playerBattleRecordsPagination.total }} 条记录
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

const { playerBattleRecords, playerBattleRecordsPagination, currentPlayer, currentPlayerStats, loading, errors } =
  storeToRefs(battleReportStore)

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

// 获取战斗结果文本
const getBattleResultText = (result: string) => {
  const resultMap: Record<string, string> = {
    player_a_wins: '玩家A胜利',
    player_b_wins: '玩家B胜利',
    draw: '平局',
    abandoned: '未完成',
  }
  return resultMap[result] || result
}

// 查看战报详情
const viewRecord = (id: string) => {
  router.push(`/battle-reports/${id}`)
}

// 返回
const goBack = () => {
  router.go(-1)
}

// 加载更多
const loadMore = () => {
  const playerId = route.params.playerId as string
  battleReportStore.fetchPlayerBattleRecords(playerId, false)
}

// 加载玩家数据
const loadPlayerData = async () => {
  const playerId = route.params.playerId as string
  if (playerId) {
    await Promise.all([
      battleReportStore.fetchPlayer(playerId),
      battleReportStore.fetchPlayerStats(playerId),
      battleReportStore.fetchPlayerBattleRecords(playerId, true),
    ])
  }
}

// 监听路由变化
watch(() => route.params.playerId, loadPlayerData, { immediate: true })

onMounted(() => {
  loadPlayerData()
})
</script>

<style scoped>
.player-battle-records {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
</style>
