import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { effectDSLSchema } from '@arcadia-eternity/schema'
import {
  parseYamlAnchoredDataset,
  upsertYamlAnchoredRecord,
  stringifyYamlAnchoredDataset,
} from '../schemas/yamlAnchoredRecords'

const yamlPath = path.resolve(__dirname, '../../../../../../packs/base/data/effect_skill.yaml')
const rawYaml = fs.readFileSync(yamlPath, 'utf-8')

function freshDataset() {
  return parseYamlAnchoredDataset(rawYaml)
}

function upsertAndReparse(dataset: ReturnType<typeof parseYamlAnchoredDataset>, recordIndex: number) {
  const record = dataset.rows[recordIndex]
  const draft = structuredClone(record.value)

  upsertYamlAnchoredRecord({
    dataset,
    schema: effectDSLSchema,
    draft,
    targetIndex: recordIndex,
  })

  const stringified = stringifyYamlAnchoredDataset(dataset)
  const reparsed = parseYamlAnchoredDataset(stringified)

  return { stringified, reparsedRow: reparsed.rows[recordIndex] }
}

describe('effect YAML round-trip (parse → upsert → stringify → re-parse)', () => {
  it('round-trips a record with merge key (<<: *) inside apply field', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const recordIndex = 1
    const originalRow = dataset.rows[recordIndex]
    expect(originalRow.id).toBe('effect_skill_reduce_opponent_def_1_stage_5_percent')

    const { stringified, reparsedRow } = upsertAndReparse(dataset, recordIndex)

    expect(reparsedRow.value.id).toBe(originalRow.value.id)
    expect(reparsedRow.value.trigger).toBe(originalRow.value.trigger)
    expect(reparsedRow.value.priority).toBe(originalRow.value.priority)
    expect(reparsedRow.value.apply).toEqual(originalRow.value.apply)
    expect(stringified).toContain('<<: *apply_opponent_statstage_-1_template')
  })

  it('round-trips 5 merge-key records without data loss', { timeout: 30000 }, () => {
    const mergeIndices = [1, 2, 3, 4, 5]

    for (const idx of mergeIndices) {
      const dataset = freshDataset()
      const originalRow = dataset.rows[idx]
      const { stringified, reparsedRow } = upsertAndReparse(dataset, idx)

      expect(reparsedRow.value.id).toBe(originalRow.value.id)
      expect(reparsedRow.value.trigger).toBe(originalRow.value.trigger)
      expect(reparsedRow.value.priority).toBe(originalRow.value.priority)
      expect(reparsedRow.value.apply).toEqual(originalRow.value.apply)
      expect(stringified).toContain('<<:')
    }
  })

  it('round-trips a simple record with no anchor or merge key', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const recordIndex = 7
    const originalRow = dataset.rows[recordIndex]
    expect(originalRow.id).toBe('effect_skill_reduce_opponent_spd_1_stage_15_percent')

    const { reparsedRow } = upsertAndReparse(dataset, recordIndex)

    expect(reparsedRow.value.id).toBe(originalRow.value.id)
    expect(reparsedRow.value.trigger).toBe(originalRow.value.trigger)
    expect(reparsedRow.value.priority).toBe(originalRow.value.priority)
    expect(reparsedRow.value.apply).toEqual(originalRow.value.apply)
  })

  it('preserves anchor definition syntax in stringified output after round-trip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)

    const anchorRecord = reparsed.rows[0]
    expect(anchorRecord.value.id).toBe('effect_skill_reduce_stat_5_percent')
    expect(stringified).toContain('&apply_opponent_statstage_-1_template')
    expect(stringified).toContain('&condition_probability_5_percent_template')
  })
})

