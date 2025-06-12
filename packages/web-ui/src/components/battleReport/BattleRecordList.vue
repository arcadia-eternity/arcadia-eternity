<template>
  <div class="battle-record-list">
    <!-- 头部 -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">{{ $t('battleReport.title', { ns: 'webui' }) }}</h2>
      <el-button @click="refresh" :loading="loading.battleRecords && battleRecords.length > 0" type="primary">
        {{ $t('battleReport.refresh', { ns: 'webui', defaultValue: '刷新' }) }}
      </el-button>
    </div>

    <!-- 统计信息 -->
    <div v-if="battleStatistics" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-blue-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-blue-600">{{ battleStatistics.total_battles }}</div>
        <div class="text-sm text-gray-600">{{ $t('battleReport.totalBattles', { ns: 'webui' }) }}</div>
      </div>
      <div class="bg-green-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-green-600">{{ battleStatistics.total_players }}</div>
        <div class="text-sm text-gray-600">{{ $t('battleReport.totalPlayers', { ns: 'webui' }) }}</div>
      </div>
      <div class="bg-yellow-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-yellow-600">{{ battleStatistics.battles_today }}</div>
        <div class="text-sm text-gray-600">{{ $t('battleReport.battlesToday', { ns: 'webui' }) }}</div>
      </div>
      <div class="bg-purple-50 p-4 rounded-lg">
        <div class="text-2xl font-bold text-purple-600">{{ Math.round(battleStatistics.avg_battle_duration) }}s</div>
        <div class="text-sm text-gray-600">{{ $t('battleReport.avgDuration', { ns: 'webui' }) }}</div>
      </div>
    </div>

    <!-- 七天有效期提示 -->
    <el-alert
      :title="$t('battleReport.expirationNotice', { ns: 'webui' })"
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
    />

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
                  {{ record.player_a_name }} {{ $t('battleReport.playerResult.win', { ns: 'webui' }) }}
                </el-tag>
                <el-tag v-else-if="record.battle_result === 'player_b_wins'" type="success" size="small">
                  {{ record.player_b_name }} {{ $t('battleReport.playerResult.win', { ns: 'webui' }) }}
                </el-tag>
                <el-tag v-else-if="record.battle_result === 'draw'" type="info" size="small">
                  {{ $t('battleReport.playerResult.draw', { ns: 'webui' }) }}
                </el-tag>
                <el-tag v-else type="warning" size="small">
                  {{ $t('battleReport.battleResult.abandoned', { ns: 'webui' }) }}
                </el-tag>
              </div>
            </div>

            <!-- 战斗信息 -->
            <div class="flex items-center space-x-4 text-sm text-gray-600">
              <span>{{ $t('battleReport.startTime', { ns: 'webui' }) }}: {{ formatDate(record.started_at) }}</span>
              <span v-if="record.duration_seconds">
                {{ $t('battleReport.duration', { ns: 'webui' }) }}: {{ formatDuration(record.duration_seconds) }}
              </span>
              <span
                >{{ $t('battleReport.endReason', { ns: 'webui' }) }}: {{ getEndReasonText(record.end_reason) }}</span
              >
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center space-x-2">
            <el-button size="small" @click.stop="viewRecord(record.id)">
              {{ $t('battleReport.viewDetail', { ns: 'webui' }) }}
            </el-button>
            <el-button size="small" type="primary" @click.stop="previewRecord(record.id)">
              {{ $t('battleReport.preview', { ns: 'webui' }) }}
            </el-button>
            <el-dropdown @command="command => handleShareCommand(command, record)" trigger="click" @click.stop>
              <el-button size="small" type="success" icon="Share">
                {{ $t('battleReport.share', { ns: 'webui' }) }}
                <el-icon class="el-icon--right">
                  <ArrowDown />
                </el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="share-detail" icon="Link">
                    {{ $t('battleReport.shareDetail', { ns: 'webui', defaultValue: '分享详情' }) }}
                  </el-dropdown-item>
                  <el-dropdown-item command="share-preview" icon="VideoPlay">
                    {{ $t('battleReport.sharePreview', { ns: 'webui', defaultValue: '分享回放' }) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="battleRecordsPagination.hasMore" class="text-center mt-6">
      <el-button @click="loadMore" :loading="loading.battleRecords" type="primary" plain>
        {{ $t('battleReport.loadMore', { ns: 'webui' }) }}
      </el-button>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading.battleRecords && battleRecords.length === 0" class="text-center py-12">
      <div class="text-gray-400 text-lg mb-2">{{ $t('battleReport.noRecords', { ns: 'webui' }) }}</div>
      <div class="text-gray-500 text-sm">
        {{ $t('battleReport.noRecordsHint', { ns: 'webui', defaultValue: '开始一场战斗来创建第一个战报吧！' }) }}
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading.battleRecords && battleRecords.length === 0" class="text-center py-12">
      <el-icon class="text-2xl text-blue-500 mb-2">
        <Loading />
      </el-icon>
      <div class="text-gray-600">{{ $t('battleReport.loading', { ns: 'webui', defaultValue: '加载中...' }) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { Loading, ArrowDown } from '@element-plus/icons-vue'
import { ShareUtils } from '@/utils/share'
import type { BattleRecord } from '@/services/battleReportService'
import i18next from 'i18next'

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
  return i18next.t(`battleReport.endReasons.${reason}`, {
    ns: 'webui',
    defaultValue: reason,
  })
}

// 查看战报详情
const viewRecord = (id: string) => {
  router.push(`/battle-reports/${id}`)
}

// 预览战报
const previewRecord = (id: string) => {
  router.push(`/battle-reports/${id}/preview`)
}

// 处理分享命令
const handleShareCommand = (command: string, record: BattleRecord) => {
  const battleId = record.id
  const playerAName = record.player_a_name
  const playerBName = record.player_b_name

  switch (command) {
    case 'share-detail':
      ShareUtils.shareBattleReport(battleId, playerAName, playerBName)
      break
    case 'share-preview':
      ShareUtils.shareBattleReportPreview(battleId, playerAName, playerBName)
      break
  }
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
