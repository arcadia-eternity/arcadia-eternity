import { describe, expect, it, vi } from 'vitest'
import { matchesDataFile, resolveTargetFile, resolveTargetFileBatch } from '../utils/fileResolver'

const files = ['species.yaml', 'groups/dilan/species.yaml', 'groups/yilu/species.yaml']
const manifest = { paths: { dataDir: 'data' }, data: { species: files } }

describe('nested content files', () => {
  it('matches manifest filters against either source-path representation without conflating basenames', () => {
    expect(matchesDataFile('data/groups/dilan/species.yaml', files[1], files)).toBe(true)
    expect(matchesDataFile('groups/dilan/species.yaml', files[1], files)).toBe(true)
    expect(matchesDataFile('data/groups/yilu/species.yaml', files[1], files)).toBe(false)
    expect(matchesDataFile('data/groups/dilan/species.yaml', files[0], files)).toBe(false)
    expect(matchesDataFile('data/species.yaml', files[0], files)).toBe(true)
  })

  it.each(['data/groups/yilu/species.yaml', 'groups/yilu/species.yaml'])(
    'uses the source hint %s without adding a second data directory',
    async sourceFile => {
      const readFile = vi.fn(async () => ({ content: '- id: pet_yilu\n' }))
      const result = await resolveTargetFile(
        { manifest, kind: 'species', packFolder: 'base', isBase: true, readFile },
        'pet_yilu',
        sourceFile,
      )
      expect(result?.relativePath).toBe('data/groups/yilu/species.yaml')
      expect(readFile).toHaveBeenCalledExactlyOnceWith('base', 'data/groups/yilu/species.yaml')
    },
  )

  it('collects selected records across every file with descending row positions', async () => {
    const contents: Record<string, string> = {
      'data/species.yaml': '- id: pet_unselected\n',
      'data/groups/dilan/species.yaml': '- id: pet_dilan\n- id: pet_didilan\n',
      'data/groups/yilu/species.yaml': '- id: pet_yilu\n',
    }
    const readFile = vi.fn(async (_folder: string, path: string) => ({ content: contents[path] }))
    const results = await resolveTargetFileBatch(
      { manifest, kind: 'species', packFolder: 'base', isBase: true, readFile },
      new Set(['pet_dilan', 'pet_didilan', 'pet_yilu']),
    )
    expect(results.map(({ relativePath, indices }) => ({ relativePath, indices }))).toEqual([
      { relativePath: 'data/groups/dilan/species.yaml', indices: [1, 0] },
      { relativePath: 'data/groups/yilu/species.yaml', indices: [0] },
    ])
  })
})
