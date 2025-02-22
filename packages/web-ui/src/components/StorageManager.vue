<template>
  <div class="storage-manager" v-if="storage">
    <el-tabs v-model="currentTeamIndex">
      <el-tab-pane v-for="(team, index) in storage.teams" :key="index" :label="`队伍 ${index + 1}`">
        <div class="team-section">
          <div class="team-grid">
            <div v-for="pet in team" :key="pet.id" class="pet-item" @click="$emit('select-pet', pet)">
              <pet-card :pet="pet" @remove="handleRemoveFromTeam(pet.id)" />
            </div>
            <el-button v-if="team.length < 6" @click="addToCurrentTeam" class="add-slot">
              <el-icon><Plus /></el-icon>
              添加精灵
            </el-button>
          </div>
        </div>
      </el-tab-pane>
      <el-button @click="createNewTeam">新建队伍</el-button>
    </el-tabs>

    <el-divider>仓库存储</el-divider>

    <div class="storage-grid">
      <div v-for="pet in storage?.pc" :key="pet.id" class="storage-item" @click="$emit('select-pet', pet)">
        <petCard :pet="pet" @remove="handleRemoveFromStorage(pet.id)" />
      </div>
    </div>
  </div>
  <el-empty v-else description="仓库加载中..."></el-empty>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePetStorageStore } from '../stores/petStorage'
import petCard from './petCard.vue'

const emit = defineEmits(['select-pet', 'update-team'])

const petStorage = usePetStorageStore()
const currentTeamIndex = ref(0)

// 获取当前玩家的存储数据
const storage = computed(() => {
  return petStorage
})

// 创建新队伍
const createNewTeam = () => {
  petStorage.createNewTeam()
  currentTeamIndex.value = storage.value.teams.length - 1
  emit('update-team')
}

// 添加到当前队伍
const addToCurrentTeam = async () => {
  if (storage.value.teams[currentTeamIndex.value].length >= 6) {
    ElMessage.warning('当前队伍已满')
    return
  }
  // 这里可以扩展打开精灵选择器
  emit('select-pet', null)
}

// 从队伍移除
const handleRemoveFromTeam = (petId: string) => {
  ElMessageBox.confirm('确定要将此精灵移回仓库吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    petStorage.moveToPC(petId)
    emit('update-team')
    ElMessage.success('已移回仓库')
  })
}

// 从仓库永久删除
const handleRemoveFromStorage = (petId: string) => {
  ElMessageBox.confirm('确定要永久删除此精灵吗？', '警告', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'error',
  }).then(() => {
    petStorage.removeFromStorage(petId)
    ElMessage.success('删除成功')
  })
}

// 切换队伍时更新索引
const updateTeamIndex = (index: number) => {
  petStorage.switchTeam(index)
  emit('update-team')
}
</script>

<style scoped>
.storage-manager {
  height: 60vh;
  display: flex;
  flex-direction: column;
}

.team-section {
  padding: 16px;
}

.team-grid,
.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  padding: 8px;
}

.pet-item {
  cursor: pointer;
  transition: transform 0.2s;
}

.pet-item:hover {
  transform: translateY(-2px);
}

.add-slot {
  width: 100%;
  height: 100%;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.el-divider {
  margin: 20px 0;
}
</style>
