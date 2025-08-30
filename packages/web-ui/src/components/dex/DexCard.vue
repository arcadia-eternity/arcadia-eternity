<template>
  <div
    class="bg-white border border-gray-300 rounded-lg p-3 sm:p-4 hover:bg-gray-50 hover:border-blue-500 transition-all duration-200 cursor-pointer group shadow-sm"
    @click="$emit('click', item)"
  >
    <!-- 精灵卡片 -->
    <div v-if="type === 'species'" class="text-center">
      <!-- 精灵图标 -->
      <div class="mb-3 flex justify-center">
        <PetIcon
          :id="(item as SpeciesSchemaType).num"
          class="w-16 h-16 group-hover:scale-110 transition-transform duration-200"
        />
      </div>

      <!-- 精灵信息 -->
      <div class="space-y-2">
        <h3 class="font-bold text-gray-900 group-hover:text-blue-600 transition-colors text-sm sm:text-base">
          {{ getItemName() }}
        </h3>
        <div class="flex justify-center">
          <ElementIcon :element="(item as SpeciesSchemaType).element" class="w-6 h-6" />
        </div>
        <div class="text-xs text-gray-500 text-[10px] sm:text-xs">#{{ String((item as SpeciesSchemaType).num).padStart(3, '0') }}</div>
      </div>
    </div>

    <!-- 技能卡片 -->
    <div v-else-if="type === 'skills'" class="space-y-3">
      <!-- 技能头部 -->
      <div class="flex items-center justify-between">
        <ElementIcon :element="(item as SkillSchemaType).element" class="w-6 h-6" />
        <div class="text-xs text-gray-600 bg-gray-200 px-2 py-1 rounded text-[10px] sm:text-xs">
          {{ getCategoryName() }}
        </div>
      </div>

      <!-- 技能名称 -->
      <h3 class="font-bold text-gray-900 group-hover:text-blue-600 transition-colors text-sm sm:text-base">
        {{ getItemName() }}
      </h3>

      <!-- 技能描述 -->
      <div
        v-if="getSkillDescription()"
        class="text-xs text-gray-600 line-clamp-2 leading-relaxed text-[11px] sm:text-xs"
        v-html="getRenderedSkillDescription()"
      ></div>

      <!-- 技能属性 -->
      <div class="grid grid-cols-2 gap-1 sm:gap-2 text-[10px] sm:text-xs">
        <div class="text-gray-600">
          <span class="text-gray-500">威力:</span> {{ (item as SkillSchemaType).power || '-' }}
        </div>
        <div class="text-gray-600">
          <span class="text-gray-500">命中:</span> {{ (item as SkillSchemaType).accuracy }}%
        </div>
        <div class="text-gray-600"><span class="text-gray-400">怒气:</span> {{ (item as SkillSchemaType).rage }}</div>
        <div class="text-gray-600">
          <span class="text-gray-500">优先:</span> {{ (item as SkillSchemaType).priority || 0 }}
        </div>
      </div>
    </div>

    <!-- 印记卡片 -->
    <div v-else-if="type === 'marks'" class="space-y-3">
      <!-- 印记图像 -->
      <div class="flex justify-center mb-3">
        <div
          class="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden group-hover:scale-110 transition-transform duration-200"
        >
          <img
            v-if="markImageUrl"
            :src="markImageUrl"
            :alt="getItemName()"
            class="w-full h-full object-contain"
            @error="onImageError"
          />
          <ShieldCheckIcon v-else class="w-10 h-10 text-purple-400" />
        </div>
      </div>

      <!-- 印记头部 -->
      <div class="flex items-center justify-between">
        <div class="text-xs text-purple-400 font-medium">印记</div>
        <div
          v-if="(item as MarkSchemaType).config?.maxStacks && (item as MarkSchemaType).config!.maxStacks > 1"
          class="text-xs text-gray-600 bg-gray-200 px-2 py-1 rounded"
        >
          最大{{ (item as MarkSchemaType).config!.maxStacks }}层
        </div>
      </div>

      <!-- 印记名称 -->
      <h3 class="font-bold text-gray-900 group-hover:text-blue-600 transition-colors text-center">
        {{ getItemName() }}
      </h3>

      <!-- 印记描述 -->
      <div
        v-if="getMarkDescription()"
        class="text-xs text-gray-600 line-clamp-2 leading-relaxed text-center"
        v-html="getRenderedMarkDescription()"
      ></div>

      <!-- 印记属性 -->
      <div class="space-y-1 text-xs">
        <div v-if="(item as MarkSchemaType).config?.duration" class="text-gray-300">
          <span class="text-gray-500">持续:</span>
          {{
            (item as MarkSchemaType).config!.duration === -1
              ? '永久'
              : `${(item as MarkSchemaType).config!.duration}回合`
          }}
        </div>
        <div v-if="(item as MarkSchemaType).config?.stackable" class="text-green-400">可叠加</div>
        <div v-if="(item as MarkSchemaType).config?.isShield" class="text-blue-400">护盾类型</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useResourceStore } from '@/stores/resource'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import { ShieldCheckIcon } from '@heroicons/vue/24/outline'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType } from '@arcadia-eternity/schema'
import MarkdownIt from 'markdown-it'

const { i18next } = useTranslation()
const resourceStore = useResourceStore()

// 创建markdown实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})

const props = defineProps<{
  item: SpeciesSchemaType | SkillSchemaType | MarkSchemaType
  type: 'species' | 'skills' | 'marks'
}>()

defineEmits<{
  click: [item: SpeciesSchemaType | SkillSchemaType | MarkSchemaType]
}>()

// 印记图像相关
const showImageError = ref(false)

const markImageUrl = computed(() => {
  if (props.type !== 'marks' || showImageError.value) return null
  try {
    const imageUrl = resourceStore.markImage.byId[props.item.id]
    return imageUrl || null
  } catch {
    return null
  }
})

function getItemName(): string {
  try {
    switch (props.type) {
      case 'species':
        return i18next.t(`${props.item.id}.name`, { ns: 'species' }) || props.item.id
      case 'skills':
        return i18next.t(`${props.item.id}.name`, { ns: 'skill' }) || props.item.id
      case 'marks':
        return (
          i18next.t(`${props.item.id}.name`, {
            ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
          }) || props.item.id
        )
      default:
        return props.item.id
    }
  } catch {
    return props.item.id
  }
}

function getCategoryName(): string {
  if (props.type === 'skills' && 'category' in props.item) {
    try {
      return i18next.t(`category.${props.item.category}`, { ns: 'battle' }) || props.item.category
    } catch {
      return props.item.category
    }
  }
  return ''
}

function getSkillDescription(): string {
  if (props.type !== 'skills') return ''
  try {
    return i18next.t(`${props.item.id}.description`, { ns: 'skill' }) || ''
  } catch {
    return ''
  }
}

function getRenderedSkillDescription(): string {
  const description = getSkillDescription()
  if (!description) return ''
  return md.render(description)
}

function getMarkDescription(): string {
  if (props.type !== 'marks') return ''
  try {
    return (
      i18next.t(`${props.item.id}.description`, {
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
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
