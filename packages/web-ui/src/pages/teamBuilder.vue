<template>
  <el-container class="team-builder" direction="vertical">
    <!-- 玩家信息栏 -->
    <el-header class="player-header" height="auto">
      <div class="header-content">
        <el-tag type="info" size="large"> 当前玩家：{{ playerStore.name || '未命名训练师' }} </el-tag>
        <div class="header-actions">
          <el-button @click="showStorage = true">
            <el-icon><Box /></el-icon>
            打开仓库
          </el-button>
        </div>
      </div>
    </el-header>

    <el-main class="main-content">
      <el-row :gutter="16">
        <!-- 队伍列表 -->
        <el-col :span="7">
          <div class="team-list">
            <VueDraggable
              v-model="currentTeam"
              :animation="150"
              handle=".drag-handle"
              @start="onStart"
              @end="handleDragEnd"
              :disabled="currentTeam.length <= 1"
            >
              <!-- 每个拖拽项 -->
              <TransitionGroup type="transition" :name="!drag ? 'pet-list' : undefined">
                <el-card
                  v-for="pet in currentTeam"
                  :key="pet.id"
                  class="pet-card drag-item drag-handle"
                  :class="{ selected: selectedPetId === pet.id }"
                  @click="selectedPetId = pet.id"
                  size="small"
                >
                  <template #header>
                    <div class="card-header">
                      <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="size-16" />
                      <span class="pet-name">{{ pet.name }}</span>
                      <el-button
                        type="danger"
                        icon="Delete"
                        circle
                        @click.stop="removePet(pet.id)"
                        :disabled="currentTeam.length === 1"
                      />
                    </div>
                  </template>

                  <div class="pet-info">
                    <el-tag type="info">#{{ pet.id.slice(-6) }}</el-tag>
                    <el-tag type="success">{{
                      i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, {
                        ns: 'species',
                      })
                    }}</el-tag>
                    <el-tag class="level-tag">Lv.{{ pet.level }}</el-tag>
                  </div>
                </el-card>
              </TransitionGroup>
            </VueDraggable>

            <el-button type="primary" class="add-button" @click="addNewPet" :disabled="currentTeam.length >= 6">
              <el-icon><Plus /></el-icon>
              添加精灵
            </el-button>
          </div>
        </el-col>

        <!-- 详细配置 -->
        <el-col :span="16" v-if="selectedPet">
          <el-form :model="selectedPet" label-width="100px" label-position="left" :rules="formRules" ref="formRef">
            <el-card shadow="never">
              <!-- ID显示 -->
              <el-form-item label="唯一ID">
                <el-input v-model="selectedPet.id" disabled />
              </el-form-item>

              <!-- 基础信息 -->
              <el-form-item label="名称" prop="name">
                <el-input v-model="selectedPet.name" size="small" />
              </el-form-item>

              <el-form-item label="种族" prop="species">
                <el-select
                  v-model="selectedPet.species"
                  placeholder="选择种族"
                  filterable
                  @change="handleSpeciesChange"
                >
                  <el-option
                    v-for="species in gameDataStore.speciesList"
                    :key="species.id"
                    :label="
                      i18next.t(`${species.id}.name`, {
                        ns: 'species',
                      })
                    "
                    :value="species.id"
                  >
                    <span class="species-option">
                      {{
                        i18next.t(`${species.id}.name`, {
                          ns: 'species',
                        })
                      }}
                      <el-tag size="small">{{ species.id }}</el-tag>
                    </span>
                  </el-option>
                </el-select>
              </el-form-item>
              <el-form-item label="等级" prop="level">
                <el-input-number v-model="selectedPet.level" :min="1" :max="100" controls-position="right" />
              </el-form-item>
              <el-form-item label="体重" prop="weight">
                <el-input-number
                  v-model="selectedPet.weight"
                  :min="currentSpecies?.weightRange[0]"
                  :max="currentSpecies?.weightRange[1]"
                  controls-position="right"
                />
              </el-form-item>
              <el-form-item label="身高" prop="height">
                <el-input-number
                  v-model="selectedPet.height"
                  :min="currentSpecies?.heightRange[0]"
                  :max="currentSpecies?.heightRange[1]"
                  controls-position="right"
                />
              </el-form-item>
              <el-form-item label="性别" prop="gender">
                <el-select v-model="selectedPet.gender" placeholder="选择性别" :disabled="!currentSpecies?.genderRatio">
                  <el-option
                    v-for="gender in Object.values(Gender)"
                    :key="gender"
                    :label="genderChineseMap[gender as Gender]"
                    :value="gender"
                  />
                </el-select>
              </el-form-item>

              <el-divider content-position="left">特性配置</el-divider>
              <el-form-item label="特性" prop="ability">
                <el-select v-model="selectedPet.ability" placeholder="选择特性" :disabled="!currentSpecies">
                  <el-option
                    v-for="ability in abilityOptions"
                    :key="ability.id"
                    :label="
                      i18next.t(`${ability.id}.name`, {
                        ns: ['mark', 'mark_ability', 'mark_emblem'],
                      })
                    "
                    :value="ability.id"
                  />
                </el-select>
              </el-form-item>

              <el-divider content-position="left">纹章配置</el-divider>
              <el-form-item label="纹章" prop="emblem">
                <el-select v-model="selectedPet.emblem" placeholder="选择纹章" clearable>
                  <el-option
                    v-for="emblem in elblemOptions"
                    :key="emblem.id"
                    :label="
                      i18next.t(`${emblem.id}.name`, {
                        ns: ['mark', 'mark_ability', 'mark_emblem'],
                      })
                    "
                    :value="emblem.id"
                  />
                </el-select>
              </el-form-item>

              <el-divider content-position="left">性格配置</el-divider>
              <el-form-item label="性格" prop="nature">
                <el-select v-model="selectedPet.nature" placeholder="选择性格" style="width: 200px">
                  <el-option
                    v-for="nature in Object.values(Nature)"
                    :key="nature"
                    :label="natureChineseMap[nature]"
                    :value="nature"
                  >
                    <span class="nature-option">
                      {{ natureChineseMap[nature] }}
                      <el-tag
                        v-for="(value, stat) in NatureMap[nature as Nature]"
                        :key="stat"
                        :type="value > 1 ? 'success' : value < 1 ? 'danger' : 'info'"
                        size="small"
                      >
                        {{ stat.toUpperCase() }} {{ value }}x
                      </el-tag>
                    </span>
                  </el-option>
                </el-select>
              </el-form-item>

              <el-divider content-position="left">能力值配置</el-divider>
              <div class="ev-total">
                <el-tag type="warning">当前学习力总和: {{ currentEVTotal }}/510</el-tag>
              </div>
              <el-row :gutter="20">
                <el-col v-for="stat in statList" :key="stat" :xs="24" :sm="12" :md="8">
                  <el-card shadow="never" class="stat-card">
                    <div class="stat-header">
                      <span class="stat-name">{{ statChineseMap[stat] }}</span>
                      <div class="stat-values">
                        <span class="final-value">{{ computedStats[stat] }}</span>
                        <el-tag type="info" size="small">EV: {{ selectedPet?.evs[stat] || 0 }}</el-tag>
                      </div>
                    </div>

                    <el-form-item :label="`学习力`" :prop="`evs.${stat}`">
                      <el-slider
                        v-model="selectedPet.evs[stat]"
                        :class="sliderStyle"
                        @update:model-value="val => handleEVUpdate(stat, val as number)"
                        :min="0"
                        :max="255"
                        :step="4"
                        show-input
                        :format-tooltip="(val: number) => `${val} EV`"
                      />
                    </el-form-item>

                    <div class="stat-details">
                      <div class="detail-group">
                        <div class="detail-item">
                          <span class="label">种族</span>
                          <span class="value">{{ currentSpecies?.baseStats[stat] || 0 }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="label">个体</span>
                          <el-input-number
                            v-model="selectedPet.ivs[stat]"
                            :min="0"
                            :max="31"
                            :step="1"
                            controls-position="right"
                            size="small"
                          />
                        </div>
                        <div class="detail-item" v-if="stat !== 'hp'">
                          <span class="label">性格</span>
                          <span
                            class="value"
                            :data-positive="getNatureMultiplier(selectedPet.nature, stat) > 1"
                            :data-negative="getNatureMultiplier(selectedPet.nature, stat) < 1"
                          >
                            {{ getNatureMultiplier(selectedPet.nature, stat) }}x
                          </span>
                        </div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <!-- 技能配置 -->
              <el-divider content-position="left">技能配置</el-divider>
              <el-row :gutter="20">
                <el-col v-for="(_, index) in 5" :key="index">
                  <el-form-item :label="`技能 ${index + 1}`">
                    <el-select
                      v-model="displayedSkills[index]"
                      :disabled="!currentSpecies"
                      @change="val => handleSkillChange(val, index)"
                      clearable
                    >
                      <el-option
                        v-for="skill in skillOptions"
                        :key="skill?.id"
                        :label="
                          i18next.t(`${skill.id}.name`, {
                            ns: 'skill',
                          })
                        "
                        :value="skill?.id ?? ''"
                        :disabled="skill?.disabled"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
            </el-card>
          </el-form>
        </el-col>
      </el-row>
    </el-main>

    <!-- 全局操作栏 -->
    <div class="global-actions">
      <el-button type="primary" @click="saveCurrentTeam">
        <el-icon><Check /></el-icon>
        保存队伍
      </el-button>
      <el-button @click="exportTeamConfig">
        <el-icon><Download /></el-icon>
        导出配置
      </el-button>
      <el-button @click="importTeamConfig">
        <el-icon><Upload /></el-icon>
        导入配置
      </el-button>
    </div>
    <el-dialog v-model="showStorage" title="精灵仓库" width="80%">
      <storage-manager @select-pet="handleSelectFromStorage" />
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { type FormInstance, type FormRules } from 'element-plus'
import { nanoid } from 'nanoid'
import { usePlayerStore } from '@/stores/player'
import { useGameDataStore } from '@/stores/gameData'
import { usePetStorageStore } from '@/stores/petStorage'
import StorageManager from '@/components/StorageManager.vue'
import { type PetSchemaType, PetSetSchema } from '@test-battle/schema'
import { useTranslation } from 'i18next-vue'
import { Gender, NatureMap } from '@test-battle/const'
import { Nature } from '@test-battle/const'
import { VueDraggable } from 'vue-draggable-plus'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import PetIcon from '@/components/PetIcon.vue'

const { t, i18next } = useTranslation()

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const petStorage = usePetStorageStore()

// 响应式状态
const selectedPetId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const showStorage = ref(false)

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'

const statList: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

const drag = ref(false)

const onStart = () => {
  drag.value = true
}

const handleDragEnd = () => {
  nextTick(() => {
    drag.value = false
  })
  try {
    // 更新 Pinia 存储
    petStorage.updateTeamOrder(
      petStorage.currentTeamIndex,
      // 创建新数组引用确保响应性
      [...currentTeam.value],
    )

    // 自动保存机制
    petStorage.saveToLocal()

    // 视觉反馈
    ElMessage.success('队伍顺序已自动保存')
  } catch (error) {
    console.error('拖拽操作保存失败:', error)
    ElMessage.error('队伍顺序保存失败，请手动保存')
  }
}

// 表单验证规则
const formRules: FormRules = {
  name: [
    { required: true, message: '请输入精灵名称', trigger: 'blur' },
    { max: 20, message: '名称不能超过20个字符', trigger: 'blur' },
  ],
  species: [
    {
      required: true,
      message: '请选择精灵种族',
      trigger: 'change',
    },
    {
      validator: (_, value, callback) => {
        if (!gameDataStore.speciesList.find(v => v.id === selectedPet.value?.species || '')) {
          callback(new Error('无效的种族ID'))
        } else {
          callback()
        }
      },
      trigger: 'change',
    },
  ],
  evs: [
    {
      validator: () => currentEVTotal.value <= 510,
      message: '学习力总和不能超过510',
      trigger: 'change',
    },
  ],
  gender: [
    {
      required: true,
      message: '请选择性别',
      trigger: 'change',
      validator: (_, value, callback) => {
        if (!currentSpecies.value?.genderRatio && value !== Gender.NoGender) {
          callback(new Error('该物种无性别'))
        } else {
          callback()
        }
      },
    },
  ],
}

// 计算属性
const currentTeam = computed<PetSchemaType[]>({
  get: () => petStorage.getCurrentTeam(),
  set: newOrder => {
    petStorage.updateTeamOrder(petStorage.currentTeamIndex, newOrder)
  },
})

const selectedPet = computed<PetSchemaType | null>(() => {
  return currentTeam.value.find(p => p.id === selectedPetId.value) || null
})

const currentSpecies = computed(() => {
  return gameDataStore.speciesList.find(v => v.id === selectedPet.value?.species || '')
})

const filteredAbility = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.ability
    .map(ability => gameDataStore.marksList.find(m => m.id === ability))
    .filter(Boolean)
})

