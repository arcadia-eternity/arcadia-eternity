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
