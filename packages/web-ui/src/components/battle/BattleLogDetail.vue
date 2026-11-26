<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { BattleMessageType } from '@arcadia-eternity/const'
import BattleFrame from './BattleFrame.vue'
import BattleGlyph from './BattleGlyph.vue'
import { useBattleLogFormatter, type FormattedBattleMessage } from '@/composition/useBattleLogFormatter'
import { useBattleStore } from '@/stores/battle'

const emit = defineEmits<{ close: [] }>()

const battleStore = useBattleStore()
const { format } = useBattleLogFormatter()

type Category = 'skill' | 'hp' | 'mark' | 'rage' | 'pet' | 'system'

const CATEGORIES: { id: Category; label: string; types: BattleMessageType[] }[] = [
  {
    id: 'skill',
    label: '技能',
    types: [
      BattleMessageType.SkillUse,
      BattleMessageType.SkillMiss,
      BattleMessageType.SkillUseFail,
      BattleMessageType.SkillUseEnd,
    ],
  },
  {
    id: 'hp',
    label: '体力',
    types: [
      BattleMessageType.Damage,
      BattleMessageType.DamageFail,
      BattleMessageType.Heal,
      BattleMessageType.HealFail,
      BattleMessageType.HpChange,
      BattleMessageType.PetRevive,
    ],
  },
  {
    id: 'mark',
    label: '印记与效果',
    types: [
      BattleMessageType.MarkApply,
      BattleMessageType.MarkDestroy,
      BattleMessageType.MarkExpire,
      BattleMessageType.MarkUpdate,
      BattleMessageType.EffectApply,
      BattleMessageType.EffectApplyFail,
      BattleMessageType.StatChange,
      BattleMessageType.Transform,
      BattleMessageType.TransformEnd,
    ],
  },
  { id: 'rage', label: '怒气', types: [BattleMessageType.RageChange] },
  {
    id: 'pet',
    label: '出场',
    types: [
      BattleMessageType.PetSwitch,
      BattleMessageType.PetDefeated,
      BattleMessageType.ForcedSwitch,
      BattleMessageType.FaintSwitch,
    ],
  },
]

const categoryOf = new Map<BattleMessageType, Category>(
  CATEGORIES.flatMap(category => category.types.map(type => [type, category.id] as const)),
)
const ALL_CATEGORIES = [...CATEGORIES, { id: 'system' as const, label: '系统', types: [] }]

const activeCategories = ref(new Set<Category>(['skill', 'hp', 'mark', 'rage', 'pet']))
const query = ref('')

function toggleCategory(id: Category) {
  const next = new Set(activeCategories.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  activeCategories.value = next
}

type TurnGroup = { id: string; turn: number; entries: FormattedBattleMessage[] }

// TurnStart messages become group headers instead of entries.
const turns = computed<TurnGroup[]>(() => {
  const groups: TurnGroup[] = [{ id: 'battle-log-turn-0', turn: 0, entries: [] }]
  for (const msg of battleStore.log) {
    if (msg.type === BattleMessageType.TurnStart) {
      groups.push({ id: `battle-log-turn-${groups.length}`, turn: msg.data.turn, entries: [] })
      continue
    }
    groups[groups.length - 1].entries.push(format(msg))
  }
  return groups
})

const visibleTurns = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return turns.value
    .map(group => ({
      ...group,
      entries: group.entries.filter(
        entry =>
          entry.content &&
          activeCategories.value.has(categoryOf.get(entry.type) ?? 'system') &&
          (!keyword || entry.content.toLowerCase().includes(keyword)),
      ),
    }))
    .filter(group => group.entries.length)
})

const visibleCount = computed(() => visibleTurns.value.reduce((sum, group) => sum + group.entries.length, 0))

function turnLabel(turn: number) {
  return turn === 0 ? '开场' : `第 ${turn} 回合`
}

const listRef = useTemplateRef('listRef')
function jumpTo(id: string) {
  listRef.value?.querySelector(`#${id}`)?.scrollIntoView({ block: 'start' })
}

function formatData(entry: FormattedBattleMessage) {
  return JSON.stringify(entry.data, null, 2)
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copyLog() {
  const text = visibleTurns.value
    .map(group => [`【${turnLabel(group.turn)}】`, ...group.entries.map(entry => entry.content)].join('\n'))
    .join('\n\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch (error) {
    console.warn('复制战斗日志失败:', error)
  }
}

const closeRef = useTemplateRef('closeRef')
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
onMounted(async () => {
  closeRef.value?.focus()
  await nextTick()
  if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
})
onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
  opener?.focus()
})
</script>