describe('optional field roundtrip (addMark duration/stack, modifyStat delta/percent)', () => {
  it('addMark without duration/stack: fields stay undefined after roundtrip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const recordId = 'effect_skill_add_mark_opponent_yishang'
    const recordIndex = dataset.rows.findIndex(row => row.id === recordId)
    expect(recordIndex).toBeGreaterThanOrEqual(0)

    const originalRow = dataset.rows[recordIndex]
    const apply = originalRow.value.apply as Record<string, unknown>
    expect(apply.type).toBe('addMark')
    expect(apply.duration).toBeUndefined()
    expect(apply.stack).toBeUndefined()

    const { stringified, reparsedRow } = upsertAndReparse(dataset, recordIndex)

    const reparsedApply = reparsedRow.value.apply as Record<string, unknown>
    expect(reparsedApply.duration).toBeUndefined()
    expect(reparsedApply.stack).toBeUndefined()

    const recordSection = stringified.split(`id: ${recordId}`)[1]?.split('\n- id:')[0] ?? ''
    expect(recordSection).not.toMatch(/^\s+duration:/m)
    expect(recordSection).not.toMatch(/^\s+stack:/m)
  })

  it('addMark with explicit duration=-1: preserved after roundtrip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecordId = 'effect_skill_add_mark_opponent_yishang'
    const recordIndex = dataset.rows.findIndex(row => row.id === baseRecordId)
    expect(recordIndex).toBeGreaterThanOrEqual(0)

    const record = dataset.rows[recordIndex]
    const draft = structuredClone(record.value) as Record<string, unknown>

    const apply = draft.apply as Record<string, unknown>
    apply.duration = -1

    upsertYamlAnchoredRecord({
      dataset,
      schema: effectDSLSchema,
      draft,
      targetIndex: recordIndex,
    })

    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const reparsedRow = reparsed.rows[recordIndex]

    const reparsedApply = reparsedRow.value.apply as Record<string, unknown>
    expect(reparsedApply.duration).toBe(-1)
  })

  it('addMark clear cycle: set duration → save → clear → save → duration undefined', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecordId = 'effect_skill_add_mark_opponent_yishang'
    const recordIndex = dataset.rows.findIndex(row => row.id === baseRecordId)
    expect(recordIndex).toBeGreaterThanOrEqual(0)

    const record = dataset.rows[recordIndex]
    const draft1 = structuredClone(record.value) as Record<string, unknown>
    const apply1 = draft1.apply as Record<string, unknown>
    apply1.duration = 3

    upsertYamlAnchoredRecord({
      dataset,
      schema: effectDSLSchema,
      draft: draft1,
      targetIndex: recordIndex,
    })

    const stringified1 = stringifyYamlAnchoredDataset(dataset)
    const reparsed1 = parseYamlAnchoredDataset(stringified1)
    const applyAfterSet = reparsed1.rows[recordIndex].value.apply as Record<string, unknown>
    expect(applyAfterSet.duration).toBe(3)

    const draft2 = structuredClone(reparsed1.rows[recordIndex].value) as Record<string, unknown>
    const apply2 = draft2.apply as Record<string, unknown>
    delete apply2.duration

    const dataset2 = parseYamlAnchoredDataset(stringified1)
    upsertYamlAnchoredRecord({
      dataset: dataset2,
      schema: effectDSLSchema,
      draft: draft2,
      targetIndex: recordIndex,
    })

    const stringified2 = stringifyYamlAnchoredDataset(dataset2)
    const reparsed2 = parseYamlAnchoredDataset(stringified2)
    const applyAfterClear = reparsed2.rows[recordIndex].value.apply as Record<string, unknown>

    expect(applyAfterClear.duration).toBeUndefined()

    const recordSection = stringified2.split(`id: ${baseRecordId}`)[1]?.split('\n- id:')[0] ?? ''
    expect(recordSection).not.toMatch(/^\s+duration:/m)
  })

  it('modifyStat without delta/percent: no delta:0 leak in YAML', { timeout: 30000 }, () => {
    const syntheticYaml = `
- id: test_modifyStat_no_delta
  trigger: OnHit
  priority: 0
  apply:
    type: modifyStat
    target: self
    statType: atk
`.trim()

    const dataset = parseYamlAnchoredDataset(syntheticYaml)
    expect(dataset.rows.length).toBe(1)

    const originalRow = dataset.rows[0]
    const originalApply = originalRow.value.apply as Record<string, unknown>
    expect(originalApply.type).toBe('modifyStat')
    expect(originalApply.delta).toBeUndefined()
    expect(originalApply.percent).toBeUndefined()

    const draft = structuredClone(originalRow.value)
    upsertYamlAnchoredRecord({
      dataset,
      schema: effectDSLSchema,
      draft,
      targetIndex: 0,
    })

    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const reparsedApply = reparsed.rows[0].value.apply as Record<string, unknown>

    expect(reparsedApply.delta).toBeUndefined()
    expect(reparsedApply.percent).toBeUndefined()

    expect(stringified).not.toMatch(/^\s+delta:/m)
    expect(stringified).not.toMatch(/^\s+percent:/m)
    expect(stringified).not.toContain('delta: 0')
    expect(stringified).not.toContain('percent: 0')
  })
})

