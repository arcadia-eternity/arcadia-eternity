<script setup lang="ts">
/**
 * RelatedEntities - Cross-entity reference panel.
 *
 * Shows which species learn a skill, which skills a species can learn,
 * which effects a skill/mark uses, etc. All entries are clickable for navigation.
 */
import { computed, reactive } from 'vue'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { useEditorState, type EntityType } from '../../composables/useEditorState'
import { SkillMarkRelationService } from '@/services/skillMarkRelationService'
import { translateEntityName } from '../../schemas/editorSchemas'
import { useGameConfig } from '../../game-config'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'

const props = defineProps<{
  entityType: EntityType
  recordId: string
  collapsed?: boolean
}>()

const gameData = useGameDataStore()
const editorState = useEditorState()
const config = useGameConfig()

// --- Section Collapse State ---
const sectionState = reactive<Record<string, boolean>>({
  skills: false,
  abilityMarks: false,
  emblemMarks: false,
  speciesWithSkill: false,
  skillEffects: false,
  relatedMarks: false,
  speciesWithMark: false,
  markEffects: false,
  skillsWithMark: false,
  effectSkills: false,
  effectMarks: false,
})

function toggleSection(key: string) {
  sectionState[key] = !sectionState[key]
}

// --- Navigation ---
function navigateToEntity(type: EntityType, id: string) {
  editorState.selectedEntityType = type
  editorState.selectedRecordId = id
}

// =====================
// Species View
// =====================

/** Ability marks */
const abilityMarks = computed(() => {
  if (props.entityType !== 'species') return []
  const species = gameData.getSpecies(props.recordId) as SpeciesSchemaType | undefined
  if (!species?.ability) return []
  return species.ability.map(id => {
    const mark = gameData.getMark(id) as MarkSchemaType | undefined
    return { id, mark }
  })
})

/** Emblem marks */
const emblemMarks = computed(() => {
  if (props.entityType !== 'species') return []
  const species = gameData.getSpecies(props.recordId) as SpeciesSchemaType | undefined
  if (!species?.emblem) return []
  return species.emblem.map(id => {
    const mark = gameData.getMark(id) as MarkSchemaType | undefined
    return { id, mark }
  })
})

// =====================
// Skill View
// =====================

/** Species that have this skill in learnable_skills */
const speciesWithSkill = computed(() => {
  if (props.entityType !== 'skills') return []
  return gameData.speciesList
    .filter((s): s is SpeciesSchemaType => {
      if (!s?.learnable_skills) return false
      return s.learnable_skills.some(ls => ls.skill_id === props.recordId)
    })
    .map(s => ({
      id: s.id,
      num: s.num,
      element: s.element,
    }))
})

/** Effects used by this skill */
const skillEffects = computed(() => {
  if (props.entityType !== 'skills') return []
  const skill = gameData.getSkill(props.recordId) as SkillSchemaType | undefined
  if (!skill?.effect) return []
  return skill.effect.map(effectId => {
    const effect = gameData.getEffect(effectId)
    return {
      id: effectId,
      trigger: effect?.trigger,
      exists: !!effect,
    }
  })
})

/** Related marks via SkillMarkRelationService */
const relatedMarks = computed(() => {
  if (props.entityType !== 'skills') return []
  const service = new SkillMarkRelationService(gameData.skills.byId, gameData.marks.byId, gameData.effects.byId)
  const analysis = service.analyzeSkillMarkRelations(props.recordId)
  return analysis.relatedMarks
    .filter(r => r.markId !== 'unknown')
    .map(r => {
      const mark = gameData.getMark(r.markId) as MarkSchemaType | undefined
      return {
        markId: r.markId,
        mark,
        relationType: r.relationType,
        confidence: r.confidence,
        description: r.description,
      }
    })
})

// =====================
// Mark View
// =====================

