import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createRuleSpeciesRepository, loadNativeCliPack } from '../native-pack'

it('loads native effects while preserving editable species learnsets for server rules', async () => {
  const loaded = await loadNativeCliPack('builtin:base')
  expect(loaded.pack?.data.effects).toEqual([])
  expect(loaded.content.effects).toHaveLength(1065)
  expect(loaded.data.species).toHaveLength(145)

  const repository = createRuleSpeciesRepository(loaded.data)
  const species = repository.getSpeciesById?.('pet_dilan')
  expect(species?.learnable_skills.length).toBeGreaterThan(0)
  expect(species?.learnable_skills).toEqual(
    (loaded.data.species.find(raw => (raw as { id: string }).id === 'pet_dilan') as { learnable_skills: unknown })
      .learnable_skills,
  )
  expect(repository.getAllSpecies?.()).toHaveLength(145)
  expect(repository.getSpeciesById?.('pet_missing')).toBeUndefined()
})

it('runs the validation command against the native base pack without effect YAML', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'bin/cli.ts', 'validate', '--strict', '--pack-ref', 'builtin:base'],
    { cwd: new URL('../..', import.meta.url), timeout: 20_000 },
  )
  expect(stdout).toContain('effect=1065, mark=416, skill=966, species=145')
  expect(stdout).toContain('数据包验证通过')
})
