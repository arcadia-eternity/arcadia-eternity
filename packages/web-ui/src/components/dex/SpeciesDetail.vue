<template>
  <div class="min-h-screen bg-white p-4">
    <div class="max-w-4xl mx-auto">
      <!-- 返回按钮 -->
      <div class="mb-6">
        <button
          @click="$router.push('/dex')"
          class="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors"
        >
          <ArrowLeftIcon class="w-5 h-5" />
          <span>{{ i18next.t('dex.backToDex', { ns: 'webui' }) }}</span>
        </button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="text-center py-16">
        <div class="text-gray-800 text-lg">加载中...</div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="text-center py-16">
        <div class="text-red-600 text-lg">{{ error }}</div>
      </div>

      <!-- 精灵详情 -->
      <div v-else-if="species" class="space-y-8">
        <!-- 精灵头部信息 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <div class="flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
            <!-- 精灵图标 -->
            <div class="flex-shrink-0">
              <PetIcon :id="species.num" class="w-32 h-32" />
            </div>

            <!-- 基本信息 -->
            <div class="flex-1 text-center md:text-left">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">
                {{ getSpeciesName() }}
              </h1>
              <div class="flex items-center justify-center md:justify-start space-x-4 mb-4">
                <ElementIcon :element="species.element" class="w-8 h-8" />
                <span class="text-gray-600">{{ getElementName() }}</span>
              </div>
              <div class="text-gray-500 text-sm">#{{ String(species.num).padStart(3, '0') }}</div>
            </div>
          </div>
        </div>

        <!-- 种族值 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.speciesDetail.stats', { ns: 'webui' }) }}
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div v-for="(value, stat) in species.baseStats" :key="stat" class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ getStatName(stat) }}</div>
              <div class="text-gray-800 font-bold text-lg">{{ value }}</div>
            </div>
          </div>
        </div>

        <!-- 物理特征 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">物理特征</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- 性别比例 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm mb-2">
                {{ i18next.t('dex.speciesDetail.genderRatio', { ns: 'webui' }) }}
              </div>
              <div v-if="species.genderRatio" class="space-y-1">
                <div class="flex items-center space-x-2">
                  <div class="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <span class="text-gray-800"
                    >{{ i18next.t('dex.speciesDetail.male', { ns: 'webui' }) }}: {{ species.genderRatio[1] }}%</span
                  >
                </div>
                <div class="flex items-center space-x-2">
                  <div class="w-3 h-3 bg-pink-500 rounded-full"></div>
                  <span class="text-gray-800"
                    >{{ i18next.t('dex.speciesDetail.female', { ns: 'webui' }) }}: {{ species.genderRatio[0] }}%</span
                  >
                </div>
              </div>
              <div v-else class="text-gray-600">
                {{ i18next.t('dex.speciesDetail.genderless', { ns: 'webui' }) }}
              </div>
            </div>

            <!-- 身高范围 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm mb-2">
                {{ i18next.t('dex.speciesDetail.heightRange', { ns: 'webui' }) }}
              </div>
              <div class="text-gray-800">
                {{ species.heightRange[0] }} - {{ species.heightRange[1] }}
                {{ i18next.t('dex.speciesDetail.cm', { ns: 'webui' }) }}
              </div>
            </div>

            <!-- 体重范围 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm mb-2">
                {{ i18next.t('dex.speciesDetail.weightRange', { ns: 'webui' }) }}
              </div>
              <div class="text-gray-800">
                {{ species.weightRange[0] }} - {{ species.weightRange[1] }}
                {{ i18next.t('dex.speciesDetail.kg', { ns: 'webui' }) }}
              </div>
            </div>
          </div>
        </div>

        <!-- 可学习技能 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.speciesDetail.learnableSkills', { ns: 'webui' }) }}
          </h2>
          <div class="space-y-2">
            <div
              v-for="skill in species.learnable_skills"
              :key="skill.skill_id"
              class="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors cursor-pointer"
              @click="$router.push(`/dex/skill/${skill.skill_id}`)"
            >
              <div class="flex items-center space-x-3">
                <div class="text-gray-600 text-sm w-12">Lv.{{ skill.level }}</div>
                <div class="text-gray-800">{{ getSkillName(skill.skill_id) }}</div>
                <div v-if="skill.hidden" class="text-xs bg-purple-600 text-white px-2 py-1 rounded">隐藏</div>
              </div>
              <ChevronRightIcon class="w-4 h-4 text-gray-600" />
            </div>
          </div>
        </div>

        <!-- 特性和纹章 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- 特性 -->
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4">
              {{ i18next.t('dex.speciesDetail.abilities', { ns: 'webui' }) }}
            </h2>
            <div class="space-y-2">
              <div
                v-for="ability in species.ability"
                :key="ability"
                class="bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                @click="$router.push(`/dex/mark/${ability}`)"
              >
                <div class="text-gray-800">{{ getMarkName(ability) }}</div>
              </div>
            </div>
          </div>

          <!-- 纹章 -->
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4">
              {{ i18next.t('dex.speciesDetail.emblems', { ns: 'webui' }) }}
            </h2>
            <div class="space-y-2">
              <div
                v-for="emblem in species.emblem"
                :key="emblem"
                class="bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                @click="$router.push(`/dex/mark/${emblem}`)"
              >
                <div class="text-gray-800">{{ getMarkName(emblem) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameDataStore } from '@/stores/gameData'
import { useTranslation } from 'i18next-vue'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import { ArrowLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'

const { i18next } = useTranslation()
const route = useRoute()
const router = useRouter()
const gameDataStore = useGameDataStore()

const loading = ref(true)
const error = ref<string | null>(null)

const species = computed(() => {
  const id = route.params.id as string
  return gameDataStore.species.byId[id] || null
})

function getSpeciesName(): string {
  if (!species.value) return ''
  try {
    return i18next.t(`${species.value.id}.name`, { ns: 'species' }) || species.value.id
  } catch {
    return species.value.id
  }
}

function getElementName(): string {
  if (!species.value) return ''
  try {
    return i18next.t(`element.${species.value.element}`, { ns: 'battle' }) || species.value.element
  } catch {
    return species.value.element
  }
}

function getStatName(stat: string): string {
  try {
    return i18next.t(`stats.${stat}`, { ns: 'webui' }) || stat
  } catch {
    return stat
  }
}

function getSkillName(skillId: string): string {
  try {
    return i18next.t(`${skillId}.name`, { ns: 'skill' }) || skillId
  } catch {
    return skillId
  }
}

function getMarkName(markId: string): string {
  try {
    return (
      i18next.t(`${markId}.name`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }) || markId
    )
  } catch {
    return markId
  }
}

onMounted(async () => {
  try {
    if (!gameDataStore.loaded) {
      await gameDataStore.initialize()
    }

    if (!species.value) {
      error.value = '未找到该精灵'
    }
  } catch (e) {
    error.value = '加载数据失败'
    console.error('Failed to load species data:', e)
  } finally {
    loading.value = false
  }
})
</script>
