<template>
  <div class="battle-workbench-controller">
    <header class="controller-header">
      <h2>Battle Controller</h2>
      <div class="controller-actions">
        <el-button text size="small" @click="clearResources">清空资源</el-button>
      </div>
    </header>

    <section class="controller-section">
      <div class="section-title">组合资源</div>
      <div class="resource-toolbar">
        <el-button size="small" :disabled="!canAddCurrentEntry" @click="addCurrentEntry">
          添加当前文件
        </el-button>

        <el-select
          v-model="selectedOpenTabId"
          size="small"
          class="open-tab-select"
          placeholder="从已打开视窗选择"
        >
          <el-option
            v-for="tab in openTabOptions"
            :key="tab.id"
            :label="tab.label"
            :value="tab.id"
          />
        </el-select>

        <el-button size="small" :disabled="!selectedOpenTabId" @click="addSelectedOpenTab">
          添加视窗
        </el-button>
      </div>

      <div class="resource-list">
        <div
          v-for="resource in workbenchStore.resources"
          :key="resource.id"
          class="resource-item"
        >
          <div class="resource-main">
            <div class="resource-title">{{ resource.label }}</div>
            <div class="resource-detail">{{ resource.packFolder }}/{{ resource.relativePath }}</div>
          </div>
          <div class="resource-side">
            <el-tag size="small" effect="plain">{{ resource.kind }}</el-tag>
            <el-button text size="small" @click="removeResource(resource.id)">移除</el-button>
          </div>
        </div>

        <el-empty
          v-if="workbenchStore.resources.length === 0"
          description="还没有组合资源"
          :image-size="56"
        />
      </div>
    </section>

    <section class="controller-section">
      <div class="section-title">对战队伍</div>
      <div class="form-grid">
        <label class="form-label">玩家1</label>
        <el-select v-model="workbenchStore.selectedPlayer1TeamIndex" class="w-full" size="small">
          <el-option
            v-for="team in availableTeams"
            :key="`p1-${team.index}`"
            :label="team.label"
            :value="team.index"
          />
        </el-select>

        <label class="form-label">玩家2</label>
        <el-select v-model="workbenchStore.selectedPlayer2TeamIndex" class="w-full" size="small">
          <el-option
            v-for="team in availableTeams"
            :key="`p2-${team.index}`"
            :label="team.label"
            :value="team.index"
          />
        </el-select>
      </div>
    </section>

    <section class="controller-section">
      <div class="section-title">基础配置</div>
      <div class="option-grid">
        <el-switch
          v-model="workbenchStore.battleConfig.allowFaintSwitch"
          active-text="击破后可切换"
          inactive-text="禁止击破切换"
        />
        <el-switch
          v-model="workbenchStore.battleConfig.showHidden"
          active-text="显示隐藏信息"
          inactive-text="隐藏信息"
        />
      </div>

      <div class="form-grid mt-2">
        <label class="form-label">随机种子</label>
        <el-input-number
          v-model="rngSeedInput"
          :min="0"
          :step="1"
          size="small"
          controls-position="right"
          class="w-full"
          placeholder="留空随机"
        />
      </div>
    </section>

    <section class="controller-section">
      <div class="section-title">计时器</div>
      <div class="option-grid">
        <el-switch
          v-model="workbenchStore.timerConfig.enabled"
          active-text="启用计时"
          inactive-text="关闭计时"
        />
        <el-switch
          v-model="turnLimitEnabled"
          active-text="回合限时"
          inactive-text="无回合限时"
        />
        <el-switch
          v-model="totalLimitEnabled"
          active-text="总时间限制"
          inactive-text="无总时间限制"
        />
      </div>

      <div class="form-grid mt-2">
        <label class="form-label">回合限时(秒)</label>
        <el-input-number
          v-model="workbenchStore.timerConfig.turnTimeLimit"
          :disabled="!turnLimitEnabled"
          :min="5"
          :max="300"
          size="small"
          controls-position="right"
          class="w-full"
        />

        <label class="form-label">总时限(秒)</label>
        <el-input-number
          v-model="workbenchStore.timerConfig.totalTimeLimit"
          :disabled="!totalLimitEnabled"
          :min="60"
          :max="3600"
          size="small"
          controls-position="right"
          class="w-full"
        />
      </div>
    </section>

    <section class="controller-section">
      <div class="section-title">团队选择阶段</div>
      <div class="option-grid">
        <el-switch
          v-model="workbenchStore.battleConfig.teamSelection.enabled"
          active-text="启用"
          inactive-text="关闭"
        />
      </div>

      <div class="form-grid mt-2" :class="{ disabled: !workbenchStore.battleConfig.teamSelection.enabled }">
        <label class="form-label">模式</label>
        <el-select
          v-model="workbenchStore.battleConfig.teamSelection.mode"
          size="small"
          class="w-full"
          :disabled="!workbenchStore.battleConfig.teamSelection.enabled"
        >
          <el-option label="仅查看" value="VIEW_ONLY" />
          <el-option label="团队选择" value="TEAM_SELECTION" />
          <el-option label="全队参战" value="FULL_TEAM" />
        </el-select>

        <label class="form-label">最小队伍</label>
        <el-input-number
          v-model="workbenchStore.battleConfig.teamSelection.minTeamSize"
          :min="1"
          :max="workbenchStore.battleConfig.teamSelection.maxTeamSize"
          :disabled="!workbenchStore.battleConfig.teamSelection.enabled"
          size="small"
          controls-position="right"
          class="w-full"
        />

        <label class="form-label">最大队伍</label>
        <el-input-number
          v-model="workbenchStore.battleConfig.teamSelection.maxTeamSize"
          :min="workbenchStore.battleConfig.teamSelection.minTeamSize"
          :max="12"
          :disabled="!workbenchStore.battleConfig.teamSelection.enabled"
          size="small"
          controls-position="right"
          class="w-full"
        />
      </div>
    </section>

    <footer class="launch-footer">
      <div class="launch-todo">
        TODO: 战斗测试将改为“工作台内定制视窗 + 单一控制器”模式，不能直接复用 local-battle。
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useBattleWorkbenchStore } from '@/stores/battleWorkbench'
import { usePetStorageStore } from '@/stores/petStorage'
import type { PackWorkbenchFileEntry } from '@/components/pack-editor/workbenchEditorRegistry'

