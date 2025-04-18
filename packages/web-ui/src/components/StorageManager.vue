<template>
  <div class="storage-manager" v-if="storage">
    <el-tabs v-model="currentTeamIndex" type="card" @tab-remove="handleRemoveTeam" editable>
      <el-tab-pane
        v-for="(team, index) in petStorage.teams"
        :key="index"
        :name="index"
        :closable="petStorage.teams.length > 1"
      >
        <template #label>
          <div class="team-tab-label">
            <el-input
              v-if="editingIndex === index"
              v-model="tempTeamName"
              size="small"
              @blur="saveTeamName(index)"
              @keyup.enter="saveTeamName(index)"
            />
            <span v-else @click.stop="editTeamName(index)"> {{ team.name }}（{{ team.pets.length }}/6） </span>
          </div>
        </template>

        <div class="team-section">
          <VueDraggable :model-value="team.pets" @update:model-value="handleTeamUpdate(index, $event)">
            <div v-for="pet in team.pets" :key="pet.id" class="pet-item">
              <pet-card :pet="pet" @click="$emit('select-pet', pet)" @remove="handleRemoveFromTeam(pet.id, index)" />
            </div>
          </VueDraggable>
        </div>
      </el-tab-pane>
      <template #add>
        <el-button @click="createNewTeam" class="new-team-btn" icon="Plus"> 新建队伍 </el-button>
      </template>
    </el-tabs>

    <el-divider>仓库存储（{{ petStorage.storage.length }}只）</el-divider>

    <div class="storage-grid">
      <div v-for="pet in petStorage.storage" :key="pet.id" class="storage-item" @click="handleStorageClick(pet)">
        <pet-card :pet="pet" :show-remove="false" @dblclick="addToCurrentTeam(pet)" />
      </div>
    </div>
  </div>
  <el-empty v-else description="仓库加载中..."></el-empty>
</template>

<script setup lang="ts">
import { ref, computed, h } from 'vue'
import { type Action, type TabPaneName } from 'element-plus'
import { VueDraggable } from 'vue-draggable-plus'
import { usePetStorageStore } from '../stores/petStorage'
import petCard from './petCard.vue'
import type { Pet } from '@arcadia-eternity/schema'

const emit = defineEmits(['select-pet', 'update'])

const petStorage = usePetStorageStore()
const currentTeamIndex = ref(0)

const storage = computed(() => petStorage.storage)

const editingIndex = ref(-1)
const tempTeamName = ref('')

// 队伍名称编辑方法
const editTeamName = (index: number) => {
  tempTeamName.value = petStorage.teams[index].name
  editingIndex.value = index
}

const saveTeamName = (index: number) => {
  if (tempTeamName.value.trim()) {
    petStorage.teams[index].name = tempTeamName.value.trim()
    petStorage.saveToLocal()
  }
  editingIndex.value = -1
}

const handleTeamUpdate = (index: number, newPets: Pet[]) => {
  petStorage.teams[index].pets = newPets
  emitUpdate()
}

const createNewTeam = async () => {
  try {
    await ElMessageBox.prompt('请输入队伍名称', '新建队伍', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S/,
      inputErrorMessage: '队伍名称不能为空',
    })

    petStorage.createNewTeam()
  } catch {
    // 用户取消输入
  }
}

// 删除队伍
const handleRemoveTeam = (name: TabPaneName) => {
  const index = typeof name === 'string' ? parseInt(name) : name
  if (petStorage.teams.length <= 1) {
    ElMessage.warning('至少需要保留一个队伍')
    return
  }

  ElMessageBox.confirm(`确定要删除队伍 ${index + 1} 吗？`, '警告', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    petStorage.deleteTeam(index)
    currentTeamIndex.value = Math.min(currentTeamIndex.value, petStorage.teams.length - 1)
    emitUpdate()
    ElMessage.success('队伍已删除')
  })
}

// 从仓库双击直接添加
const addToCurrentTeam = (pet: Pet) => {
  if (petStorage.currentTeam.length >= 6) {
    ElMessage.warning('当前队伍已满')
    return
  }
  petStorage.moveToTeam(pet.id, petStorage.currentTeamIndex)
  emitUpdate()
}

const handleStorageClick = (pet: Pet) => {
  // 触发选择事件，可根据需要添加逻辑
  emit('select-pet', pet)
}

// 从队伍移除
const handleRemoveFromTeam = (petId: string, teamIndex: number) => {
  ElMessageBox.confirm('移回仓库还是永久删除？', '操作确认', {
    distinguishCancelAndClose: true,
    confirmButtonText: '移回仓库',
    cancelButtonText: '永久删除',
    type: 'warning',
  })
    .then(action => {
      if (action === 'confirm') {
        petStorage.moveToPC(petId)
      }
      emitUpdate()
    })
    .catch((action: Action) => {
      petStorage.removeFromStorage(petId)
      emitUpdate()
    })
}

// 处理拖拽排序
const handleDragEnd = (teamIndex: number) => {
  ElMessage.success('队伍顺序已保存')
}

// 统一触发更新
const emitUpdate = () => {
  emit('update')
  petStorage.saveToLocal()
}
</script>

<style scoped>
.draggable-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  width: 100%;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;

  .team-count {
    font-size: 0.8em;
    color: var(--el-text-color-secondary);
  }
}

.new-team-btn {
  margin-left: 12px;
  /* 添加以下样式确保按钮可见 */
  position: relative;
  z-index: 1;
  /* 调整按钮尺寸 */
  padding: 8px 12px;
}

.add-slot {
  width: 100%;
  height: 100%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  padding: 8px;
}

.pet-item {
  cursor: move;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }
}
</style>