describe('debug: findIndex diagnosis', () => {
  it('findIndex works for effect records parsed from real YAML', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    console.log(`[DEBUG] Total rows: ${dataset.rows.length}`)
    console.log(`[DEBUG] First 20 row IDs:`)
    for (let i = 0; i < Math.min(20, dataset.rows.length); i++) {
      console.log(`  [${i}] id="${dataset.rows[i].id}"`)
    }

    const testIds = [
      'effect_skill_reduce_stat_5_percent',
      'effect_skill_reduce_opponent_def_1_stage_5_percent',
      'effect_skill_reduce_opponent_spd_1_stage_15_percent',
    ]

    for (const testId of testIds) {
      const index = dataset.rows.findIndex(row => row.id === testId)
      console.log(`[DEBUG] findIndex("${testId}") = ${index}`)
      expect(index).toBeGreaterThanOrEqual(0)
    }

    // Check for any rows with empty ID
    const emptyIdRows = dataset.rows.filter(r => !r.id || r.id.trim() === '')
    console.log(`[DEBUG] Rows with empty ID: ${emptyIdRows.length}`)
    if (emptyIdRows.length > 0) {
      console.log(`[DEBUG]   indices: ${emptyIdRows.map(r => r.index).join(', ')}`)
      console.log(`[DEBUG]   values: ${JSON.stringify(emptyIdRows.slice(0, 3).map(r => r.value))}`)
    }

    // Check for duplicate IDs
    const idCounts = new Map<string, number[]>()
    for (const row of dataset.rows) {
      if (!idCounts.has(row.id)) idCounts.set(row.id, [])
      idCounts.get(row.id)!.push(row.index)
    }
    const dups = [...idCounts.entries()].filter(([, indices]) => indices.length > 1)
    console.log(`[DEBUG] Duplicate IDs: ${dups.length}`)
    for (const [id, indices] of dups.slice(0, 10)) {
      console.log(`  "${id}" at indices ${indices.join(', ')}`)
    }
  })

  it(
    'upsertYamlAnchoredRecord with findIndex-based targetIndex replaces at correct position',
    { timeout: 30000 },
    () => {
      const dataset = freshDataset()
      const recordId = 'effect_skill_reduce_opponent_def_1_stage_5_percent'
      const existingIndex = dataset.rows.findIndex(row => row.id === recordId)

      expect(existingIndex).toBeGreaterThanOrEqual(0)
      const expectedIndex = existingIndex

      const record = dataset.rows[existingIndex]
      const draft = structuredClone(record.value) as Record<string, unknown>

      // Modify a field
      draft.priority = 999

      const result = upsertYamlAnchoredRecord({
        dataset,
        schema: effectDSLSchema,
        draft,
        targetIndex: existingIndex,
      })

      expect(result.index).toBe(expectedIndex)

      // Verify the position hasn't changed
      const stringified = stringifyYamlAnchoredDataset(dataset)
      const reparsed = parseYamlAnchoredDataset(stringified)

      // The record should still be at the same index
      const reparsedRow = reparsed.rows[expectedIndex]
      expect(reparsedRow.id).toBe(recordId)
      expect(reparsedRow.value.priority).toBe(999)

      // Verify no duplicate was created
      const allMatchCount = reparsed.rows.filter(r => r.id === recordId).length
      expect(allMatchCount).toBe(1)

      // Verify the total count didn't increase
      expect(reparsed.rows.length).toBe(dataset.rows.length)
    },
  )
})