type OpenEditorTab = {
  id: string
  packFolder: string
  entry: PackWorkbenchFileEntry
}

const props = defineProps<{
  selectedPackFolder: string
  selectedEntry: PackWorkbenchFileEntry | null
  openTabs: OpenEditorTab[]
}>()

const petStorage = usePetStorageStore()
const workbenchStore = useBattleWorkbenchStore()

const selectedOpenTabId = ref('')

const availableTeams = computed(() => {
  return petStorage.teams
    .map((team, index) => ({
      index,
      label: `${team.name} (${team.pets.length}只精灵)`,
      petCount: team.pets.length,
    }))
    .filter(item => item.petCount > 0)
})

const openTabOptions = computed(() => {
  return props.openTabs.map(tab => ({
    id: tab.id,
    label: `${tab.packFolder}/${tab.entry.relativePath}`,
  }))
})

const canAddCurrentEntry = computed(() => {
  return Boolean(props.selectedPackFolder && props.selectedEntry)
})

const rngSeedInput = computed<number | undefined>({
  get() {
    return workbenchStore.battleConfig.rngSeed
  },
  set(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      workbenchStore.battleConfig.rngSeed = value
      return
    }
    workbenchStore.battleConfig.rngSeed = undefined
  },
})

const turnLimitEnabled = computed<boolean>({
  get() {
    return typeof workbenchStore.timerConfig.turnTimeLimit === 'number'
  },
  set(enabled) {
    if (enabled) {
      workbenchStore.timerConfig.turnTimeLimit = workbenchStore.timerConfig.turnTimeLimit ?? 30
      return
    }
    workbenchStore.timerConfig.turnTimeLimit = undefined
  },
})

const totalLimitEnabled = computed<boolean>({
  get() {
    return typeof workbenchStore.timerConfig.totalTimeLimit === 'number'
  },
  set(enabled) {
    if (enabled) {
      workbenchStore.timerConfig.totalTimeLimit = workbenchStore.timerConfig.totalTimeLimit ?? 1200
      return
    }
    workbenchStore.timerConfig.totalTimeLimit = undefined
  },
})

