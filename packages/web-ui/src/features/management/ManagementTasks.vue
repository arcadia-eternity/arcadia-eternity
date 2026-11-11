<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ElButton,
  ElCard,
  ElTable,
  ElTableColumn,
  ElTag,
  ElInput,
  ElSelect,
  ElOption,
  ElPagination,
  ElProgress,
  ElTabs,
  ElTabPane,
} from 'element-plus'
import type { ManagementController } from './useManagementController'
import type { ManagementOperation } from '@/types/management'
import { serverBackupDownload } from './useManagementConsole'
const { controller } = defineProps<{ controller: ManagementController }>()
const {
  state,
  operations,
  audit,
  busy,
  canBackup,
  downloading,
  tab,
  taskLabels,
  taskKinds,
  auditLabels,
  taskStages,
  encode,
  supported,
  createBackup,
  downloadBackup,
  operationError,
} = controller
const history = ref('operations')
const query = ref('')
const status = ref('')
function backupDownload(row: Record<PropertyKey, unknown>) {
  return serverBackupDownload(row as unknown as ManagementOperation)
}
function backupTask(row: Record<PropertyKey, unknown>) {
  return row as unknown as ManagementOperation
}
const operationPage = ref(1)
const auditPage = ref(1)
const pageSize = 15
const matches = (...values: (string | undefined)[]) =>
  values.join(' ').toLowerCase().includes(query.value.trim().toLowerCase())
const filteredOperations = computed(() =>
  operations.value.filter(
    item => (!status.value || item.status === status.value) && matches(item.id, item.kind, taskKinds[item.kind]),
  ),
)
const filteredAudit = computed(() =>
  audit.value.filter(item => matches(item.action, auditLabels[item.action], item.actor, item.target, item.reason)),
)
const visibleOperations = computed(() =>
  filteredOperations.value.slice((operationPage.value - 1) * pageSize, operationPage.value * pageSize),
)
const visibleAudit = computed(() =>
  filteredAudit.value.slice((auditPage.value - 1) * pageSize, auditPage.value * pageSize),
)
watch([query, status], () => {
  operationPage.value = 1
  auditPage.value = 1
})
watch(
  () => filteredOperations.value.length,
  length => {
    operationPage.value = Math.min(operationPage.value, Math.max(1, Math.ceil(length / pageSize)))
  },
)
watch(
  () => filteredAudit.value.length,
  length => {
    auditPage.value = Math.min(auditPage.value, Math.max(1, Math.ceil(length / pageSize)))
  },
)
const statusType = (value: string) =>
  value === 'succeeded'
    ? 'success'
    : value === 'failed' || value === 'interrupted'
      ? 'danger'
      : value === 'running'
        ? 'primary'
        : 'info'
