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

      <!-- 印记详情 -->
      <div v-else-if="mark" class="space-y-8">
        <!-- 印记头部信息 -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <div class="flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
            <!-- 印记图标区域 -->
            <div
              class="flex-shrink-0 flex items-center justify-center w-32 h-32 bg-gray-100 border border-gray-200 rounded-lg overflow-hidden"
            >
              <img
                v-if="markImageUrl"
                :src="markImageUrl"
                :alt="getMarkName()"
                class="w-full h-full object-contain"
                @error="onImageError"
              />
              <ShieldCheckIcon v-else class="w-16 h-16 text-purple-600" />
            </div>

            <!-- 基本信息 -->
            <div class="flex-1 text-center md:text-left">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">
                {{ getMarkName() }}
              </h1>
              <div class="text-gray-600 mb-4" v-html="getRenderedMarkDescription()"></div>
              <div class="flex items-center justify-center md:justify-start space-x-2">
                <span
                  v-if="mark.config?.isShield"
                  class="bg-blue-100 border border-blue-200 text-blue-700 px-2 py-1 rounded text-sm"
                >
                  护盾类型
                </span>
                <span
                  v-if="mark.config?.stackable"
                  class="bg-green-100 border border-green-200 text-green-700 px-2 py-1 rounded text-sm"
                >
                  可叠加
                </span>
                <span
                  v-if="mark.config?.persistent"
                  class="bg-purple-100 border border-purple-200 text-purple-700 px-2 py-1 rounded text-sm"
                >
                  持久化
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 印记配置 -->
        <div v-if="mark.config" class="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.markDetail.config', { ns: 'webui' }) }}
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <!-- 持续时间 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.duration', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.duration === -1
                    ? i18next.t('dex.markDetail.unlimited', { ns: 'webui' })
                    : `${mark.config.duration} ${i18next.t('dex.markDetail.turns', { ns: 'webui' })}`
                }}
              </div>
            </div>

            <!-- 最大层数 -->
            <div v-if="mark.config.stackable" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.maxStacks', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">{{ mark.config.maxStacks }}</div>
            </div>

            <!-- 叠加策略 -->
            <div v-if="mark.config.stackable" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.stackStrategy', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">{{ mark.config.stackStrategy }}</div>
            </div>

            <!-- 持久化 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.persistent', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.persistent
                    ? i18next.t('dex.markDetail.yes', { ns: 'webui' })
                    : i18next.t('dex.markDetail.no', { ns: 'webui' })
                }}
              </div>
            </div>

            <!-- 可销毁 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.destroyable', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.destroyable
                    ? i18next.t('dex.markDetail.yes', { ns: 'webui' })
                    : i18next.t('dex.markDetail.no', { ns: 'webui' })
                }}
              </div>
            </div>

            <!-- 下场保留 -->
            <div class="bg-white border border-gray-200 rounded-lg p-3">
              <div class="text-gray-600 text-sm">
                {{ i18next.t('dex.markDetail.keepOnSwitchOut', { ns: 'webui' }) }}
              </div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.keepOnSwitchOut
                    ? i18next.t('dex.markDetail.yes', { ns: 'webui' })
                    : i18next.t('dex.markDetail.no', { ns: 'webui' })
                }}
              </div>
            </div>

            <!-- 切换转移 -->
            <div v-if="mark.config.transferOnSwitch" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-600 text-sm">
                {{ i18next.t('dex.markDetail.transferOnSwitch', { ns: 'webui' }) }}
              </div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.transferOnSwitch
                    ? i18next.t('dex.markDetail.yes', { ns: 'webui' })
                    : i18next.t('dex.markDetail.no', { ns: 'webui' })
                }}
              </div>
            </div>

            <!-- 倒下继承 -->
            <div v-if="mark.config.inheritOnFaint" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.inheritOnFaint', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">
                {{
                  mark.config.inheritOnFaint
                    ? i18next.t('dex.markDetail.yes', { ns: 'webui' })
                    : i18next.t('dex.markDetail.no', { ns: 'webui' })
                }}
              </div>
            </div>

            <!-- 互斥组 -->
            <div v-if="mark.config.mutexGroup" class="bg-slate-700/30 rounded-lg p-3">
              <div class="text-gray-600 text-sm">{{ i18next.t('dex.markDetail.mutexGroup', { ns: 'webui' }) }}</div>
              <div class="text-gray-800 font-bold">{{ mark.config.mutexGroup }}</div>
            </div>
          </div>
        </div>

        <!-- 标签 -->
        <div
          v-if="mark.tags && mark.tags.length > 0"
          class="bg-gray-50 border border-gray-200 rounded-lg p-6"
        >
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.markDetail.tags', { ns: 'webui' }) }}
          </h2>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="tag in mark.tags"
              :key="tag"
              class="bg-blue-100 border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-sm"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <!-- 效果 -->
        <div
          v-if="mark.effect && mark.effect.length > 0"
          class="bg-gray-50 border border-gray-200 rounded-lg p-6"
        >
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            {{ i18next.t('dex.markDetail.effects', { ns: 'webui' }) }}
          </h2>
          <div class="space-y-2">
            <div v-for="effectId in mark.effect" :key="effectId" class="bg-white border border-gray-200 rounded-lg p-3">
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
import { useRoute, useRouter } from 'vue-router'
import { useGameDataStore } from '@/stores/gameData'
import { useResourceStore } from '@/stores/resource'
import { useTranslation } from 'i18next-vue'
import { ArrowLeftIcon, ShieldCheckIcon } from '@heroicons/vue/24/outline'
import MarkdownIt from 'markdown-it'

const { i18next } = useTranslation()
const route = useRoute()
const router = useRouter()
const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()

// 创建markdown实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})

const loading = ref(true)
const error = ref<string | null>(null)

const mark = computed(() => {
  const id = route.params.id as string
  return gameDataStore.marks.byId[id] || null
})

const markImageUrl = computed(() => {
  if (!mark.value || showImageError.value) return null
  try {
    // 尝试从资源存储中获取印记图像URL
    const imageUrl = resourceStore.markImage.byId[mark.value.id]
    return imageUrl || null
  } catch {
    return null
  }
})

const showImageError = ref(false)

function getMarkName(): string {
  if (!mark.value) return ''
  try {
    return (
      i18next.t(`${mark.value.id}.name`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }) || mark.value.id
    )
  } catch {
    return mark.value.id
  }
}

function getMarkDescription(): string {
  if (!mark.value) return ''
  try {
    return (
      i18next.t(`${mark.value.id}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }) || ''
    )
  } catch {
    return ''
  }
}

function getRenderedMarkDescription(): string {
  const description = getMarkDescription()
  if (!description) return ''
  return md.render(description)
}

function onImageError() {
  showImageError.value = true
}

onMounted(async () => {
  try {
    // 并行加载游戏数据和资源数据
    await Promise.all([
      gameDataStore.loaded ? Promise.resolve() : gameDataStore.initialize(),
      resourceStore.loaded ? Promise.resolve() : resourceStore.initialize(),
    ])

    if (!mark.value) {
      error.value = '未找到该印记'
    }
  } catch (e) {
    error.value = '加载数据失败'
    console.error('Failed to load mark data:', e)
  } finally {
    loading.value = false
  }
})
</script>