/** Species that have this mark as ability or emblem */
const speciesWithMark = computed(() => {
  if (props.entityType !== 'marks') return []
  return gameData.speciesList
    .filter((s): s is SpeciesSchemaType => {
      if (!s) return false
      const isAbility = Array.isArray(s.ability) && s.ability.includes(props.recordId)
      const isEmblem = Array.isArray(s.emblem) && s.emblem.includes(props.recordId)
      return isAbility || isEmblem
    })
    .map(s => ({
      id: s.id,
      num: s.num,
      element: s.element,
      role: (s.ability?.includes(props.recordId) ? 'ability' : 'emblem') as 'ability' | 'emblem',
    }))
})

/** Effects used by this mark */
const markEffects = computed(() => {
  if (props.entityType !== 'marks') return []
  const mark = gameData.getMark(props.recordId) as MarkSchemaType | undefined
  if (!mark?.effect) return []
  return mark.effect.map(effectId => {
    const effect = gameData.getEffect(effectId)
    return {
      id: effectId,
      trigger: effect?.trigger,
      exists: !!effect,
    }
  })
})

/** Skills that reference this mark via effects */
const skillsWithMark = computed(() => {
  if (props.entityType !== 'marks') return []
  const service = new SkillMarkRelationService(gameData.skills.byId, gameData.marks.byId, gameData.effects.byId)
  const skillIds = service.analyzeMarkSkillRelations(props.recordId)
  return skillIds.map(skillId => {
    const skill = gameData.getSkill(skillId) as SkillSchemaType | undefined
    return {
      id: skillId,
      element: skill?.element,
      category: skill?.category,
    }
  })
})

// =====================
// Effect View
// =====================

/** Skills that reference this effect */
const effectSkills = computed(() => {
  if (props.entityType !== 'effects') return []
  return gameData.skillList
    .filter((s): s is SkillSchemaType => {
      if (!s?.effect) return false
      return s.effect.includes(props.recordId)
    })
    .map(s => ({
      id: s.id,
      element: s.element,
      category: s.category,
    }))
})

/** Marks that reference this effect */
const effectMarks = computed(() => {
  if (props.entityType !== 'effects') return []
  return gameData.marksList
    .filter((m): m is MarkSchemaType => {
      if (!m?.effect) return false
      return m.effect.includes(props.recordId)
    })
    .map(m => ({
      id: m.id,
    }))
})

// --- Trigger label helper ---
const triggers = config.triggers ?? {}

function formatTrigger(trigger: unknown): string {
  if (!trigger) return ''
  if (Array.isArray(trigger)) {
    return trigger.map(t => triggers[t as string] ?? t).join(', ')
  }
  return triggers[trigger as string] ?? String(trigger)
}

// --- Relation type labels ---
const RELATION_TYPE_LABELS: Record<string, string> = {
  adds: '添加',
  removes: '移除',
  modifies: '修改',
  consumes: '消耗',
  tags: '标签',
}
</script>