const filteredElblem = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.emblem.map(elblem => gameDataStore.marksList.find(m => m.id === elblem)).filter(Boolean)
})

const filteredSkills = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.learnable_skills
    .filter(learnable => (selectedPet.value?.level ?? 0) >= learnable.level)
    .map(learnable => gameDataStore.skillList.find(v => v.id === learnable.skill_id))
    .filter(Boolean)
})

// 从仓库选择精灵
const handleSelectFromStorage = (pet: PetSchemaType) => {
  // 检查队伍容量
  if (currentTeam.value.length >= 6) {
    ElMessage.warning('队伍已满，无法添加更多精灵')
    return
  }
  // 移动精灵到队伍
  petStorage.moveToTeam(pet.id, petStorage.currentTeamIndex)
}

const natureChineseMap: Record<Nature, string> = {
  [Nature.Adamant]: '固执',
  [Nature.Bashful]: '害羞',
  [Nature.Bold]: '大胆',
  [Nature.Brave]: '勇敢',
  [Nature.Calm]: '冷静',
  [Nature.Careful]: '慎重',
  [Nature.Docile]: '坦率',
  [Nature.Gentle]: '温和',
  [Nature.Hardy]: '勤奋',
  [Nature.Hasty]: '急躁',
  [Nature.Impish]: '淘气',
  [Nature.Jolly]: '爽朗',
  [Nature.Lax]: '乐天',
  [Nature.Lonely]: '怕寂寞',
  [Nature.Mild]: '温和',
  [Nature.Modest]: '内敛',
  [Nature.Naive]: '天真',
  [Nature.Naughty]: '顽皮',
  [Nature.Quiet]: '冷静',
  [Nature.Quirky]: '古怪',
  [Nature.Rash]: '马虎',
  [Nature.Relaxed]: '悠闲',
  [Nature.Sassy]: '自大',
  [Nature.Serious]: '认真',
  [Nature.Timid]: '胆小',
}

