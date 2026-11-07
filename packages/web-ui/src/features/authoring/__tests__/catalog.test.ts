import { describe, expect, it } from 'vitest'
import { createCatalogIndex } from '../catalog'
import type { ContentRow, SourceRecord } from '../types'

const source = (kind: string, record: ContentRow): SourceRecord => ({
  kind,
  record,
  file: `${kind}.yaml`,
  index: null,
  version: '1',
})
describe('catalog indexes', () => {
  it('deduplicates references and retains direct media users independently of rule consumers', () => {
    const skill = source('skills', { id: 'hit' })
    const pet = source('species', { id: 'pet', learnable_skills: [{ skill_id: 'hit' }, { skill_id: 'hit' }] })
    const binding = source('presentations', {
      id: 'pet-art',
      target: { kind: 'species', id: 'pet' },
      icon: 'image',
      portrait: 'image',
    })
    const resource = source('resources', { id: 'image', kind: 'image', source: 'art/pet.png' })
    const index = createCatalogIndex([skill, pet, binding, resource], 'test')
    expect(index.consumers('skills', 'hit')).toEqual([pet])
    expect(index.consumers('resources', 'image')).toEqual([binding])
    expect(index.presentation('species', 'pet')).toBe(binding)
    expect(index.record('resources', 'image')).toBe(resource)
    // Re-indexing an external update or draft must remove old links and use the new location.
    const updated = createCatalogIndex(
      [
        skill,
        source('species', { ...pet.record, learnable_skills: [] }),
        binding,
        source('resources', { ...resource.record, source: 'moved/pet.png' }),
      ],
      'test',
    )
    expect(updated.consumers('skills', 'hit')).toEqual([])
    expect(updated.record('resources', 'image')?.record.source).toBe('moved/pet.png')
    expect(updated.presentation('species', 'pet')).toBe(binding)
  })
  it('includes explicit local effect parameters and excludes external references', () => {
    const skill = source('skills', {
      id: 'hit',
      behaviors: [
        {
          params: {
            local: { $ref: { projectId: 'test', kind: 'mark', id: 'slow' } },
            remote: { $ref: { projectId: 'other', kind: 'mark', id: 'foreign' } },
          },
        },
      ],
    })
    const index = createCatalogIndex([skill], 'test')
    expect(index.consumers('marks', 'slow')).toEqual([skill])
    expect(index.consumers('marks', 'foreign')).toEqual([])
  })
})