</script>
<template>
  <section v-if="tab === 'tasks'" aria-label="管理任务">
    <h2>操作记录与备份</h2>
    <ElCard v-if="canBackup" shadow="never" class="server-backup">
      <div class="actions">
        <strong>服务器备份</strong>
        <ElButton type="primary" :disabled="busy || !!downloading" @click="createBackup">创建服务器备份</ElButton>
      </div>
      <p class="hint">恢复备份前须停止服务器。</p>
    </ElCard>
    <div class="history-toolbar">
      <ElInput v-model="query" clearable placeholder="搜索任务、操作或标识" aria-label="搜索操作记录" />
      <ElSelect v-if="history === 'operations'" v-model="status" clearable placeholder="全部状态" aria-label="任务状态">
        <ElOption v-for="(label, value) in taskLabels" :key="value" :label="label" :value="value" />
      </ElSelect>
    </div>
    <ElTabs v-model="history">
      <ElTabPane label="后台任务" name="operations">
        <ElTable :data="visibleOperations" row-key="id" stripe empty-text="没有可查看的任务。">
          <ElTableColumn label="任务" min-width="180">
            <template #default="{ row: operation }">
              <strong>{{ taskKinds[operation.kind] ?? operation.kind }}</strong>
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="110">
            <template #default="{ row: operation }">
              <ElTag :type="statusType(operation.status)">{{ taskLabels[operation.status] ?? operation.status }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="进度与操作" min-width="320">
            <template #default="{ row: operation }">
              <p v-if="operation.status === 'running' && typeof operation.progress === 'object'">
                {{
                  operation.progress.message ??
                  (operation.progress.stage ? taskStages[operation.progress.stage] : undefined) ??
                  '正在处理'
                }}
                <span v-if="operation.progress.total"
                  >{{ operation.progress.completed ?? 0 }} / {{ operation.progress.total }}</span
                >
              </p>
              <ElProgress
                v-if="typeof operation.progress === 'number'"
                :percentage="Math.max(0, Math.min(100, operation.progress))"
              />
              <p v-if="operation.error" class="error">{{ operationError(operation.error) }}</p>
              <p v-if="operation.committed && operation.status !== 'succeeded'" class="hint">
                资源变更已提交，请先查看实际状态，再发起新的操作。
              </p>
              <small>{{ operation.id }}</small>
              <ElButton
                v-if="
                  (operation.status === 'queued' || operation.status === 'running') &&
                  (operation.kind !== 'server.backup' || canBackup)
                "
                :disabled="busy || operation.cancelRequested"
                @click="state.mutate('POST', `/operations/${encode(operation.id)}/cancel`)"
                native-type="button"
                >{{ operation.cancelRequested ? '已请求取消' : '取消任务' }}</ElButton
              >
              <ElButton
                v-if="
                  !operation.committed &&
                  (operation.status === 'failed' ||
                    operation.status === 'interrupted' ||
                    operation.status === 'cancelled') &&
                  (operation.kind !== 'server.backup' || canBackup)
                "
                :disabled="busy"
                @click="state.mutate('POST', `/operations/${encode(operation.id)}/retry`)"
                native-type="button"
              >
                重试任务
              </ElButton>
              <template v-if="operation.kind === 'server.backup' && operation.status === 'succeeded' && canBackup">
                <template v-if="backupDownload(operation)">
                  <p class="hint">
                    {{ backupDownload(operation)!.filename }} ·
                    {{ (backupDownload(operation)!.bytes / 1024 / 1024).toFixed(2) }} MiB · 有效至
                    {{ new Date(backupDownload(operation)!.expiresAt).toLocaleString() }}
                  </p>
                  <ElButton
                    :disabled="busy || !!downloading || backupDownload(operation)!.expiresAt <= Date.now()"
                    @click="downloadBackup(backupTask(operation))"
                    native-type="button"
                    >{{
                      backupDownload(operation)!.expiresAt <= Date.now()
                        ? '备份文件已过期'
                        : downloading === operation.id
                          ? '正在下载备份…'
                          : '下载服务器备份'
                    }}</ElButton
                  >
                </template>
                <p v-else class="hint">此任务没有可用的备份下载信息，请重新创建备份。</p>
              </template>
            </template>
          </ElTableColumn>
        </ElTable>
        <ElPagination
          v-model:current-page="operationPage"
          :page-size="pageSize"
          :total="filteredOperations.length"
          layout="total, prev, pager, next"
          :pager-count="5"
          hide-on-single-page
        />
      </ElTabPane>
      <ElTabPane v-if="supported('audit')" label="审计记录" name="audit">
        <ElTable :data="visibleAudit" row-key="id" stripe empty-text="没有符合条件的管理操作。">
          <ElTableColumn label="操作" min-width="160">
            <template #default="{ row }">{{ auditLabels[row.action] ?? row.action }}</template>
          </ElTableColumn>
          <ElTableColumn prop="actor" label="操作人" min-width="200" show-overflow-tooltip />
          <ElTableColumn prop="target" label="对象" min-width="200" show-overflow-tooltip />
          <ElTableColumn label="时间" width="180">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
          </ElTableColumn>
          <ElTableColumn prop="reason" label="原因" min-width="180" show-overflow-tooltip />
        </ElTable>
        <ElPagination
          v-model:current-page="auditPage"
          :page-size="pageSize"
          :total="filteredAudit.length"
          layout="total, prev, pager, next"
          :pager-count="5"
          hide-on-single-page
        />
      </ElTabPane>
    </ElTabs>
  </section>
</template>