const statChineseMap: Record<StatKey, string> = {
  hp: '体力',
  atk: '攻击',
  def: '防御',
  spa: '特攻',
  spd: '特防',
  spe: '速度',
}

const genderChineseMap: Record<Gender, string> = {
  [Gender.Male]: '雄性',
  [Gender.Female]: '雌性',
  [Gender.NoGender]: '无性别',
}

const displayedSkills = computed({
  get: () => {
    return Array.from({ length: 5 }, (_, i) => selectedPet.value?.skills[i] || '')
  },
  set: newValues => {
    if (!selectedPet.value) return

    // 保留所有位置，空字符串转为undefined后过滤
    selectedPet.value.skills = newValues.map(s => s || undefined).filter((s): s is string => s !== undefined)
  },
})

const abilityOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentAblity = selectedPet.value.ability
  return filteredAbility.value
    .filter(ability => !!ability)
    .map(ability => ({
      ...ability,
      disabled: currentAblity === ability.id,
    }))
})

const elblemOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentElblem = selectedPet.value.emblem
  return filteredElblem.value
    .filter(elblem => !!elblem)
    .map(elblem => ({
      ...elblem,
      disabled: currentElblem === elblem.id,
    }))
})

const skillOptions = computed(() => {
  const currentSkills = displayedSkills.value.filter(s => s)
  return filteredSkills.value
    .filter(skill => !!skill)
    .map(skill => ({
      ...skill,
      disabled: currentSkills.includes(skill.id),
    }))
})

