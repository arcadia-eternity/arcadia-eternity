<script setup lang="ts">
import {
  ElTable,
  ElTableColumn,
  ElFormItem,
  ElInput,
  ElSelect,
  ElOption,
  ElCheckbox,
  ElButton,
  ElForm,
} from 'element-plus'
import { computed, ref } from 'vue'
import type { ManagedAccount, ManagedBattle, ManagedPlayer } from '@/types/management'
const props = defineProps<{
  mode: 'battles' | 'accounts'
  players: ManagedPlayer[]
  battles: ManagedBattle[]
  accounts: ManagedAccount[]
  canReadPlayers: boolean
  canReadBattles: boolean
  canManageAccounts: boolean
  canTerminate: boolean
  moreAccounts: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  terminate: [id: string]
  deactivate: [id: string]
  moreAccounts: []
}>()
const query = ref('')
const environment = ref('')
const onlyConnected = ref(true)
const selectedBattle = ref('')
const selectedAccount = ref('')
const confirmation = ref<{ kind: 'battle' | 'account'; id: string }>()
const matches = (values: (string | undefined)[]) =>
  values.join(' ').toLowerCase().includes(query.value.trim().toLowerCase())
const environments = computed(() => [
  ...new Map(props.battles.map(b => [b.environmentId, b.environmentName])).entries(),
])
const battles = computed(() =>
  props.battles.filter(
    b =>
      (!environment.value || b.environmentId === environment.value) &&
      matches([b.id, b.roomCode, b.environmentName, ...b.players.map(p => p.name)]),
  ),
)
const players = computed(() =>
  props.players.filter(
    p => (!onlyConnected.value || p.connected) && matches([p.name, p.seatId, p.accountId, p.roomCode]),
  ),
)
const accounts = computed(() =>
  props.accounts.filter(a =>
    matches([a.accountId, ...props.players.filter(p => p.accountId === a.accountId).map(p => p.name)]),
  ),
)
const battle = computed(() => props.battles.find(b => b.id === selectedBattle.value))
const account = computed(() => props.accounts.find(a => a.accountId === selectedAccount.value))
function confirm(kind: 'battle' | 'account', id: string) {
  confirmation.value = { kind, id }
}
function submit() {
  if (!confirmation.value || props.busy) return
  const { kind, id } = confirmation.value
  if (kind === 'battle') emit('terminate', id)
  else emit('deactivate', id)
  confirmation.value = undefined
}
function elapsed(start: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000))
  return minutes < 1 ? '不足 1 分钟' : `${minutes} 分钟`
}
</script>
<template>
  <section class="live-management" :aria-label="mode === 'battles' ? '活跃对战管理' : '用户管理'">
    <h2>{{ mode === 'battles' ? '活跃对战' : '用户管理' }}</h2>
    <p class="hint" v-if="mode === 'battles'">
      汇总所有运行环境中的对局。列表会自动刷新；每局继续使用开局时的固定版本。
    </p>
    <p class="hint" v-else>在线玩家包括访客与账户玩家。账户、游玩会话和管理授权分别管理。</p>
    <div class="filters">
      <ElFormItem label="搜索">
        <ElInput
          v-model="query"
          type="search"
          :placeholder="mode === 'battles' ? '房间、玩家或对战标识' : '玩家名称或账户标识'"
        />
      </ElFormItem>
      <ElFormItem v-if="mode === 'battles'" label="运行环境">
        <ElSelect v-model="environment">
          <ElOption value="" label="全部环境" />
          <ElOption v-for="[id, name] in environments" :key="id" :value="id" :label="String(name)" />
        </ElSelect>
      </ElFormItem>
      <ElCheckbox v-else class="checkbox" v-model="onlyConnected">仅显示在线会话</ElCheckbox>
    </div>
    <template v-if="mode === 'battles'">
      <p v-if="!canReadBattles">没有查看对战的权限。</p>
      <template v-else>
        <div class="table-scroll">
          <ElTable :data="battles" row-key="id" stripe empty-text="暂无符合条件的记录">
            <ElTableColumn label="对战 / 房间" min-width="180">
              <template #default="{ row: item }"
                >{{ item.roomCode }}<small>{{ item.id.slice(0, 12) }}</small>
              </template>
            </ElTableColumn>
            <ElTableColumn label="环境" min-width="150">
              <template #default="{ row: item }">{{ item.environmentName }}</template>
            </ElTableColumn>
            <ElTableColumn label="玩家" min-width="150">
              <template #default="{ row: item }">
                <span v-for="player in item.players" :key="player.seatId" class="player"
                  >{{ player.name }} · {{ player.connected ? '在线' : '等待重连' }}</span
                >
              </template>
            </ElTableColumn>
            <ElTableColumn label="状态" min-width="150">
              <template #default="{ row: item }"
                >{{ item.state === 'reconnecting' ? '等待重连' : '进行中'
                }}<small v-if="item.turn !== undefined">第 {{ item.turn }} 回合</small>
              </template>
            </ElTableColumn>
            <ElTableColumn label="运行方式" min-width="150">
              <template #default="{ row: item }">{{
                item.execution === 'server' ? '服务器执行' : '玩家执行'
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="时长" min-width="150">
              <template #default="{ row: item }">{{ elapsed(item.startedAt) }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" min-width="240">
              <template #default="{ row: item }">
                <ElButton @click="selectedBattle = item.id" native-type="button">查看对战</ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
        <p v-if="!battles.length" class="empty">
          {{ query || environment ? '没有符合条件的活跃对战。' : '当前没有活跃对战。' }}
        </p>
      </template>
    </template>
    <template v-else>
      <h3>在线玩家与会话</h3>
      <p v-if="!canReadPlayers">没有查看玩家会话的权限。</p>
      <template v-else>
        <div class="table-scroll">
          <ElTable :data="players" row-key="seatId" stripe empty-text="暂无符合条件的记录">
            <ElTableColumn label="玩家" min-width="180">
              <template #default="{ row: player }"
                >{{ player.name }}<small>{{ player.accountId ?? player.seatId }}</small>
              </template>
            </ElTableColumn>
            <ElTableColumn label="身份" min-width="150">
              <template #default="{ row: player }">{{ player.kind === 'account' ? '本服账户' : '访客' }}</template>
            </ElTableColumn>
            <ElTableColumn label="状态" min-width="150">
              <template #default="{ row: player }">{{ player.connected ? '在线' : '离线会话' }}</template>
            </ElTableColumn>
            <ElTableColumn label="当前活动" min-width="150">
              <template #default="{ row: player }">{{
                player.battleId ? '对战中' : player.roomCode ? '房间 ' + player.roomCode : '大厅'
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" min-width="240">
              <template #default="{ row: player }">
                <ElButton
                  v-if="player.battleId && canReadBattles"
                  @click="selectedBattle = player.battleId"
                  native-type="button"
                >
                  查看对战</ElButton
                >
                <ElButton
                  v-if="player.accountId && canManageAccounts"
                  @click="selectedAccount = player.accountId"
                  native-type="button"
                >
                  查看账户
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
        <p v-if="!players.length" class="empty">没有符合条件的玩家会话。</p>
      </template>
      <template v-if="canManageAccounts">
        <h3>本服账户</h3>
        <p class="hint">
          账户由玩家通过本服登录建立。停用会撤销会话和关联管理权限，保留身份记录；当前不支持恢复停用的账户。
        </p>
        <div class="table-scroll">
          <ElTable :data="accounts" row-key="accountId" stripe empty-text="暂无符合条件的记录">
            <ElTableColumn label="账户" min-width="180">
              <template #default="{ row: item }">{{ item.accountId }}</template>
            </ElTableColumn>
            <ElTableColumn label="状态" min-width="150">
              <template #default="{ row: item }">{{ item.status === 'active' ? '正常' : '已停用' }}</template>
            </ElTableColumn>
            <ElTableColumn label="创建时间" min-width="150">
              <template #default="{ row: item }">{{ new Date(item.createdAt).toLocaleString() }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" min-width="240">
              <template #default="{ row: item }">
                <ElButton @click="selectedAccount = item.accountId" native-type="button">查看账户</ElButton>
                <ElButton
                  v-if="item.status === 'active'"
                  :disabled="busy"
                  @click="confirm('account', item.accountId)"
                  native-type="button"
                >
                  停用账户
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
        <p v-if="!accounts.length" class="empty">没有符合条件的账户。</p>
        <ElButton v-if="moreAccounts" :disabled="busy" @click="emit('moreAccounts')" native-type="button"
          >加载更多账户</ElButton
        >
      </template>
    </template>
    <aside v-if="selectedBattle" class="detail" aria-label="对战详情">
      <header>
        <h3>对战详情</h3>
        <ElButton @click="selectedBattle = ''" native-type="button">关闭详情</ElButton>
      </header>
      <template v-if="battle">
        <dl>
          <dt>对战</dt>
          <dd>{{ battle.id }}</dd>
          <dt>房间</dt>
          <dd>{{ battle.roomCode }}</dd>
          <dt>环境</dt>
          <dd>{{ battle.environmentName }}</dd>
          <dt>开局版本</dt>
          <dd>{{ battle.versionId ?? '主机预置版本' }}</dd>
          <dt>开始时间</dt>
          <dd>{{ new Date(battle.startedAt).toLocaleString() }}</dd>
        </dl>
        <p v-for="player in battle.players" :key="player.seatId">
          {{ player.name }} · {{ player.connected ? '在线' : '等待重连' }}
        </p>
        <p v-if="battle.execution === 'peer'" class="hint">此局由玩家执行，服务器无法强制结束其计算。</p>
        <ElButton
          v-else-if="canTerminate"
          class="danger"
          :disabled="busy"
          @click="confirm('battle', battle.id)"
          native-type="button"
          type="danger"
        >
          终止此对战
        </ElButton>
      </template>
      <p v-else role="status">此对战已结束或不再活跃。</p>
    </aside>
    <aside v-if="selectedAccount" class="detail" aria-label="账户详情">
      <header>
        <h3>账户详情</h3>
        <ElButton @click="selectedAccount = ''" native-type="button">关闭账户详情</ElButton>
      </header>
      <p>{{ selectedAccount }}</p>
      <template v-if="account">
        <p>
          {{ account.status === 'active' ? '正常' : '已停用' }} · 建立于
          {{ new Date(account.createdAt).toLocaleString() }}
        </p>
        <p v-if="account.deactivatedAt">停用时间：{{ new Date(account.deactivatedAt).toLocaleString() }}</p>
        <ElButton
          v-if="account.status === 'active'"
          class="danger"
          :disabled="busy"
          @click="confirm('account', account.accountId)"
          native-type="button"
          type="danger"
        >
          停用账户
        </ElButton>
      </template>
      <p v-else class="hint">此账户不在已加载的列表中，请继续加载账户列表。</p>
      <p v-for="player in props.players.filter(p => p.accountId === selectedAccount)" :key="player.seatId">
        {{ player.name }} · {{ player.connected ? '在线' : '离线会话' }}
      </p>
    </aside>
    <ElForm
      v-if="confirmation"
      class="confirmation"
      aria-label="确认管理操作"
      @submit.prevent="submit"
      label-position="top"
    >
      <h3>{{ confirmation.kind === 'battle' ? '终止这一场对战？' : '停用此账户？' }}</h3>
      <p>{{ confirmation.id }}</p>
      <p>
        {{
          confirmation.kind === 'battle'
            ? '中断并释放这一局，不判定胜负；其他对战继续运行。'
            : '此账户将退出本服，关联管理权限失效。身份记录保留，当前无法恢复。'
        }}
      </p>
      <ElButton class="danger" :disabled="busy" native-type="submit" type="danger">{{
        confirmation.kind === 'battle' ? '确认终止对战' : '确认停用'
      }}</ElButton>
      <ElButton @click="confirmation = undefined" native-type="button">取消</ElButton>
    </ElForm>
  </section>
</template>
<style scoped>
.hint,
small {
  color: var(--el-text-color-secondary);
  font-size: 0.85rem;
  line-height: 1.6;
}
.filters,
header {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.checkbox {
  flex-direction: row;
  align-items: center;
}
.table-scroll {
  overflow: auto;
  margin-top: 1rem;
}
small,
.player {
  display: block;
}
.empty {
  padding: 2rem;
  text-align: center;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 10px;
}
.detail,
.confirmation {
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  padding: 1.2rem;
  border-radius: 12px;
  margin-top: 1rem;
  overflow-wrap: anywhere;
}
.confirmation {
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-5);
}
dl {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 0.5rem;
  font-size: 0.85rem;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
