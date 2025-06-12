<template>
  <div class="local-battle-reports">
    <!-- 页面标题和操作栏 -->
    <div class="header-section">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">本地战报管理</h1>
          <p class="text-gray-600 mt-1">管理保存在本地的战报文件</p>
        </div>
        <div class="flex items-center space-x-3">
          <!-- 导入战报按钮 -->
          <el-upload
            ref="uploadRef"
            :show-file-list="false"
            :before-upload="handleImportReport"
            accept=".json"
            :auto-upload="false"
          >
            <el-button type="primary" :icon="Upload">
              导入战报
            </el-button>
          </el-upload>
          
          <!-- 清空所有战报按钮 -->
          <el-button 
            type="danger" 
            :icon="Delete"
            @click="handleClearAll"
            :disabled="localBattleReports.length === 0"
          >
            清空所有
          </el-button>
        </div>
      </div>

      <!-- 统计信息 -->
      <div class="stats-section mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-blue-50 p-4 rounded-lg">
            <div class="text-2xl font-bold text-blue-600">{{ statistics.total }}</div>
            <div class="text-sm text-blue-500">总战报数</div>
          </div>
          <div class="bg-green-50 p-4 rounded-lg">
            <div class="text-2xl font-bold text-green-600">{{ statistics.maxAllowed }}</div>
            <div class="text-sm text-green-500">最大容量</div>
          </div>
          <div class="bg-yellow-50 p-4 rounded-lg">
            <div class="text-2xl font-bold text-yellow-600">
              {{ Math.round((statistics.total / statistics.maxAllowed) * 100) }}%
            </div>
            <div class="text-sm text-yellow-500">存储使用率</div>
          </div>
          <div class="bg-purple-50 p-4 rounded-lg">
            <div class="text-sm font-medium text-purple-600">
              {{ statistics.newestDate ? formatDate(statistics.newestDate) : '-' }}
            </div>
            <div class="text-sm text-purple-500">最新保存</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 战报列表 -->
    <div class="reports-section">
      <div v-if="localBattleReports.length === 0" class="empty-state">
        <div class="text-center py-12">
          <el-icon class="text-6xl text-gray-300 mb-4">
            <Document />
          </el-icon>
          <h3 class="text-lg font-medium text-gray-900 mb-2">暂无本地战报</h3>
          <p class="text-gray-500 mb-4">您可以从战报详情页面保存战报到本地，或导入战报文件</p>
          <el-upload
            :show-file-list="false"
            :before-upload="handleImportReport"
            accept=".json"
            :auto-upload="false"
          >
            <el-button type="primary">导入战报文件</el-button>
          </el-upload>
        </div>
      </div>

      <div v-else class="reports-grid">
        <div 
          v-for="report in localBattleReports" 
          :key="report.id"
          class="report-card"
        >
          <div class="card-header">
            <h3 class="card-title">{{ report.name }}</h3>
            <div class="card-actions">
              <el-dropdown @command="(command: string) => handleReportAction(command, report)">
                <el-button type="text" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="play">
                      <el-icon><VideoPlay /></el-icon>
                      播放战报
                    </el-dropdown-item>
                    <el-dropdown-item command="export">
                      <el-icon><Download /></el-icon>
                      导出文件
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>
                      删除战报
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>

          <div class="card-content">
            <div class="battle-info">
              <div class="players">
                <span class="player-name">{{ report.battleRecord.player_a_name }}</span>
                <span class="vs">VS</span>
                <span class="player-name">{{ report.battleRecord.player_b_name }}</span>
              </div>
              
              <div class="battle-meta">
                <div class="meta-item">
                  <span class="label">战斗结果:</span>
                  <span class="value">{{ getBattleResultText(report.battleRecord.battle_result) }}</span>
                </div>
                <div class="meta-item">
                  <span class="label">战斗时长:</span>
                  <span class="value">
                    {{ report.battleRecord.duration_seconds ? formatDuration(report.battleRecord.duration_seconds) : '-' }}
                  </span>
                </div>
                <div class="meta-item">
                  <span class="label">保存时间:</span>
                  <span class="value">{{ formatDate(report.savedAt) }}</span>
                </div>
              </div>

              <div v-if="report.description" class="description">
                {{ report.description }}
              </div>
            </div>
          </div>

          <div class="card-footer">
            <el-button 
              type="primary" 
              size="small"
              @click="playReport(report)"
            >
              <el-icon><VideoPlay /></el-icon>
              播放战报
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { ElMessageBox } from 'element-plus'
import { 
  Upload, 
  Delete, 
  Document, 
  MoreFilled, 
  VideoPlay, 
  Download 
} from '@element-plus/icons-vue'
import type { LocalBattleReport } from '@/utils/localBattleReport'

const router = useRouter()
const battleReportStore = useBattleReportStore()
const { localBattleReports } = storeToRefs(battleReportStore)

const uploadRef = ref()

// 统计信息
const statistics = computed(() => battleReportStore.getLocalBattleReportStatistics())

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

// 播放战报
const playReport = (report: LocalBattleReport) => {
  // 设置当前本地战报
  battleReportStore.loadLocalBattleReport(report.id)
  // 跳转到播放页面
  router.push(`/local-battle-reports/${report.id}/play`)
}

// 处理战报操作
const handleReportAction = (command: string, report: LocalBattleReport) => {
  switch (command) {
    case 'play':
      playReport(report)
      break
    case 'export':
      battleReportStore.exportLocalBattleReport(report.id)
      break
    case 'delete':
      handleDeleteReport(report.id, report.name)
      break
  }
}

// 删除战报
const handleDeleteReport = async (reportId: string, reportName: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除战报 "${reportName}" 吗？此操作不可撤销。`,
      '删除战报',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    
    battleReportStore.deleteLocalBattleReport(reportId)
  } catch {
    // 用户取消
  }
}

// 导入战报
const handleImportReport = async (file: File) => {
  await battleReportStore.importLocalBattleReport(file)
  return false // 阻止自动上传
}

// 清空所有战报
const handleClearAll = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要清空所有本地战报吗？此操作不可撤销。`,
      '清空所有战报',
      {
        confirmButtonText: '清空',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    
    battleReportStore.clearAllLocalBattleReports()
  } catch {
    // 用户取消
  }
}

// 加载本地战报
onMounted(() => {
  battleReportStore.loadLocalBattleReports()
})
</script>

<style scoped>
.local-battle-reports {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.reports-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
}

.report-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: white;
  transition: all 0.2s;
}

.report-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: #3b82f6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f3f4f6;
  background: #f9fafb;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.card-content {
  padding: 16px;
}

.players {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.player-name {
  font-weight: 600;
  color: #1f2937;
}

.vs {
  margin: 0 12px;
  color: #6b7280;
  font-weight: 500;
}

.battle-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.meta-item {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.label {
  color: #6b7280;
}

.value {
  color: #1f2937;
  font-weight: 500;
}

.description {
  font-size: 14px;
  color: #6b7280;
  background: #f9fafb;
  padding: 8px;
  border-radius: 4px;
  margin-top: 8px;
}

.card-footer {
  padding: 16px;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
}
</style>