const addNewPet = () => {
  if (currentTeam.value.length >= 6) {
    ElMessage.warning('队伍已满，最多只能添加六个精灵')
    return
  }

  const newPet: PetSchemaType = {
    id: nanoid(),
    name: '迪兰特',
    species: 'pet_dilante',
    level: 100,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    skills: [],
    gender: Gender.Male,
    nature: Nature.Adamant,
    ability: 'mark_ability_zhongjie',
    emblem: 'mark_emblem_zhuiji',
  }

  // 先添加到仓库再移动到队伍
  petStorage.addToStorage(newPet)
  petStorage.moveToTeam(newPet.id, petStorage.currentTeamIndex)
  selectedPetId.value = newPet.id
  handleSpeciesChange(newPet.species)
}

const removePet = (petId: string) => {
  if (currentTeam.value.length <= 1) {
    ElMessage.warning('队伍中至少需要保留一个精灵')
    return
  }
  petStorage.moveToPC(petId)
}

const saveCurrentTeam = async () => {
  try {
    if (currentTeam.value.length < 1 || currentTeam.value.length > 6) {
      ElMessage.error('队伍数量必须在1到6之间')
      return
    }

    await formRef.value?.validate()
    petStorage.saveToLocal()
    ElMessage.success('队伍保存成功')
  } catch (err) {
    ElMessage.error('保存失败，请检查表单')
  }
}