function resolveDefaultTeamIndexes() {
  const player1 = availableTeams.value[0]?.index ?? 0
  const player2 = availableTeams.value.find(item => item.index !== player1)?.index ?? player1
  return { player1, player2 }
}

function ensureSelectedTeams(): void {
  const validTeamIndexSet = new Set(availableTeams.value.map(item => item.index))
  const defaults = resolveDefaultTeamIndexes()

  if (!validTeamIndexSet.has(workbenchStore.selectedPlayer1TeamIndex ?? -1)) {
    workbenchStore.selectedPlayer1TeamIndex = defaults.player1
  }

  if (!validTeamIndexSet.has(workbenchStore.selectedPlayer2TeamIndex ?? -1)) {
    workbenchStore.selectedPlayer2TeamIndex = defaults.player2
  }

  workbenchStore.ensureDefaultTeams(defaults.player1, defaults.player2)
}

function addCurrentEntry(): void {
  if (!props.selectedPackFolder || !props.selectedEntry) {
    ElMessage.warning('当前没有可添加的文件')
    return
  }

  const added = workbenchStore.addResource(props.selectedPackFolder, props.selectedEntry)
  if (!added) {
    ElMessage.info('该文件已经在组合资源里')
    return
  }

  ElMessage.success('已添加到组合资源')
}

function addSelectedOpenTab(): void {
  if (!selectedOpenTabId.value) return

  const target = props.openTabs.find(tab => tab.id === selectedOpenTabId.value)
  if (!target) {
    ElMessage.warning('未找到对应视窗')
    return
  }

  const added = workbenchStore.addResource(target.packFolder, target.entry)
  if (!added) {
    ElMessage.info('该视窗资源已经在组合资源里')
    return
  }

  ElMessage.success('视窗资源已加入控制器')
}

function removeResource(resourceId: string): void {
  workbenchStore.removeResource(resourceId)
}

function clearResources(): void {
  workbenchStore.clearResources()
}

watch(
  () => props.openTabs,
  tabs => {
    if (tabs.length === 0) {
      selectedOpenTabId.value = ''
      return
    }

    if (!tabs.some(tab => tab.id === selectedOpenTabId.value)) {
      selectedOpenTabId.value = tabs[0].id
    }
  },
  { deep: true, immediate: true },
)

watch(
  availableTeams,
  () => {
    ensureSelectedTeams()
  },
  { immediate: true },
)

onMounted(() => {
  ensureSelectedTeams()
})
</script>

<style scoped>
.battle-workbench-controller {
  height: 100%;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #202834;
  color: #d6dde8;
}

.controller-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d3745;
  padding-bottom: 10px;
}

.controller-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9eabc1;
}

.controller-section {
  border: 1px solid #2d3745;
  border-radius: 10px;
  background: #253041;
  padding: 10px;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #9eabc1;
  margin-bottom: 8px;
}

.resource-toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px;
  margin-bottom: 8px;
}

.open-tab-select {
  min-width: 0;
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.resource-item {
  border: 1px solid #324055;
  border-radius: 8px;
  padding: 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  background: #222c3a;
}

.resource-main {
  min-width: 0;
  flex: 1;
}

.resource-title {
  font-size: 12px;
  font-weight: 600;
  color: #edf2ff;
}

.resource-detail {
  font-size: 11px;
  color: #9eabc1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resource-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.form-grid {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.form-label {
  font-size: 11px;
  color: #9eabc1;
}

.option-grid {
  display: grid;
  gap: 8px;
}

.form-grid.disabled {
  opacity: 0.55;
}

.launch-footer {
  margin-top: auto;
  display: block;
  padding-top: 6px;
}

.launch-todo {
  font-size: 12px;
  color: #9eabc1;
  line-height: 1.5;
  border: 1px dashed #3f4c60;
  border-radius: 8px;
  background: #1f2733;
  padding: 10px 12px;
}

.battle-workbench-controller :deep(.el-empty__description p) {
  color: #9eabc1;
}
</style>
