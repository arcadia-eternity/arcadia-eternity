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

      <!-- 技能详情 -->
      <div v-else-if="skill" class="space-y-8">
        <!-- 技能头部信息 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <div class="flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
            <!-- 技能图标区域 -->
            <div class="flex-shrink-0 flex items-center justify-center w-32 h-32 bg-gray-100 border border-gray-200 rounded-lg">
              <ElementIcon :element="skill.element" class="w-16 h-16" />
            </div>

            <!-- 基本信息 -->
            <div class="flex-1 text-center md:text-left">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">
                {{ getSkillName() }}
              </h1>
              <div class="flex items-center justify-center md:justify-start space-x-4 mb-4">
                <ElementIcon :element="skill.element" class="w-6 h-6" />
                <span class="text-gray-600">{{ getElementName() }}</span>
                <span class="text-gray-500">•</span>
                <span class="text-gray-600">{{ getCategoryName() }}</span>
              </div>
              <div class="text-gray-600" v-html="getRenderedSkillDescription()"></div>
            </div>
          </div>
        </div>

        <!-- 技能属性 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.skillDetail.basicInfo', { ns: 'webui' }) }}
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <!-- 威力 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.skillDetail.power', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold text-lg">{{ skill.power || '-' }}</div>
            </div>

            <!-- 命中率 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.skillDetail.accuracy', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold text-lg">{{ skill.accuracy }}%</div>
            </div>

            <!-- 怒气消耗 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.skillDetail.rage', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold text-lg">{{ skill.rage }}</div>
            </div>

            <!-- 优先度 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.skillDetail.priority', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold text-lg">{{ skill.priority || 0 }}</div>
            </div>
          </div>
        </div>

        <!-- 技能特性 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">技能特性</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- 目标 -->
            <div v-if="skill.target" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-400 text-sm mb-2">{{ i18next.t('dex.skillDetail.target', { ns: 'webui' }) }}</div>
              <div class="text-white">{{ getTargetName() }}</div>
            </div>

            <!-- 连击次数 -->
            <div v-if="skill.multihit" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-400 text-sm mb-2">{{ i18next.t('dex.skillDetail.multihit', { ns: 'webui' }) }}</div>
              <div class="text-white">
                {{
                  Array.isArray(skill.multihit) ? `${skill.multihit[0]}-${skill.multihit[1]}次` : `${skill.multihit}次`
                }}
              </div>
            </div>

            <!-- 特殊效果 -->
            <div v-if="hasSpecialEffects" class="bg-white border border-gray-200 rounded-lg p-3 md:col-span-2">
              <div class="text-gray-400 text-sm mb-2">特殊效果</div>
              <div class="flex flex-wrap gap-2">
                <span v-if="skill.sureHit" class="bg-green-600 text-white px-2 py-1 rounded text-xs">
                  {{ i18next.t('dex.skillDetail.sureHit', { ns: 'webui' }) }}
                </span>
                <span v-if="skill.sureCrit" class="bg-red-600 text-white px-2 py-1 rounded text-xs">
                  {{ i18next.t('dex.skillDetail.sureCrit', { ns: 'webui' }) }}
                </span>
                <span v-if="skill.ignoreShield" class="bg-purple-600 text-white px-2 py-1 rounded text-xs">
                  {{ i18next.t('dex.skillDetail.ignoreShield', { ns: 'webui' }) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 标签 -->
        <div
          v-if="skill.tags && skill.tags.length > 0"
          class="bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6"
        >
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.skillDetail.tags', { ns: 'webui' }) }}
          </h2>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="tag in skill.tags"
              :key="tag"
              class="bg-blue-100 border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-sm"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <!-- 相关印记 -->
        <RelatedMarks :skill-id="skill.id" :show-confidence="false" />

        <!-- 效果 -->
        <div
          v-if="skill.effect && skill.effect.length > 0"
          class="bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6"
        >
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.skillDetail.effects', { ns: 'webui' }) }}
          </h2>
          <div class="space-y-2">
            <div v-for="effectId in skill.effect" :key="effectId" class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-800">{{ effectId }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useGameDataStore } from '@/stores/gameData'
import { useTranslation } from 'i18next-vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import RelatedMarks from './RelatedMarks.vue'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import MarkdownIt from 'markdown-it'

const { i18next } = useTranslation()
const route = useRoute()
const gameDataStore = useGameDataStore()

// 创建markdown实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})

const loading = ref(true)
const error = ref<string | null>(null)

const skill = computed(() => {
  const id = route.params.id as string
  return gameDataStore.skills.byId[id] || null
})

const hasSpecialEffects = computed(() => {
  if (!skill.value) return false
  return skill.value.sureHit || skill.value.sureCrit || skill.value.ignoreShield
})

function getSkillName(): string {
  if (!skill.value) return ''
  try {
    return i18next.t(`${skill.value.id}.name`, { ns: 'skill' }) || skill.value.id
  } catch {
    return skill.value.id
  }
}

function getSkillDescription(): string {
  if (!skill.value) return ''
  try {
    return i18next.t(`${skill.value.id}.description`, { ns: 'skill' }) || ''
  } catch {
    return ''
  }
}

function getRenderedSkillDescription(): string {
  const description = getSkillDescription()
  if (!description) return ''
  return md.render(description)
}

function getElementName(): string {
  if (!skill.value) return ''
  try {
    return i18next.t(`element.${skill.value.element}`, { ns: 'battle' }) || skill.value.element
  } catch {
    return skill.value.element
  }
}

function getCategoryName(): string {
  if (!skill.value) return ''
  try {
    return i18next.t(`category.${skill.value.category}`, { ns: 'battle' }) || skill.value.category
  } catch {
    return skill.value.category
  }
}

function getTargetName(): string {
  if (!skill.value?.target) return ''
  try {
    return i18next.t(`target.${skill.value.target}`, { ns: 'battle' }) || skill.value.target
  } catch {
    return skill.value.target
  }
}

onMounted(async () => {
  try {
    if (!gameDataStore.loaded) {
      await gameDataStore.initialize()
    }

    if (!skill.value) {
      error.value = '未找到该技能'
    }
  } catch (e) {
    error.value = '加载数据失败'
    console.error('Failed to load skill data:', e)
  } finally {
    loading.value = false
  }
})
</script>