const handleSpeciesChange = (newSpeciesId: string) => {
  if (!selectedPet.value) return

  // 获取新的种族数据
  const species = gameDataStore.getSpecies(newSpeciesId)
  if (!species) return

  petStorage.$patch(state => {
    const pet = state.teams[state.currentTeamIndex].pets.find(p => p.id === selectedPetId.value)
    if (pet) {
      pet.skills = [] // 直接置空数组，displayedSkills会自动处理显示
      pet.name = i18next.t(`${species.id}.name`, {
        ns: 'species',
      })
      pet.evs = {
        hp: 0,
        atk: 0,
        def: 0,
        spa: 0,
        spd: 0,
        spe: 0,
      }
      pet.ability = species.ability[0] ?? undefined
      pet.emblem = undefined
      if (!species.genderRatio) {
        pet.gender = Gender.NoGender
      } else {
        pet.gender = species.genderRatio[0] > 0 ? Gender.Female : Gender.Male
      }

      pet.height = species.heightRange[1]
      pet.weight = species.weightRange[1]
    }
  })
}

const currentEVTotal = computed(() => {
  if (!selectedPet.value) return 0
  return Object.values(selectedPet.value.evs).reduce((a, b) => a + b, 0)
})

const handleEVUpdate = (stat: StatKey, value: number) => {
  if (!selectedPet.value) return

  const currentStatEV = selectedPet.value.evs[stat]
  const otherEVSum = currentEVTotal.value - currentStatEV
  let maxAllowed = Math.min(255, 510 - otherEVSum)

  // 确保maxAllowed是4的倍数
  maxAllowed = Math.floor(maxAllowed / 4) * 4

  const roundedValue = Math.round(value / 4) * 4
  const clampedValue = Math.min(Math.max(0, roundedValue), maxAllowed)

  selectedPet.value.evs[stat] = clampedValue
}

// 添加视觉提示
const sliderStyle = computed(() => (stat: StatKey) => {
  if (!selectedPet.value) return {}
  const percent = (selectedPet.value.evs[stat] / 255) * 100
  const otherSum = currentEVTotal.value - selectedPet.value.evs[stat]
  const available = 510 - otherSum
  const effectiveMax = Math.min(255, available)

  return {
    '--el-slider-runway-bg-color': effectiveMax < 255 ? '#ffd6d6' : 'var(--el-border-color-light)',
  }
})