<template>
  <div class="related-entities">
    <div v-if="!recordId" class="re-empty">
      <p class="re-empty-text">选择记录查看关联实体</p>
    </div>

    <template v-else>
      <!-- ==================== SPECIES VIEW ==================== -->
      <template v-if="entityType === 'species'">
        <!-- 能力标记 -->
        <div v-if="abilityMarks.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('abilityMarks')">
            <span class="re-section-toggle">{{ sectionState.abilityMarks ? '▾' : '▸' }}</span>
            <span class="re-section-title">能力标记</span>
            <span class="re-section-count">{{ abilityMarks.length }}</span>
          </button>
          <div v-show="!sectionState.abilityMarks" class="re-entity-grid">
            <button
              v-for="mark in abilityMarks"
              :key="mark.id"
              class="re-entity-item"
              @click="navigateToEntity('marks', mark.id)"
            >
              <MarkIcon :mark-id="mark.id" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(mark.id, config.entities.marks) }}</span>
            </button>
          </div>
        </div>

        <!-- 徽章标记 -->
        <div v-if="emblemMarks.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('emblemMarks')">
            <span class="re-section-toggle">{{ sectionState.emblemMarks ? '▾' : '▸' }}</span>
            <span class="re-section-title">徽章标记</span>
            <span class="re-section-count">{{ emblemMarks.length }}</span>
          </button>
          <div v-show="!sectionState.emblemMarks" class="re-entity-grid">
            <button
              v-for="mark in emblemMarks"
              :key="mark.id"
              class="re-entity-item"
              @click="navigateToEntity('marks', mark.id)"
            >
              <MarkIcon :mark-id="mark.id" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(mark.id, config.entities.marks) }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- ==================== SKILL VIEW ==================== -->
      <template v-if="entityType === 'skills'">
        <!-- 学习此技能的物种 -->
        <div v-if="speciesWithSkill.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('speciesWithSkill')">
            <span class="re-section-toggle">{{ sectionState.speciesWithSkill ? '▾' : '▸' }}</span>
            <span class="re-section-title">学习此技能的物种</span>
            <span class="re-section-count">{{ speciesWithSkill.length }}</span>
          </button>
          <div v-show="!sectionState.speciesWithSkill" class="re-entity-grid">
            <button
              v-for="sp in speciesWithSkill"
              :key="sp.id"
              class="re-entity-item"
              @click="navigateToEntity('species', sp.id)"
            >
              <PetIcon :id="sp.num ?? 0" class="re-pet-icon" />
              <span class="re-entity-name">{{ translateEntityName(sp.id, config.entities.species) }}</span>
              <ElementIcon v-if="sp.element" :element="sp.element" :size="14" class="re-icon re-icon--small" />
            </button>
          </div>
        </div>

        <!-- 效果列表 -->
        <div v-if="skillEffects.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('skillEffects')">
            <span class="re-section-toggle">{{ sectionState.skillEffects ? '▾' : '▸' }}</span>
            <span class="re-section-title">效果列表</span>
            <span class="re-section-count">{{ skillEffects.length }}</span>
          </button>
          <div v-show="!sectionState.skillEffects" class="re-entity-grid">
            <button
              v-for="effect in skillEffects"
              :key="effect.id"
              class="re-entity-item re-entity-item--effect"
              @click="navigateToEntity('effects', effect.id)"
            >
              <span class="re-effect-icon">⚡</span>
              <span class="re-entity-name">{{ effect.id }}</span>
              <span v-if="effect.trigger" class="re-trigger-tag">{{ formatTrigger(effect.trigger) }}</span>
              <span v-if="!effect.exists" class="re-tag re-tag--error">缺失</span>
            </button>
          </div>
        </div>

        <!-- 关联标记 (via SkillMarkRelationService) -->
        <div v-if="relatedMarks.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('relatedMarks')">
            <span class="re-section-toggle">{{ sectionState.relatedMarks ? '▾' : '▸' }}</span>
            <span class="re-section-title">关联标记</span>
            <span class="re-section-count">{{ relatedMarks.length }}</span>
          </button>
          <div v-show="!sectionState.relatedMarks" class="re-entity-grid">
            <button
              v-for="rel in relatedMarks"
              :key="rel.markId"
              class="re-entity-item"
              @click="navigateToEntity('marks', rel.markId)"
            >
              <MarkIcon :mark-id="rel.markId" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(rel.markId, config.entities.marks) }}</span>
              <span class="re-relation-badge">{{ RELATION_TYPE_LABELS[rel.relationType] ?? rel.relationType }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- ==================== MARK VIEW ==================== -->
      <template v-if="entityType === 'marks'">
        <!-- 拥有此标记的物种 -->
        <div v-if="speciesWithMark.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('speciesWithMark')">
            <span class="re-section-toggle">{{ sectionState.speciesWithMark ? '▾' : '▸' }}</span>
            <span class="re-section-title">拥有此标记的物种</span>
            <span class="re-section-count">{{ speciesWithMark.length }}</span>
          </button>
          <div v-show="!sectionState.speciesWithMark" class="re-entity-grid">
            <button
              v-for="sp in speciesWithMark"
              :key="sp.id"
              class="re-entity-item"
              @click="navigateToEntity('species', sp.id)"
            >
              <PetIcon :id="sp.num ?? 0" class="re-pet-icon" />
              <span class="re-entity-name">{{ translateEntityName(sp.id, config.entities.species) }}</span>
              <span
                class="re-relation-badge"
                :class="sp.role === 'ability' ? 're-relation-badge--accent' : 're-relation-badge--muted'"
                >{{ sp.role === 'ability' ? '能力' : '徽章' }}</span
              >
            </button>
          </div>
        </div>

        <!-- 效果列表 -->
        <div v-if="markEffects.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('markEffects')">
            <span class="re-section-toggle">{{ sectionState.markEffects ? '▾' : '▸' }}</span>
            <span class="re-section-title">效果列表</span>
            <span class="re-section-count">{{ markEffects.length }}</span>
          </button>
          <div v-show="!sectionState.markEffects" class="re-entity-grid">
            <button
              v-for="effect in markEffects"
              :key="effect.id"
              class="re-entity-item re-entity-item--effect"
              @click="navigateToEntity('effects', effect.id)"
            >
              <span class="re-effect-icon">⚡</span>
              <span class="re-entity-name">{{ effect.id }}</span>
              <span v-if="effect.trigger" class="re-trigger-tag">{{ formatTrigger(effect.trigger) }}</span>
              <span v-if="!effect.exists" class="re-tag re-tag--error">缺失</span>
            </button>
          </div>
        </div>

        <!-- 使用此标记的技能 -->
        <div v-if="skillsWithMark.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('skillsWithMark')">
            <span class="re-section-toggle">{{ sectionState.skillsWithMark ? '▾' : '▸' }}</span>
            <span class="re-section-title">使用此标记的技能</span>
            <span class="re-section-count">{{ skillsWithMark.length }}</span>
          </button>
          <div v-show="!sectionState.skillsWithMark" class="re-entity-grid">
            <button
              v-for="skill in skillsWithMark"
              :key="skill.id"
              class="re-entity-item"
              @click="navigateToEntity('skills', skill.id)"
            >
              <ElementIcon v-if="skill.element" :element="skill.element" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(skill.id, config.entities.skills) }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- ==================== EFFECT VIEW ==================== -->
      <template v-if="entityType === 'effects'">
        <!-- 使用此效果的技能 -->
        <div v-if="effectSkills.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('effectSkills')">
            <span class="re-section-toggle">{{ sectionState.effectSkills ? '▾' : '▸' }}</span>
            <span class="re-section-title">使用此效果的技能</span>
            <span class="re-section-count">{{ effectSkills.length }}</span>
          </button>
          <div v-show="!sectionState.effectSkills" class="re-entity-grid">
            <button
              v-for="skill in effectSkills"
              :key="skill.id"
              class="re-entity-item"
              @click="navigateToEntity('skills', skill.id)"
            >
              <ElementIcon v-if="skill.element" :element="skill.element" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(skill.id, config.entities.skills) }}</span>
            </button>
          </div>
        </div>

        <!-- 使用此效果的标记 -->
        <div v-if="effectMarks.length > 0" class="re-section">
          <button class="re-section-header" @click="toggleSection('effectMarks')">
            <span class="re-section-toggle">{{ sectionState.effectMarks ? '▾' : '▸' }}</span>
            <span class="re-section-title">使用此效果的标记</span>
            <span class="re-section-count">{{ effectMarks.length }}</span>
          </button>
          <div v-show="!sectionState.effectMarks" class="re-entity-grid">
            <button
              v-for="mark in effectMarks"
              :key="mark.id"
              class="re-entity-item"
              @click="navigateToEntity('marks', mark.id)"
            >
              <MarkIcon :mark-id="mark.id" :size="16" class="re-icon" />
              <span class="re-entity-name">{{ translateEntityName(mark.id, config.entities.marks) }}</span>
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* ============================================
   RelatedEntities - Cross-Entity Reference Panel
   Dark theme, compact lists, 2-col grid
   ============================================ */

