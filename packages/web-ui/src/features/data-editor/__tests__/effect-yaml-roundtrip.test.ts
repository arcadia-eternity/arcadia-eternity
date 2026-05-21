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