const computedStats = computed(() => {
  if (!selectedPet.value || !currentSpecies.value) return {} as Record<StatKey, number>

  const stats: Record<StatKey, number> = {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  }

  const level = selectedPet.value.level
  const baseStats = currentSpecies.value.baseStats
  const nature = selectedPet.value.nature // 从宠物数据获取性格

  // HP计算
  stats.hp = Math.floor(
    ((2 * baseStats.hp + selectedPet.value.ivs.hp + Math.floor(selectedPet.value.evs.hp / 4)) * level) / 100 +
      level +
      10,
  )

  // 其他属性计算
  const otherStats: Exclude<StatKey, 'hp'>[] = ['atk', 'def', 'spa', 'spd', 'spe']
  otherStats.forEach(stat => {
    const base = Math.floor(
      ((2 * baseStats[stat] + selectedPet.value!.ivs[stat] + Math.floor(selectedPet.value!.evs[stat] / 4)) * level) /
        100 +
        5,
    )

    // 应用性格修正
    const natureMultiplier = getNatureMultiplier(nature, stat)
    stats[stat] = Math.floor(base * natureMultiplier)
  })

  return stats
})

// 添加性格修正映射
const getNatureMultiplier = (nature: Nature, stat: Exclude<StatKey, 'hp'>): number => {
  return NatureMap[nature]?.[stat] ?? 1.0
}

const debouncedSave = debounce(() => {
  if (!selectedPet.value) return

  try {
    petStorage.saveToLocal()
  } catch (err) {
    ElMessage.error('自动保存失败')
  }
}, 100)

watch(
  () => ({
    skills: selectedPet.value?.skills,
    evs: selectedPet.value?.evs,
    ability: selectedPet.value?.ability,
    emblem: selectedPet.value?.emblem,
  }),
  (newVal, oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
      debouncedSave()
    }
  },
  { deep: true },
)

const handleSkillChange = (newVal: string, index: number) => {
  const newSkills = [...displayedSkills.value]

  // 处理清空操作（newVal为null）
  const value = newVal ?? ''

  // 检查重复
  if (value && newSkills.filter(s => s === value).length > 1) {
    ElMessage.warning('该技能已存在于其他槽位')
    newSkills[index] = ''
    displayedSkills.value = newSkills
    return
  }

  // 更新指定位置的值
  newSkills[index] = value
  displayedSkills.value = newSkills
  debouncedSave()
}

function debounce(fn: Function, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: any[]) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

const exportTeamConfig = () => {
  try {
    // 直接使用YAML格式，不再询问
    const filename = `team-${new Date().toISOString().slice(0, 10)}.yaml`

    // 创建数据副本
    const exportData = currentTeam.value.map(pet => ({
      ...pet,
      id: undefined,
      maxHp: undefined,
    }))

    // 使用YAML序列化
    const content = stringify(exportData, {
      indent: 2,
      aliasDuplicateObjects: false,
    })

    // 创建下载链接
    const blob = new Blob([content], {
      type: 'application/yaml',
    })

    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()

    URL.revokeObjectURL(link.href)

    ElMessage.success('队伍配置已导出为YAML格式')
  } catch (err) {
    console.error('导出失败:', err)
    ElMessage.error('导出失败，请检查队伍数据')
  }
}

const importTeamConfig = async () => {
  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.yaml,.yml' // 仍然允许JSON文件

    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async e => {
        try {
          const content = e.target?.result?.toString() || ''
          // 统一使用YAML解析（兼容JSON）
          const parsedData = parse(content, {
            strict: true,
            maxAliasCount: 100,
          })

          // 统一验证逻辑
          const importedTeam = PetSetSchema.parse(parsedData)

          if (importedTeam.length < 1 || importedTeam.length > 6) {
            throw new Error('队伍数量必须在1-6之间')
          }

          const newTeam = importedTeam.map(pet => ({
            ...pet,
            id: nanoid(),
            skills: pet.skills.slice(0, 5),
            gender: pet.gender ?? getDefaultGender(pet.species),
            height: pet.height ?? gameDataStore.getSpecies(pet.species)?.heightRange[1] ?? 0,
            weight: pet.weight ?? gameDataStore.getSpecies(pet.species)?.weightRange[1] ?? 0,
          }))

          petStorage.$patch(state => {
            state.teams[state.currentTeamIndex].pets = newTeam
          })

          petStorage.saveToLocal()
          ElMessage.success(`成功导入 ${newTeam.length} 只精灵（${file.name}）`)
        } catch (err) {
          console.error('导入失败:', err)
          const errorMsg =
            err instanceof z.ZodError ? `YAML/JSON格式校验失败: ${err.errors[0].message}` : (err as Error).message

          ElMessage.error(`导入失败: ${errorMsg}`)
        }
      }
      reader.readAsText(file)
    }

    input.click()
  } catch (err) {
    ElMessage.error('导入过程中发生错误')
  }
}

