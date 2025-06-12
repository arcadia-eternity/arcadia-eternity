<template>
  <div class="battle-record-detail">
    <!-- 返回按钮 -->
    <div class="mb-6 flex justify-between items-center">
      <el-button @click="goBack" icon="ArrowLeft">返回列表</el-button>
      <div v-if="currentBattleRecord" class="flex space-x-2">
        <el-button @click="previewBattle" type="primary" icon="VideoPlay"> 预览战报 </el-button>
        <el-button @click="showSaveToLocalDialog" type="warning" icon="Download"> 保存到本地 </el-button>
        <el-dropdown @command="handleShareCommand">
          <el-button type="success" icon="Share">
            分享战报
            <el-icon class="el-icon--right">
              <ArrowDown />
            </el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="share-detail" icon="Link">分享战报详情</el-dropdown-item>
              <el-dropdown-item command="share-preview" icon="VideoPlay">分享战报回放</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
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

    <!-- 保存到本地对话框 -->
    <el-dialog v-model="saveToLocalDialogVisible" title="保存战报到本地" width="500px" :close-on-click-modal="false">
      <el-form :model="saveForm" label-width="80px">
        <el-form-item label="战报名称">
          <el-input v-model="saveForm.name" placeholder="请输入战报名称" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="saveForm.description"
            type="textarea"
            :rows="3"
            placeholder="请输入战报描述（可选）"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="saveToLocalDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSaveToLocal">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleReportStore } from '@/stores/battleReport'
import { storeToRefs } from 'pinia'
import { Loading, ArrowDown } from '@element-plus/icons-vue'
import { ShareUtils } from '@/utils/share'

const route = useRoute()
const router = useRouter()
const battleReportStore = useBattleReportStore()

const { currentBattleRecord, loading, errors } = storeToRefs(battleReportStore)

// 保存到本地相关状态
const saveToLocalDialogVisible = ref(false)
const saveForm = ref({
  name: '',
  description: '',
})

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
  // 检查是否有历史记录可以返回
  if (window.history.length > 1) {
    router.go(-1)
  } else {
    // 如果没有历史记录，默认返回在线战报列表
    router.push('/battle-reports')
  }
}

// 预览战报
const previewBattle = () => {
  const id = route.params.id as string
  if (id) {
    router.push(`/battle-reports/${id}/preview`)
  }
}

// 处理分享命令
const handleShareCommand = (command: string) => {
  if (!currentBattleRecord.value) return

  const battleId = currentBattleRecord.value.id
  const playerAName = currentBattleRecord.value.player_a_name
  const playerBName = currentBattleRecord.value.player_b_name

  switch (command) {
    case 'share-detail':
      ShareUtils.shareBattleReport(battleId, playerAName, playerBName)
      break
    case 'share-preview':
      ShareUtils.shareBattleReportPreview(battleId, playerAName, playerBName)
      break
  }
}

// 显示保存到本地对话框
const showSaveToLocalDialog = () => {
  if (!currentBattleRecord.value) return

  // 设置默认名称
  saveForm.value.name = `${currentBattleRecord.value.player_a_name} vs ${currentBattleRecord.value.player_b_name}`
  saveForm.value.description = ''
  saveToLocalDialogVisible.value = true
}

// 处理保存到本地
const handleSaveToLocal = () => {
  const success = battleReportStore.saveCurrentBattleReportToLocal(
    saveForm.value.name.trim() || undefined,
    saveForm.value.description.trim() || undefined,
  )

  if (success) {
    saveToLocalDialogVisible.value = false
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
