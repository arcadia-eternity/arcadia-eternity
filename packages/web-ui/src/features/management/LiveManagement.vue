<script setup lang="ts">
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
  terminate: [id: string, reason: string]
  deactivate: [id: string, reason: string]
  moreAccounts: []
}>()
const query = ref('')
const environment = ref('')
const onlyConnected = ref(true)
const selectedBattle = ref('')
const selectedAccount = ref('')
const confirmation = ref<{ kind: 'battle' | 'account'; id: string }>()
const reason = ref('')
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
  reason.value = ''
}
function submit() {
  if (!confirmation.value || !reason.value.trim() || props.busy) return
  const { kind, id } = confirmation.value
  if (kind === 'battle') emit('terminate', id, reason.value.trim())
  else emit('deactivate', id, reason.value.trim())
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
      <label
        >搜索<input
          v-model="query"
          type="search"
          :placeholder="mode === 'battles' ? '房间、玩家或对战标识' : '玩家名称或账户标识'"
      /></label>
      <label v-if="mode === 'battles'"
        >运行环境<select v-model="environment">
          <option value="">全部环境</option>
          <option v-for="[id, name] in environments" :key="id" :value="id">{{ name }}</option>
        </select></label
      >
      <label v-else class="checkbox"><input v-model="onlyConnected" type="checkbox" />仅显示在线会话</label>
    </div>
    <template v-if="mode === 'battles'">
      <p v-if="!canReadBattles">没有查看对战的权限。</p>
      <template v-else>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>对战 / 房间</th>
                <th>环境</th>
                <th>玩家</th>
                <th>状态</th>
                <th>运行方式</th>
                <th>时长</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in battles" :key="item.id">
                <td>
                  {{ item.roomCode }}<small>{{ item.id.slice(0, 12) }}</small>
                </td>
                <td>{{ item.environmentName }}</td>
                <td>
                  <span v-for="player in item.players" :key="player.seatId" class="player"
                    >{{ player.name }} · {{ player.connected ? '在线' : '等待重连' }}</span
                  >
                </td>
                <td>
                  {{ item.state === 'reconnecting' ? '等待重连' : '进行中'
                  }}<small v-if="item.turn !== undefined">第 {{ item.turn }} 回合</small>
                </td>
                <td>{{ item.execution === 'server' ? '服务器执行' : '玩家执行' }}</td>
                <td>{{ elapsed(item.startedAt) }}</td>
                <td><button @click="selectedBattle = item.id">查看对战</button></td>
              </tr>
            </tbody>
          </table>
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
          <table>
            <thead>
              <tr>
                <th>玩家</th>
                <th>身份</th>
                <th>状态</th>
                <th>当前活动</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="player in players" :key="player.seatId">
                <td>
                  {{ player.name }}<small>{{ player.accountId ?? player.seatId }}</small>
                </td>
                <td>{{ player.kind === 'account' ? '本服账户' : '访客' }}</td>
                <td>{{ player.connected ? '在线' : '离线会话' }}</td>
                <td>{{ player.battleId ? '对战中' : player.roomCode ? '房间 ' + player.roomCode : '大厅' }}</td>
                <td>
                  <button v-if="player.battleId && canReadBattles" @click="selectedBattle = player.battleId">
                    查看对战</button
                  ><button v-if="player.accountId && canManageAccounts" @click="selectedAccount = player.accountId">
                    查看账户
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!players.length" class="empty">没有符合条件的玩家会话。</p>
      </template>
      <template v-if="canManageAccounts">
        <h3>本服账户</h3>
        <p class="hint">
          账户由玩家通过本服登录建立。停用会撤销会话和关联管理权限，保留身份记录；当前不支持恢复停用的账户。
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>账户</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in accounts" :key="item.accountId">
                <td>{{ item.accountId }}</td>
                <td>{{ item.status === 'active' ? '正常' : '已停用' }}</td>
                <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
                <td>
                  <button @click="selectedAccount = item.accountId">查看账户</button
                  ><button v-if="item.status === 'active'" :disabled="busy" @click="confirm('account', item.accountId)">
                    停用账户
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!accounts.length" class="empty">没有符合条件的账户。</p>
        <button v-if="moreAccounts" :disabled="busy" @click="emit('moreAccounts')">加载更多账户</button>
      </template>
    </template>
    <aside v-if="selectedBattle" class="detail" aria-label="对战详情">
      <header>
        <h3>对战详情</h3>
        <button @click="selectedBattle = ''">关闭详情</button>
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
        <button v-else-if="canTerminate" class="danger" :disabled="busy" @click="confirm('battle', battle.id)">
          终止此对战
        </button>
      </template>
      <p v-else role="status">此对战已结束或不再活跃。</p>
    </aside>
    <aside v-if="selectedAccount" class="detail" aria-label="账户详情">
      <header>
        <h3>账户详情</h3>
        <button @click="selectedAccount = ''">关闭账户详情</button>
      </header>
      <p>{{ selectedAccount }}</p>
      <template v-if="account">
        <p>
          {{ account.status === 'active' ? '正常' : '已停用' }} · 建立于
          {{ new Date(account.createdAt).toLocaleString() }}
        </p>
        <p v-if="account.deactivatedAt">停用时间：{{ new Date(account.deactivatedAt).toLocaleString() }}</p>
        <button
          v-if="account.status === 'active'"
          class="danger"
          :disabled="busy"
          @click="confirm('account', account.accountId)"
        >
          停用账户
        </button>
      </template>
      <p v-else class="hint">此账户不在已加载的列表中，请继续加载账户列表。</p>
      <p v-for="player in props.players.filter(p => p.accountId === selectedAccount)" :key="player.seatId">
        {{ player.name }} · {{ player.connected ? '在线' : '离线会话' }}
      </p>
    </aside>
    <form v-if="confirmation" class="confirmation" aria-label="确认管理操作" @submit.prevent="submit">
      <h3>{{ confirmation.kind === 'battle' ? '终止这一场对战？' : '停用此账户？' }}</h3>
      <p>{{ confirmation.id }}</p>
      <p>
        {{
          confirmation.kind === 'battle'
            ? '中断并释放这一局，不判定胜负；其他对战继续运行。'
            : '此账户将退出本服，关联管理权限失效。身份记录保留，当前无法恢复。'
        }}
      </p>
      <label>操作原因<textarea v-model="reason" required maxlength="500" rows="3" /></label>
      <button class="danger" :disabled="busy || !reason.trim()">
        {{ confirmation.kind === 'battle' ? '确认终止对战' : '确认停用' }}</button
      ><button type="button" @click="confirmation = undefined">取消</button>
    </form>
  </section>
</template>
<style scoped>
.hint,
small {
  color: #64748b;
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
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.checkbox {
  flex-direction: row;
  align-items: center;
}
input,
select,
textarea {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.6rem;
  background: white;
  color: #0f172a;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.45rem 0.7rem;
  background: white;
  color: #334155;
  cursor: pointer;
  margin: 0.2rem;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.table-scroll {
  overflow: auto;
  margin-top: 1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  font-size: 0.85rem;
}
th,
td {
  text-align: left;
  padding: 0.85rem;
  border-bottom: 1px solid #e2e8f0;
  overflow-wrap: anywhere;
}
th {
  color: #64748b;
  font-weight: 500;
  white-space: nowrap;
  background: #f8fafc;
}
small,
.player {
  display: block;
}
.empty {
  padding: 2rem;
  text-align: center;
  color: #64748b;
  background: #f8fafc;
  border-radius: 10px;
}
.detail,
.confirmation {
  border: 1px solid #cbd5e1;
  background: white;
  padding: 1.2rem;
  border-radius: 12px;
  margin-top: 1rem;
  overflow-wrap: anywhere;
}
.confirmation {
  background: #fff7ed;
  border-color: #fdba74;
}
.danger {
  color: #b91c1c;
  border-color: #fca5a5;
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