function getDefaultGender(speciesId: string): Gender {
  const species = gameDataStore.getSpecies(speciesId)
  if (!species?.genderRatio) return Gender.NoGender
  return species.genderRatio[0] > 0 ? Gender.Female : Gender.Male
}
</script>

<style scoped>
/* 基础布局 */
.team-builder {
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 头部区域优化 */
.player-header {
  padding: 12px 16px;
  .header-content {
    gap: 8px;

    .el-tag {
      font-size: 14px;
      padding: 8px 12px;
    }
  }

  .header-actions {
    gap: 12px;
  }
}

.drag-item {
  cursor: grab;
  user-select: none; /* 防止文字被选中 */
  transition: transform 0.2s ease;

  /* 移动端优化 */
  touch-action: none; /* 禁用默认触摸行为 */

  &:active {
    cursor: grabbing;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}

/* 调整删除按钮位置 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 防止表单元素触发拖拽 */
.el-input,
.el-select,
.el-slider {
  cursor: auto; /* 恢复默认光标 */

  &:active {
    cursor: auto;
  }
}

.team-list {
  gap: 8px;

  .pet-card {
    transition: all 0.2s ease;
    cursor: pointer;

    &:hover {
      border-color: var(--el-color-primary-light-5);
    }

    &.selected {
      /* 边框强调 */
      border: 2px solid var(--el-color-primary);
      box-shadow: 0 2px 8px rgba(var(--el-color-primary-rgb), 0.15);

      /* 背景色强调 */
      background-color: rgba(var(--el-color-primary-rgb), 0.05);

      /* 左侧标记线 */
      position: relative;
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--el-color-primary);
      }

      /* 缩放效果 */
      transform: scale(1.02);
    }
  }

  /* 选中卡片内部元素样式 */
  .pet-card.selected {
    .pet-name {
      color: var(--el-color-primary);
      font-weight: bold;
    }

    .el-tag:not(.level-tag) {
      border-color: var(--el-color-primary-light-5);
    }
  }
}

/* 通用颜色定义 */
.value[data-positive='true'] {
  color: var(--el-color-success);
}
.value[data-positive='false'] {
  color: var(--el-color-danger);
}

.global-actions {
  /* 基础定位 */
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;

  /* 布局样式 */
  display: flex;
  gap: 16px;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 28px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(8px);
  border: 1px solid var(--el-border-color-lighter);

  /* 按钮统一样式 */
  .el-button {
    padding: 12px 24px;
    font-weight: 500;
    letter-spacing: 0.5px;
    transition: all 0.3s var(--el-transition-function-fast-bezier);

    /* 带图标按钮样式 */
    .el-icon {
      margin-right: 8px;
      font-size: 1.1em;
      vertical-align: -0.15em;
    }

    /* 主按钮强化 */
    &--primary {
      box-shadow: 0 2px 8px rgba(var(--el-color-primary-rgb), 0.3);

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(var(--el-color-primary-rgb), 0.4);
      }
    }

    /* 默认按钮悬停效果 */
    &:not(.el-button--primary):hover {
      background-color: var(--el-color-info-light-9);
      border-color: var(--el-color-info-light-5);
    }
  }

  /* 移动端适配 */
  @media (max-width: 768px) {
    bottom: 10px;
    padding: 8px 16px;
    gap: 12px;

    .el-button {
      padding: 10px 16px;
      font-size: 0.9em;

      .el-icon {
        margin-right: 6px;
        font-size: 1em;
      }
    }
  }
}
</style>