describe('optional fields round-trip (synthetic records)', () => {
  function extractRecordYaml(fullYaml: string, recordId: string): string {
    const section = fullYaml.substring(fullYaml.indexOf(recordId))
    const nextIdx = section.indexOf('\n- id:')
    return nextIdx > 0 ? section.substring(0, nextIdx) : section
  }

  it('modifyStat without delta/percent preserves through roundtrip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecord = dataset.rows[7]
    const draft = structuredClone(baseRecord.value)
    draft.id = 'test_optional_modifystat_no_delta'
    draft.apply = {
      type: 'modifyStat',
      target: 'opponent',
      statType: { type: 'raw:number', value: 1 },
    }
    delete draft.condition

    const { index } = upsertYamlAnchoredRecord({ dataset, schema: effectDSLSchema, draft })
    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const apply = reparsed.rows[index].value.apply as Record<string, unknown>
    const yamlBlock = extractRecordYaml(stringified, 'test_optional_modifystat_no_delta')

    expect(yamlBlock).not.toMatch(/^\s+delta:/m)
    expect(yamlBlock).not.toMatch(/^\s+percent:/m)
    expect(apply.type).toBe('modifyStat')
    expect(apply.delta).toBeUndefined()
    expect(apply.percent).toBeUndefined()
  })

  it('addMark with explicit duration=-1 preserves through roundtrip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecord = dataset.rows[7]
    const draft = structuredClone(baseRecord.value)
    draft.id = 'test_optional_addmark_dur_neg1'
    draft.apply = {
      type: 'addMark',
      target: 'opponent',
      mark: { type: 'entity:baseMark', value: 'mark_test_optional' },
      duration: -1,
    }

    const { index } = upsertYamlAnchoredRecord({ dataset, schema: effectDSLSchema, draft })
    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const apply = reparsed.rows[index].value.apply as Record<string, unknown>
    const yamlBlock = extractRecordYaml(stringified, 'test_optional_addmark_dur_neg1')

    expect(apply.type).toBe('addMark')
    expect(apply.duration).toBe(-1)
    expect(yamlBlock).toContain('duration: -1')
  })

  it('modifyStat without delta/percent preserves through roundtrip', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecord = dataset.rows[7]
    const draft = structuredClone(baseRecord.value)
    draft.id = 'test_optional_modifystat_no_delta'
    draft.apply = {
      type: 'modifyStat',
      target: 'opponent',
      statType: { type: 'raw:number', value: 1 },
    }
    delete draft.condition

    const { index } = upsertYamlAnchoredRecord({ dataset, schema: effectDSLSchema, draft })
    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const apply = reparsed.rows[index].value.apply as Record<string, unknown>
    const yamlBlock = extractRecordYaml(stringified, 'test_optional_modifystat_no_delta')

    expect(yamlBlock).not.toMatch(/^\s+delta:/m)
    expect(yamlBlock).not.toMatch(/^\s+percent:/m)
    expect(apply.type).toBe('modifyStat')
    expect(apply.delta).toBeUndefined()
    expect(apply.percent).toBeUndefined()
  })

  it('clear cycle: set then clear optional field', { timeout: 30000 }, () => {
    const dataset = freshDataset()
    const baseRecord = dataset.rows[7]
    const draft = structuredClone(baseRecord.value)
    draft.id = 'test_optional_clear_cycle'
    draft.apply = {
      type: 'addMark',
      target: 'opponent',
      mark: { type: 'entity:baseMark', value: 'mark_test_clear' },
      duration: 3,
    }

    const { index } = upsertYamlAnchoredRecord({ dataset, schema: effectDSLSchema, draft })

    const firstYaml = stringifyYamlAnchoredDataset(dataset)
    const firstReparse = parseYamlAnchoredDataset(firstYaml)
    expect((firstReparse.rows[index].value.apply as Record<string, unknown>).duration).toBe(3)

    const clearDraft = structuredClone(firstReparse.rows[index].value)
    ;(clearDraft.apply as Record<string, unknown>).duration = undefined

    upsertYamlAnchoredRecord({
      dataset: firstReparse,
      schema: effectDSLSchema,
      draft: clearDraft,
      targetIndex: index,
    })

    const clearedYaml = stringifyYamlAnchoredDataset(firstReparse)
    const clearedReparse = parseYamlAnchoredDataset(clearedYaml)
    const clearedApply = clearedReparse.rows[index].value.apply as Record<string, unknown>
    const yamlBlock = extractRecordYaml(clearedYaml, 'test_optional_clear_cycle')

    expect(clearedApply.duration).toBeUndefined()
    expect(yamlBlock).not.toMatch(/^\s+duration:/m)
  })
})