<template>
  <div
    class="battle-log-detail"
    data-testid="battle-log-detail"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="battle-log-detail-title"
      class="battle-log-detail__window"
    >
      <BattleFrame />
      <header class="battle-log-detail__header">
        <h2 id="battle-log-detail-title"><BattleGlyph name="log" />战斗日志</h2>
        <span class="battle-log-detail__count">{{ visibleCount }} 条</span>
        <button class="battle-control" @click="copyLog">{{ copied ? '已复制' : '复制' }}</button>
        <button
          ref="closeRef"
          class="battle-control battle-control--icon"
          title="关闭"
          aria-label="关闭"
          @click="emit('close')"
        >
          <BattleGlyph name="close" />
        </button>
      </header>
      <div class="battle-log-detail__filters">
        <button
          v-for="category in ALL_CATEGORIES"
          :key="category.id"
          class="battle-log-detail__chip"
          :aria-pressed="activeCategories.has(category.id)"
          @click="toggleCategory(category.id)"
        >
          {{ category.label }}
        </button>
        <input v-model="query" type="search" class="battle-log-detail__search" placeholder="搜索" aria-label="搜索" />
      </div>
      <div class="battle-log-detail__body">
        <nav class="battle-log-detail__turns" aria-label="回合">
          <button v-for="group in visibleTurns" :key="group.id" @click="jumpTo(group.id)">
            {{ turnLabel(group.turn) }}
          </button>
        </nav>
        <div ref="listRef" class="battle-log-detail__list" role="log" aria-label="战斗日志详情">
          <p v-if="!visibleTurns.length" class="battle-log-detail__empty">没有记录</p>
          <section v-for="group in visibleTurns" :id="group.id" :key="group.id" class="battle-log-detail__turn">
            <h3>{{ turnLabel(group.turn) }}</h3>
            <details
              v-for="(entry, index) in group.entries"
              :key="entry.receivedAt + index"
              class="battle-log-detail__entry"
              :data-log-type="entry.type"
            >
              <summary>
                <span class="battle-log-detail__dot" aria-hidden="true"></span>
                <span class="battle-log-detail__content">{{ entry.content }}</span>
                <time>{{ entry.timestamp }}</time>
              </summary>
              <pre>{{ formatData(entry) }}</pre>
            </details>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.battle-log-detail {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000a;
}
.battle-log-detail__window {
  position: relative;
  width: 1000px;
  height: 760px;
  display: flex;
  flex-direction: column;
  color: var(--battle-text);
}
.battle-log-detail__window > :not(svg) {
  position: relative;
}
.battle-log-detail__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--battle-line);
}
.battle-log-detail__header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 18px;
  color: var(--battle-cyan);
}
.battle-log-detail__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--battle-muted);
}
.battle-log-detail__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid #36536855;
}
.battle-log-detail__chip {
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--battle-line);
  border-radius: 16px;
  color: var(--battle-muted);
  font-size: 13px;
  cursor: pointer;
}
.battle-log-detail__chip[aria-pressed='true'] {
  color: var(--battle-void);
  background: var(--battle-cyan);
  border-color: var(--battle-cyan);
}
.battle-log-detail__chip:focus-visible,
.battle-log-detail__search:focus-visible,
.battle-log-detail__turns button:focus-visible,
.battle-log-detail__entry summary:focus-visible {
  outline: 2px solid var(--battle-cyan);
  outline-offset: 2px;
}
.battle-log-detail__search {
  margin-left: auto;
  width: 220px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--battle-line);
  border-radius: 4px;
  background: var(--battle-void);
  color: var(--battle-text);
  font-size: 13px;
}
.battle-log-detail__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.battle-log-detail__turns {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  overflow-y: auto;
  border-right: 1px solid #36536855;
  scrollbar-width: thin;
  scrollbar-color: var(--battle-line) transparent;
}
.battle-log-detail__turns button {
  padding: 6px 10px;
  border-radius: 4px;
  text-align: left;
  font-size: 13px;
  color: var(--battle-muted);
  cursor: pointer;
}
.battle-log-detail__turns button:hover {
  color: var(--battle-cyan);
  background: var(--battle-panel-soft);
}
.battle-log-detail__list {
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--battle-line) transparent;
}
.battle-log-detail__turn h3 {
  position: sticky;
  top: 0;
  margin: 0;
  padding: 10px 0 6px;
  background: var(--battle-panel);
  color: var(--battle-gold);
  font-size: 14px;
  border-bottom: 1px solid var(--battle-line);
}
.battle-log-detail__entry {
  --entry-accent: var(--battle-cyan);
  border-bottom: 1px solid #36536855;
  font-size: 14px;
  line-height: 1.5;
}
.battle-log-detail__entry summary {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 8px 4px;
  cursor: pointer;
  list-style: none;
}
.battle-log-detail__entry summary::-webkit-details-marker {
  display: none;
}
.battle-log-detail__entry summary:hover {
  background: #20344380;
}
.battle-log-detail__dot {
  width: 5px;
  height: 5px;
  margin-top: 8px;
  background: var(--entry-accent);
}
.battle-log-detail__content {
  overflow-wrap: anywhere;
}
.battle-log-detail__entry time {
  color: var(--battle-muted);
  font-size: 11px;
  margin-top: 3px;
}
.battle-log-detail__entry pre {
  margin: 0 0 8px 20px;
  padding: 8px 10px;
  max-height: 240px;
  overflow: auto;
  background: var(--battle-void);
  border-radius: 4px;
  color: var(--battle-muted);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.battle-log-detail__entry[data-log-type='DAMAGE'],
.battle-log-detail__entry[data-log-type='PET_DEFEATED'] {
  --entry-accent: var(--battle-danger);
}
.battle-log-detail__entry[data-log-type='HEAL'],
.battle-log-detail__entry[data-log-type='PET_REVIVE'] {
  --entry-accent: var(--battle-hp);
}
.battle-log-detail__entry[data-log-type='SKILL_USE'],
.battle-log-detail__entry[data-log-type='BATTLE_END'] {
  --entry-accent: var(--battle-gold);
}
.battle-log-detail__empty {
  color: var(--battle-muted);
  font-size: 13px;
  padding: 16px 0;
}
</style>