.related-entities {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

/* --- Empty State --- */

.re-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ae-space-6) var(--ae-space-4);
}

.re-empty-text {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}

/* --- Section --- */

.re-section {
  border-bottom: 1px solid var(--ae-border-subtle);
}

.re-section:last-child {
  border-bottom: none;
}

.re-section-header {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  padding: var(--ae-space-2) var(--ae-space-3);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ae-text-secondary);
  font-size: var(--ae-font-sm);
  font-weight: 600;
  text-align: left;
  transition: background-color 0.15s ease;
}

.re-section-header:hover {
  background-color: var(--ae-hover);
}

.re-section-toggle {
  width: 12px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  flex-shrink: 0;
  text-align: center;
}

.re-section-title {
  flex: 1;
  color: var(--ae-text-secondary);
  letter-spacing: 0.02em;
}

.re-section-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 var(--ae-space-1);
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-muted);
  background-color: var(--ae-bg-overlay);
  border-radius: var(--ae-radius-sm);
  font-variant-numeric: tabular-nums;
}

/* --- Entity Grid --- */

.re-entity-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;
  padding: 0 var(--ae-space-2) var(--ae-space-2);
}

@media (min-width: 480px) {
  .re-entity-grid {
    grid-template-columns: 1fr 1fr;
    gap: 1px var(--ae-space-1);
  }
}

