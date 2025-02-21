<template>
  <div class="team-builder">
    <el-row :gutter="20">
      <!-- 队伍列表 -->
      <el-col :span="8">
        <div class="team-list">
          <el-card
            v-for="(pet, index) in team"
            :key="index"
            class="pet-card"
            :class="{ selected: selectedIndex === index }"
            @click="selectedIndex = index"
          >
            <template #header>
              <div class="card-header">
                <span class="pet-name">{{ pet.name }}</span>
                <el-button type="danger" icon="Delete" circle @click.stop="removePet(index)" />
              </div>
            </template>
            <div class="pet-info">
              <el-tag type="info">{{ gameDataStore.getSpecies(pet.species)?.name }}</el-tag>
              <el-tag class="level-tag">Lv.{{ pet.level }}</el-tag>
            </div>
          </el-card>

          <el-button type="primary" class="add-button" @click="addPet">
            <el-icon><Plus /></el-icon>
            添加精灵
          </el-button>
        </div>
      </el-col>

      <!-- 详细配置 -->
      <el-col :span="16" v-if="selectedIndex !== null">
        <el-form :model="currentPet" label-width="100px" label-position="left" :rules="rules" ref="formRef">
          <el-card shadow="never">
            <!-- 基础信息 -->
            <el-form-item label="名称" prop="name">
              <el-input v-model="currentPet.name" />
            </el-form-item>

            <el-form-item label="种族" prop="species">
              <el-select v-model="currentPet.species" placeholder="请选择种族" filterable>
                <el-option
                  v-for="species in gameDataStore.species"
                  :key="species.id"
                  :label="species.name"
                  :value="species.id"
                >
                  <span class="option-label">{{ species.name }}</span>
                  <span class="option-id">({{ species.id }})</span>
                </el-option>
              </el-select>
            </el-form-item>

            <!-- 能力值配置 -->
            <el-divider content-position="left">能力值配置</el-divider>
            <el-row :gutter="20">
              <el-col v-for="stat in stats" :key="stat" :xs="12" :sm="8" :md="6">
                <el-form-item :label="stat.toUpperCase()" :prop="`evs.${stat}`" :rules="evRules">
                  <el-input-number
                    v-model.number="currentPet.evs[stat]"
                    :min="0"
                    :max="255"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
            </el-row>

            <!-- 技能配置 -->
            <el-divider content-position="left">技能配置</el-divider>
            <el-row :gutter="20">
              <el-col v-for="(_, index) in currentPet.skills" :key="index" :xs="12" :sm="8" :md="6">
                <el-form-item :label="`技能 ${index + 1}`">
                  <el-select v-model="currentPet.skills[index]" placeholder="选择技能" clearable>
                    <el-option
                      v-for="skill in gameDataStore.skills"
                      :key="skill.id"
                      :label="skill.name"
                      :value="skill.id"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>

            <!-- 特性/徽章 -->
            <el-divider content-position="left">特性与徽章</el-divider>
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="特性">
                  <el-select v-model="currentPet.ability">
                    <el-option
                      v-for="ability in gameDataStore.marks"
                      :key="ability.id"
                      :label="ability.name"
                      :value="ability.id"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="徽章">
                  <el-select v-model="currentPet.emblem">
                    <el-option
                      v-for="emblem in gameDataStore.marks"
                      :key="emblem.id"
                      :label="emblem.name"
                      :value="emblem.id"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
          </el-card>
        </el-form>
      </el-col>
    </el-row>

    <!-- 操作栏 -->
    <div class="action-bar">
      <el-button-group>
        <el-button type="primary" @click="importConfig">
          <el-icon><Upload /></el-icon>
          导入配置
        </el-button>
        <el-button type="success" @click="exportConfig">
          <el-icon><Download /></el-icon>
          导出配置
        </el-button>
      </el-button-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePetStore } from '../stores/pet'
import { useGameDataStore } from '../stores/gameData'
import type { FormInstance, FormRules } from 'element-plus'
import { Nature } from '@test-battle/const'

const petStore = usePetStore()
const gameDataStore = useGameDataStore()

// 响应式数据
const team = ref(petStore.team)
const selectedIndex = ref<number | null>(null)
const formRef = ref<FormInstance>()
const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

// 表单验证规则
const rules: FormRules = {
  name: [
    { required: true, message: '请输入精灵名称', trigger: 'blur' },
    { max: 20, message: '名称长度不能超过20个字符', trigger: 'blur' },
  ],
  species: [{ required: true, message: '请选择精灵种族', trigger: 'change' }],
}

const evRules: FormRules = {
  validator: (_, value, callback) => {
    if (value < 0 || value > 255) {
      callback(new Error('能力值范围0-255'))
    } else {
      callback()
    }
  },
}

// 当前选中的精灵
const currentPet = computed(() => {
  return selectedIndex.value !== null ? team.value[selectedIndex.value] : null
})

// 添加新精灵
const addPet = () => {
  team.value.push({
    name: '新精灵',
    species: '',
    level: 100,
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Adamant,
    skills: Array(4).fill(''),
    ability: '',
    emblem: '',
  })
  selectedIndex.value = team.value.length - 1
}

// 删除精灵
const removePet = (index: number) => {
  team.value.splice(index, 1)
  if (selectedIndex.value === index) selectedIndex.value = null
}

// 导入/导出逻辑保持不变...

// 数据持久化
watch(
  team,
  newVal => {
    petStore.saveTeam(newVal)
  },
  { deep: true },
)
</script>

<style scoped>
.team-builder {
  padding: 20px;
}

.team-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pet-card {
  margin-bottom: 12px;
  transition: all 0.3s;
  cursor: pointer;
}

.pet-card.selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pet-name {
  font-weight: bold;
}

.pet-info {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.level-tag {
  margin-left: auto;
}

.add-button {
  width: 100%;
  margin-top: 12px;
}

.action-bar {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
}

.option-label {
  margin-right: 8px;
}

.option-id {
  color: var(--el-text-color-secondary);
  font-size: 0.9em;
}
</style>
