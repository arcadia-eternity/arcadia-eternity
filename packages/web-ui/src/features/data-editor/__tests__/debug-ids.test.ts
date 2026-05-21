import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { Value } from '@sinclair/typebox/value'
import { effectDSLSchema, type EffectDSL } from '@arcadia-eternity/schema'
import {
  parseYamlAnchoredDataset,
  upsertYamlAnchoredRecord,
  stringifyYamlAnchoredDataset,
} from '../schemas/yamlAnchoredRecords'

const yamlPath = path.resolve(__dirname, '../../../../../../packs/base/data/effect_skill.yaml')
const content = fs.readFileSync(yamlPath, 'utf-8')

describe('upsert in-place test', () => {
  it('record is replaced in-place (not appended) after upsert', () => {
    const dataset = parseYamlAnchoredDataset(content)
    const initialCount = dataset.rows.length
    process.stdout.write(`[DEBUG] Initial record count: ${initialCount}\n`)

    const targetIdx = 1
    const originalRow = dataset.rows[targetIdx]
    const recordId = originalRow.id
    process.stdout.write(`[DEBUG] Target: idx=${targetIdx} id="${recordId}"\n`)

    const foundIdx = dataset.rows.findIndex(r => r.id === recordId)
    process.stdout.write(`[DEBUG] findIndex result: ${foundIdx}\n`)
    expect(foundIdx).toBe(targetIdx)

    const draft = structuredClone(originalRow.value)
    draft.priority = 999

    const result = upsertYamlAnchoredRecord({
      dataset,
      schema: effectDSLSchema,
      draft,
      targetIndex: foundIdx,
    })
    process.stdout.write(`[DEBUG] Upsert result index: ${result.index}\n`)

    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    process.stdout.write(`[DEBUG] Reparsed count: ${reparsed.rows.length}\n`)

    const reparsedRow = reparsed.rows[targetIdx]
    expect(reparsedRow).toBeDefined()
    expect(reparsedRow.id).toBe(recordId)
    expect(reparsedRow.value.priority).toBe(999)

    const dupCount = reparsed.rows.filter(r => r.id === recordId).length
    process.stdout.write(`[DEBUG] Duplicate count: ${dupCount}\n`)
    expect(dupCount).toBe(1)
    expect(reparsed.rows.length).toBe(initialCount)
    process.stdout.write('[DEBUG] SUCCESS: In-place replace works\n')
  })

  it('record is appended when targetIndex is undefined', () => {
    const dataset = parseYamlAnchoredDataset(content)
    const initialCount = dataset.rows.length

    const originalRow = dataset.rows[1]
    const draft = structuredClone(originalRow.value)
    draft.priority = 888

    const result = upsertYamlAnchoredRecord({
      dataset,
      schema: effectDSLSchema,
      draft,
    })

    const stringified = stringifyYamlAnchoredDataset(dataset)
    const reparsed = parseYamlAnchoredDataset(stringified)
    const lastRow = reparsed.rows[reparsed.rows.length - 1]
    expect(lastRow.id).toBe(originalRow.id)
    expect(lastRow.value.priority).toBe(888)
    expect(reparsed.rows.length).toBe(initialCount + 1)
    process.stdout.write(`[DEBUG] Appended at index ${result.index}\n`)
    process.stdout.write('[DEBUG] CONFIRMED: Missing targetIndex causes appending\n')
  })

  it('schema normalizeWithSchema does NOT strip id field', () => {
    const dataset = parseYamlAnchoredDataset(content)
    const originalRow = dataset.rows[1]
    const draft = structuredClone(originalRow.value)

    const cloned = Value.Clone(draft)
    const converted = Value.Convert(effectDSLSchema, cloned)
    const cleaned = Value.Clean(effectDSLSchema, converted)

    const idAfter = String((cleaned as Record<string, unknown>)?.id ?? '').trim()
    process.stdout.write(`[DEBUG] Original id: "${originalRow.id}" -> After schema: "${idAfter}"\n`)
    expect(idAfter).toBe(originalRow.id)
  })
})