/* --- Entity Item --- */

.re-entity-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: 5px var(--ae-space-2);
  border: none;
  border-radius: var(--ae-radius-sm);
  background: none;
  cursor: pointer;
  color: var(--ae-text-primary);
  font-size: var(--ae-font-sm);
  font-family: inherit;
  text-align: left;
  min-width: 0;
  transition: background-color 0.12s ease;
}

.re-entity-item:hover {
  background-color: var(--ae-hover);
}

.re-entity-item:active {
  background-color: var(--ae-active);
}

.re-entity-item--effect {
  padding-top: 4px;
  padding-bottom: 4px;
}

/* --- Icons --- */

.re-icon {
  flex-shrink: 0;
}

.re-icon--small {
  opacity: 0.6;
}

.re-pet-icon {
  width: 22px;
  height: 22px;
  min-width: 22px;
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  flex-shrink: 0;
}

.re-effect-icon {
  font-size: var(--ae-font-sm);
  line-height: 1;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

/* --- Entity Name --- */

.re-entity-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ae-text-primary);
  font-weight: 450;
}

/* --- Tags & Badges --- */

.re-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 500;
  border-radius: 3px;
  line-height: 1.3;
  flex-shrink: 0;
}

.re-tag--muted {
  background-color: var(--ae-bg-overlay);
  color: var(--ae-text-muted);
}

.re-tag--error {
  background-color: var(--ae-error-subtle);
  color: var(--ae-error);
}

.re-trigger-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 500;
  color: var(--ae-info);
  background-color: var(--ae-info-subtle);
  border-radius: 3px;
  line-height: 1.3;
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.re-relation-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 500;
  color: var(--ae-text-secondary);
  background-color: var(--ae-bg-overlay);
  border-radius: 3px;
  line-height: 1.3;
  flex-shrink: 0;
}

.re-relation-badge--accent {
  color: var(--ae-accent-primary);
  background-color: var(--ae-accent-primary-subtle);
}

.re-relation-badge--muted {
  color: var(--ae-text-muted);
  background-color: var(--ae-bg-overlay);
}
</style>
